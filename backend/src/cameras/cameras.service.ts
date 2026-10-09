import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'node:crypto';
import { Camera, CameraSourceType } from './entities/camera.entity';
import { CreateCameraDto } from './dto/create-camera.dto';
import { Site } from '../sites/entities/site.entity';
import { MediaMTXService } from '../streaming/mediamtx.service';
import { FFmpegRunnerService } from '../streaming/ffmpeg-runner.service';
import { CameraLifecycleService } from '../streaming/camera-lifecycle.service';
import { UploadedVideoFile, VideoSourcesService } from '../streaming/video-sources.service';

@Injectable()
export class CamerasService {
  constructor(
    @InjectRepository(Camera)
    private readonly cameras: Repository<Camera>,
    @InjectRepository(Site)
    private readonly sites: Repository<Site>,
    private readonly mediamtx: MediaMTXService,
    private readonly runner: FFmpegRunnerService,
    private readonly lifecycle: CameraLifecycleService,
    private readonly videoSources: VideoSourcesService,
  ) {}

  async create(dto: CreateCameraDto) {
    const site = await this.sites.findOne({
      where: { id: dto.siteId },
      relations: { customer: true },
    });
    if (!site) throw new NotFoundException('Site not found');

    const sourceType = dto.sourceType ?? 'demo';
    const source = await this.validateSource(sourceType, dto.demoSource, dto.rtspUrl);

    const camera = this.cameras.create({
      name: dto.name,
      siteId: dto.siteId,
      site,
      sourceType,
      demoSource: source.demoSource ?? null,
      rtspUrl: source.rtspUrl ?? null,
      path: await this.makePath(site.name, dto.name),
      status: 'offline',
    });

    const saved = await this.cameras.save(camera);

    try {
      await this.lifecycle.provision(saved);
    } catch {
      // MediaMTX unreachable: keep the camera offline instead of failing the request.
      saved.status = 'offline';
      await this.cameras.save(saved);
    }

    return this.toJson(await this.getEntity(saved.id));
  }

  async findAll() {
    const cameras = await this.cameras.find({
      relations: { site: { customer: true } },
      order: { name: 'ASC' },
    });
    return cameras.map((camera) => this.toJson(camera));
  }

  async findOne(id: string) {
    return this.toJson(await this.getEntity(id));
  }

  async update(id: string, dto: Partial<CreateCameraDto>) {
    const camera = await this.getEntity(id);
    const wasStreaming = camera.status !== 'offline';
    let pathChanged = false;

    if (dto.siteId && dto.siteId !== camera.siteId) {
      const site = await this.sites.findOne({
        where: { id: dto.siteId },
        relations: { customer: true },
      });
      if (!site) throw new NotFoundException('Site not found');
      camera.site = site;
      camera.siteId = dto.siteId;
      pathChanged = true;
    }

    if (dto.name !== undefined && dto.name.trim()) {
      camera.name = dto.name.trim();
      pathChanged = true;
    }

    const sourceType = dto.sourceType ?? camera.sourceType;
    const streamChanged =
      (dto.sourceType !== undefined && dto.sourceType !== camera.sourceType) ||
      (dto.demoSource !== undefined && dto.demoSource !== camera.demoSource) ||
      (dto.rtspUrl !== undefined && dto.rtspUrl !== camera.rtspUrl);

    const source = await this.validateSource(
      sourceType,
      dto.demoSource ?? (sourceType === 'demo' ? camera.demoSource : undefined),
      dto.rtspUrl ?? (sourceType === 'rtsp' ? camera.rtspUrl : undefined),
    );
    camera.sourceType = sourceType;
    camera.demoSource = source.demoSource ?? null;
    camera.rtspUrl = source.rtspUrl ?? null;

    let oldPath: string | null = null;
    if (pathChanged) {
      oldPath = camera.path;
      camera.path = await this.makePath(camera.site.name, camera.name);
    }

    const saved = await this.cameras.save(camera);

    if (wasStreaming && (pathChanged || streamChanged)) {
      this.runner.stop(camera.id);
      if (oldPath) {
        try {
          await this.mediamtx.removePath(oldPath);
        } catch {
          // best effort cleanup of the old path
        }
      }
      try {
        await this.lifecycle.provision(saved);
      } catch {
        saved.status = 'offline';
        await this.cameras.save(saved);
      }
    }

    return this.toJson(await this.getEntity(id));
  }

