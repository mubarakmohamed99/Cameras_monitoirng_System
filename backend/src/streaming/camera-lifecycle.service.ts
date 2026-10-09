import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Camera } from '../cameras/entities/camera.entity';
import { MediaMTXService } from './mediamtx.service';
import { FFmpegRunnerService } from './ffmpeg-runner.service';

const POLL_INTERVAL_MS = 8000;

/**
 * Owns the camera streaming state machine:
 * create/start -> provision, stop -> stop publisher (path kept),
 * delete -> deprovision. Reconciles DB status with MediaMTX path
 * `ready` state every 8s and respawns dead demo publishers.
 *
 * `desiredStreaming` tracks intent in memory (rebuilt from DB on boot):
 * the poller only respawns/promotes cameras that are meant to stream, so a
 * deliberately stopped camera is never flipped back online by a MediaMTX
 * path that is (still) ready.
 */
@Injectable()
export class CameraLifecycleService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CameraLifecycleService.name);
  private readonly desiredStreaming = new Set<string>();
  private readonly inProcessPublisher: boolean;
  private poller: NodeJS.Timeout | null = null;
  private polling = false;

  constructor(
    @InjectRepository(Camera)
    private readonly cameras: Repository<Camera>,
    private readonly mediamtx: MediaMTXService,
    private readonly runner: FFmpegRunnerService,
    private readonly config: ConfigService,
  ) {
    // external (default): a separate demo-publisher process opens the RTSP
    // connection outward and pushes; the backend never runs FFmpeg.
    this.inProcessPublisher =
      this.config.get<string>('demo.publisherMode') === 'inprocess';
  }

  /**
   * Add the MediaMTX path (with source for rtsp pull mode) and, for demo
   * cameras, start the FFmpeg publisher. Status becomes 'pending'; the
   * poller flips it to 'online' once MediaMTX reports the path ready.
   */
  async provision(camera: Camera): Promise<Camera> {
    await this.mediamtx.addPath(
      camera.path,
      camera.sourceType === 'rtsp' ? camera.rtspUrl : undefined,
    );

    if (camera.sourceType === 'demo' && camera.demoSource && this.inProcessPublisher) {
      this.runner.startDemo(camera);
    }

    this.desiredStreaming.add(camera.id);
    camera.status = 'pending';
    return this.cameras.save(camera);
  }

  /** Stop the publisher, remove the MediaMTX path, mark offline. */
  async deprovision(camera: Camera): Promise<void> {
    this.desiredStreaming.delete(camera.id);
    this.runner.stop(camera.id);
    try {
      await this.mediamtx.removePath(camera.path);
    } catch (err) {
      this.logger.warn(`removePath(${camera.path}) failed: ${(err as Error).message}`);
    }
    camera.status = 'offline';
    await this.cameras.save(camera);
  }

  /**
   * Stop publisher + mark offline, but keep the MediaMTX path so the
   * camera can be restarted without reconfiguration.
   */
  async stop(camera: Camera): Promise<Camera> {
    this.desiredStreaming.delete(camera.id);
    this.runner.stop(camera.id);
    camera.status = 'offline';
    return this.cameras.save(camera);
  }

  /**
   * Restart reconciliation: re-add every path (idempotent) and restart
   * publishers for demo cameras that were online before the restart.
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.reconcileAfterRestart();
    this.poller = setInterval(() => {
      void this.poll().catch((err) =>
        this.logger.warn(`status poll failed: ${(err as Error).message}`),
      );
    }, POLL_INTERVAL_MS);
    this.poller.unref?.();
  }

  onModuleDestroy(): void {
    if (this.poller) {
      clearInterval(this.poller);
      this.poller = null;
    }
  }

  private async reconcileAfterRestart(): Promise<void> {
    const cameras = await this.cameras.find();
    for (const camera of cameras) {
      try {
        await this.mediamtx.addPath(
          camera.path,
          camera.sourceType === 'rtsp' ? camera.rtspUrl : undefined,
        );
      } catch (err) {
        this.logger.warn(`re-add path ${camera.path} failed: ${(err as Error).message}`);
      }

      if (
        camera.sourceType === 'demo' &&
        camera.status === 'online' &&
        camera.demoSource &&
        this.inProcessPublisher
      ) {
        this.runner.startDemo(camera);
        this.desiredStreaming.add(camera.id);
        camera.status = 'pending'; // poller flips to online when ready
      } else if (camera.status === 'online' && camera.sourceType === 'demo') {
        // external publisher mode: publisher process pushes on its own
        this.desiredStreaming.add(camera.id);
        camera.status = 'pending';
      } else if (camera.status !== 'offline') {
        this.desiredStreaming.delete(camera.id);
        camera.status = 'offline';
      } else {
        this.desiredStreaming.delete(camera.id);
      }
      await this.cameras.save(camera);
    }
  }

  /** Sync DB status with MediaMTX `ready`; respawn dead demo publishers. */
  private async poll(): Promise<void> {
    if (this.polling) return; // avoid overlapping polls
    this.polling = true;
    try {
      const cameras = await this.cameras.find();
      for (const camera of cameras) {
        await this.pollCamera(camera);
      }
    } finally {
      this.polling = false;
    }
  }

  private async pollCamera(camera: Camera): Promise<void> {
    const desired = this.desiredStreaming.has(camera.id);

    // Respawn demo publisher when it should be streaming but the process died
    // (in-process mode only — in external mode the publisher process owns this).
    if (
      this.inProcessPublisher &&
      desired &&
      camera.sourceType === 'demo' &&
      camera.demoSource &&
      !this.runner.has(camera.id)
    ) {
      this.logger.warn(`respawning dead publisher for camera ${camera.name} (${camera.id})`);
      this.runner.startDemo(camera);
    }

    let ready: boolean;
    try {
      const path = await this.mediamtx.getPath(camera.path);
      ready = Boolean(path?.ready);
    } catch {
      return; // MediaMTX unreachable; leave DB status untouched
    }

    // Promote to online only when the camera is meant to stream and the
    // path is ready; demote online cameras whose path is no longer ready.
    if (ready && desired && camera.status !== 'online') {
      camera.status = 'online';
    } else if (!ready && camera.status === 'online') {
      camera.status = 'offline';
    } else {
      return;
    }

    await this.cameras.save(camera);
    this.logger.log(`camera ${camera.name} (${camera.id}) status -> ${camera.status}`);
  }
}
