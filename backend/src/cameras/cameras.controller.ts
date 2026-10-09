import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CamerasService } from './cameras.service';
import { CreateCameraDto } from './dto/create-camera.dto';
import { UploadedVideoFile } from '../streaming/video-sources.service';
import { Roles } from '../auth/decorators/roles.decorator';

@Roles('admin', 'viewer')
@Controller('cameras')
export class CamerasController {
  constructor(private readonly cameras: CamerasService) {}

  @Post()
  create(@Body() dto: CreateCameraDto) {
    return this.cameras.create(dto);
  }

  @Get()
  findAll() {
    return this.cameras.findAll();
  }

  @Get('demo-sources')
  demoSources() {
    return this.cameras.listDemoSources();
  }

  @Post('demo-sources/upload')
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: {
      fileSize: 250 * 1024 * 1024,
    },
  }))
  uploadDemoSource(@UploadedFile() file?: UploadedVideoFile) {
    if (!file) {
      throw new BadRequestException('Video file is required');
    }

    return this.cameras.uploadDemoSource(file);
  }

  @Delete('demo-sources/:filename')
  deleteDemoSource(@Param('filename') filename: string) {
    return this.cameras.deleteDemoSource(filename);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.cameras.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Partial<CreateCameraDto>,
  ) {
    return this.cameras.update(id, dto);
  }

  @Post(':id/start')
  start(@Param('id', ParseUUIDPipe) id: string) {
    return this.cameras.start(id);
  }

  @Post(':id/stop')
  stop(@Param('id', ParseUUIDPipe) id: string) {
    return this.cameras.stop(id);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.cameras.remove(id);
  }
}
