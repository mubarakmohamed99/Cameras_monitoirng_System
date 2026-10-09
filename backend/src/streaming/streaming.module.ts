import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Camera } from '../cameras/entities/camera.entity';
import { FFmpegRunnerService } from './ffmpeg-runner.service';
import { MediaMTXService } from './mediamtx.service';
import { VideoSourcesService } from './video-sources.service';
import { CameraLifecycleService } from './camera-lifecycle.service';
import { HlsProxyController } from './hls-proxy.controller';
import { InternalPublisherController } from './internal-publisher.controller';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([Camera])],
  controllers: [HlsProxyController, InternalPublisherController],
  providers: [MediaMTXService, FFmpegRunnerService, VideoSourcesService, CameraLifecycleService],
  exports: [MediaMTXService, FFmpegRunnerService, VideoSourcesService, CameraLifecycleService],
})
export class StreamingModule {}