  async start(id: string) {
    const camera = await this.getEntity(id);
    try {
      await this.lifecycle.provision(camera);
    } catch {
      // Keep the UI responsive even if the stream handoff fails.
      camera.status = 'offline';
      await this.cameras.save(camera);
    }
    return this.toJson(await this.getEntity(id));
  }

  async stop(id: string) {
    const camera = await this.getEntity(id);
    await this.lifecycle.stop(camera);
    return this.toJson(await this.getEntity(id));
  }

  async remove(id: string) {
    const camera = await this.getEntity(id);
    await this.lifecycle.deprovision(camera);
    await this.cameras.remove(camera);
    return { deleted: true, id };
  }

  async listDemoSources() {
    return this.videoSources.listDemoSources();
  }

  async uploadDemoSource(file: UploadedVideoFile) {
    return this.videoSources.uploadDemoSource(file);
  }

  async deleteDemoSource(filename: string) {
    const name = String(filename || '').trim();
    const inUse = await this.cameras.count({ where: { demoSource: name } });
    if (inUse > 0) {
      throw new ConflictException(
        `Demo source "${name}" is in use by a camera and cannot be deleted`,
      );
    }

    const result = await this.videoSources.deleteDemoSource(name);
    return { deleted: true, filename: result.filename, sources: result.sources };
  }

  async findAllForCustomer(customerId: string) {
    const cameras = await this.cameras.find({
      relations: { site: { customer: true } },
      order: { name: 'ASC' },
    });
    return cameras
      .filter((camera) => camera.site?.customerId === customerId)
      .map((camera) => this.toJson(camera));
  }

  async getEntity(id: string): Promise<Camera> {
    const camera = await this.cameras.findOne({
      where: { id },
      relations: { site: { customer: true } },
    });
    if (!camera) throw new NotFoundException('Camera not found');
    return camera;
  }

  private async validateSource(
    sourceType: CameraSourceType,
    demoSource?: string,
    rtspUrl?: string,
  ): Promise<{ demoSource?: string; rtspUrl?: string }> {
    if (sourceType === 'rtsp') {
      const url = rtspUrl?.trim();
      if (!url) {
        throw new BadRequestException('rtspUrl is required when sourceType is rtsp');
      }
      return { rtspUrl: url };
    }

    const source = demoSource?.trim();
    if (!source) {
      throw new BadRequestException('demoSource is required when sourceType is demo');
    }
    const available = await this.videoSources.listDemoSources();
    if (!available.includes(source)) {
      throw new BadRequestException(
        `demoSource must be one of the files in /videos: ${available.join(', ') || '(none available)'}`,
      );
    }
    return { demoSource: source };
  }

  /** Flat camera JSON per SPEC, always including relative hlsUrl. */
  private toJson(camera: Camera) {
    const site = camera.site;
    return {
      id: camera.id,
      name: camera.name,
      siteId: camera.siteId,
      sourceType: camera.sourceType,
      demoSource: camera.demoSource ?? null,
      rtspUrl: camera.rtspUrl ?? null,
      path: camera.path,
      status: camera.status,
      createdAt: camera.createdAt ?? null,
      site: site
        ? {
            id: site.id,
            name: site.name,
            customerId: site.customerId,
            customer: site.customer
              ? { id: site.customer.id, name: site.customer.name }
              : null,
          }
        : null,
      hlsUrl: `/api/hls/${camera.path}/index.m3u8`,
    };
  }

  /** `<slug(site.name)>/<slug(camera.name)>-<6-char-id>` */
  private async makePath(siteName: string, cameraName: string): Promise<string> {
    const siteSlug = CamerasService.slug(siteName) || 'site';
    const cameraSlug = CamerasService.slug(cameraName) || 'camera';

    let path = '';
    do {
      path = `${siteSlug}/${cameraSlug}-${randomBytes(3).toString('hex')}`;
    } while (await this.cameras.exist({ where: { path } }));
    return path;
  }

  private static slug(value: string): string {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
