import {
  Controller,
  Get,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { In, Repository } from 'typeorm';
import { Camera } from '../cameras/entities/camera.entity';
import { Public } from '../auth/decorators/public.decorator';

/**
 * Internal work-list for the STANDALONE demo publisher process.
 *
 * Real customer sites push RTSP outward to MediaMTX; the separate
 * demo-publisher container simulates such a site. It polls this
 * endpoint (authenticated with a shared key, not a user JWT) to learn
 * which demo cameras should be streaming, then opens the RTSP
 * connections outward itself. The backend never runs FFmpeg.
 *
 * A camera "should stream" when its status is pending/online:
 *  - create/start  -> status 'pending' (lifecycle flips to 'online' once ready)
 *  - stop          -> status 'offline' (publisher must stop pushing)
 */
@Controller('internal')
export class InternalPublisherController {
  constructor(
    @InjectRepository(Camera)
    private readonly cameras: Repository<Camera>,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get('demo-cameras')
  async demoCameras(@Headers('x-publisher-key') key?: string) {
    const expected =
      this.config.get<string>('internal.publisherKey') || 'dev-publisher-key';
    if (!key || key !== expected) {
      throw new UnauthorizedException('invalid publisher key');
    }

    const cameras = await this.cameras.find({
      where: { sourceType: 'demo', status: In(['pending', 'online']) },
    });

    return cameras
      .filter((c) => Boolean(c.demoSource))
      .map((c) => ({
        id: c.id,
        path: c.path,
        demoSource: c.demoSource,
      }));
  }
}
