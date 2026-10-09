import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ChildProcess, spawn } from 'node:child_process';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { Camera } from '../cameras/entities/camera.entity';

@Injectable()
export class FFmpegRunnerService implements OnModuleDestroy {
  private readonly logger = new Logger(FFmpegRunnerService.name);
  private readonly processes = new Map<string, ChildProcess>();
  private readonly rtspUrl: string;
  private readonly videosDir: string;

  constructor(private readonly config: ConfigService) {
    this.rtspUrl = this.buildPublishUrl();
    this.videosDir = this.config.get<string>('videos.dir') || '/videos';
  }

  /** RTSP base URL with publish credentials embedded (mediamtx requires auth to publish). */
  private buildPublishUrl(): string {
    const base = this.config.get<string>('mediamtx.rtspUrl') || 'rtsp://localhost:8554';
    const user = this.config.get<string>('mediamtx.apiUser') || 'admin';
    const password = this.config.get<string>('mediamtx.apiPassword') || 'admin123';
    try {
      const url = new URL(base);
      if (!url.username && (user || password)) {
        url.username = encodeURIComponent(user);
        url.password = encodeURIComponent(password);
      }
      return url.toString().replace(/\/+$/, '');
    } catch {
      return base.replace(/\/+$/, '');
    }
  }

  /** True when a publisher process for this camera is tracked and alive. */
  has(cameraId: string): boolean {
    const proc = this.processes.get(cameraId);
    return Boolean(proc && proc.exitCode === null && !proc.killed);
  }

  startDemo(camera: Camera): void {
    if (this.has(camera.id)) return;

    const args = [
      '-re',
      '-stream_loop', '-1',
      '-i', join(this.videosDir, camera.demoSource),
      '-c', 'copy',
      '-rtsp_transport', 'tcp',
      '-f', 'rtsp',
      `${this.rtspUrl}/${camera.path}`,
    ];

    const proc = spawn('ffmpeg', args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    proc.stderr?.on('data', (data) => {
      this.logger.debug(`ffmpeg[${camera.name}]: ${String(data).trim()}`);
    });

    proc.on('error', (err) => {
      this.processes.delete(camera.id);
      this.logger.error(`ffmpeg[${camera.name}] error: ${err.message}`);
    });

    proc.on('exit', (code) => {
      this.processes.delete(camera.id);
      this.logger.warn(`ffmpeg[${camera.name}] exited (code ${code})`);
    });

    this.processes.set(camera.id, proc);
  }

  stop(cameraId: string): void {
    const proc = this.processes.get(cameraId);
    if (proc) {
      proc.kill('SIGKILL');
      this.processes.delete(cameraId);
    }
  }

  onModuleDestroy() {
    for (const proc of this.processes.values()) {
      proc.kill('SIGKILL');
    }
    this.processes.clear();
  }
}
