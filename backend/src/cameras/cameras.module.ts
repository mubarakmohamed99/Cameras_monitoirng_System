import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Camera } from './entities/camera.entity';
import { Site } from '../sites/entities/site.entity';
import { CamerasController } from './cameras.controller';
import { CamerasService } from './cameras.service';
import { StreamingModule } from '../streaming/streaming.module';

@Module({
  imports: [TypeOrmModule.forFeature([Camera, Site]), StreamingModule],
  controllers: [CamerasController],
  providers: [CamerasService],
  exports: [CamerasService],
})
export class CamerasModule {}
