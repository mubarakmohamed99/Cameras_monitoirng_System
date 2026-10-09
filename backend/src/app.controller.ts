import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Public } from './auth/decorators/public.decorator';
import { MediaMTXService } from './streaming/mediamtx.service';

@Controller()
export class AppController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly mediamtx: MediaMTXService,
  ) {}

  @Public()
  @Get('health')
  async health() {
    let db: 'up' | 'down' = 'up';
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      db = 'down';
    }

    const mediamtxUp = await this.mediamtx.isUp();

    return {
      status: 'ok',
      db,
      mediamtx: mediamtxUp ? 'up' : 'down',
      time: new Date().toISOString(),
    };
  }
}
