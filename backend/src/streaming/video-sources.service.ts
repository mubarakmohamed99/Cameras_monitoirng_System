import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { tmpdir } from 'node:os';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.ts']);

export interface UploadedVideoFile {
  originalname: string;
  buffer: Buffer;
}

@Injectable()
export class VideoSourcesService {
  constructor(private readonly config: ConfigService) {}

  private getVideosDir() {
    return this.config.get<string>('videos.dir') || '/videos';
  }

  async listDemoSources(): Promise<string[]> {
    const videosDir = this.getVideosDir();

    try {
      const entries = await fs.readdir(videosDir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((name) => VIDEO_EXTENSIONS.has(extname(name).toLowerCase()))
        .sort((left, right) => left.localeCompare(right));
    } catch {
      return [];
    }
  }

  async resolveDemoSource(preferred?: string): Promise<string | undefined> {
    const available = await this.listDemoSources();
    if (!available.length) return preferred?.trim() || undefined;

    const trimmed = preferred?.trim();
    if (trimmed && available.includes(trimmed)) {
      return trimmed;
    }

    return available[0];
  }

  async uploadDemoSource(file: UploadedVideoFile): Promise<{ filename: string; sources: string[] }> {
    if (!file) {
      throw new BadRequestException('Video file is required');
    }

    const extension = extname(file.originalname || '').toLowerCase();
    if (!extension || !VIDEO_EXTENSIONS.has(extension)) {
      throw new BadRequestException('Only video files can be uploaded');
    }

    const videosDir = this.getVideosDir();
    await fs.mkdir(videosDir, { recursive: true });

    const baseName = basename(file.originalname, extension)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'uploaded-video';

    const filename = `${baseName}-${Date.now()}${extension}`;

    const tempInput = join(tmpdir(), `${filename}.upload${extension}`);
    const finalOutput = join(videosDir, filename);

    await fs.writeFile(tempInput, file.buffer);
    await this.normalizeVideoFile(tempInput, finalOutput);
    await fs.rm(tempInput, { force: true });

    return {
      filename,
      sources: await this.listDemoSources(),
    };
  }

  async deleteDemoSource(filename: string): Promise<{ filename: string; sources: string[] }> {
    const name = String(filename || '').trim();
    if (!name || name !== basename(name)) {
      throw new BadRequestException('Invalid demo source filename');
    }
    if (!VIDEO_EXTENSIONS.has(extname(name).toLowerCase())) {
      throw new BadRequestException('Only video files can be deleted');
    }

    const videosDir = this.getVideosDir();
    const filePath = join(videosDir, name);

    try {
      await fs.rm(filePath);
    } catch {
      throw new NotFoundException(`Demo source not found in /videos: ${name}`);
    }

    return {
      filename: name,
      sources: await this.listDemoSources(),
    };
  }

  private normalizeVideoFile(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        '-y',
        '-i',
        inputPath,
        '-map',
        '0:v:0',
        '-map',
        '0:a?',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-preset',
        'veryfast',
        '-movflags',
        '+faststart',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        outputPath,
      ];

      const proc = spawn('ffmpeg', args, {
        stdio: ['ignore', 'ignore', 'pipe'],
      });

      let errorText = '';
      proc.stderr?.on('data', (data) => {
        errorText += String(data);
      });

      proc.on('error', (err) => {
        reject(err);
      });

      proc.on('exit', (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(`ffmpeg normalize failed (code ${code}): ${errorText}`));
      });
    });
  }
}
