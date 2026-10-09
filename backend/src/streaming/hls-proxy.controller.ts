import { Controller, Get, Logger, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { Public } from '../auth/decorators/public.decorator';

/**
 * Public HLS proxy: GET /api/hls/** -> ${MEDIAMTX_HLS_INTERNAL}/**.
 * Lets a single tunnel (port 3000) serve UI + API + HLS.
 */
@Public()
@Controller('hls')
export class HlsProxyController {
  private readonly logger = new Logger(HlsProxyController.name);
  private readonly hlsInternal: string;
  private readonly authHeader: string;

  constructor(config: ConfigService) {
    this.hlsInternal = (config.get<string>('mediamtx.hlsInternal') || 'http://localhost:8888').replace(/\/+$/, '');
    const user = config.get<string>('mediamtx.apiUser') || 'admin';
    const password = config.get<string>('mediamtx.apiPassword') || 'admin123';
    this.authHeader = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
  }

  @Get('*')
  async proxy(@Req() req: Request, @Res() res: Response): Promise<void> {
    // Strip the "/api/hls" mount prefix; keep nested segment paths intact.
    const rest = req.path.replace(/^\/api\/hls\/?/, '');
    const queryIndex = req.originalUrl.indexOf('?');
    const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : '';
    const target = `${this.hlsInternal}/${rest}${query}`;

    let upstream: globalThis.Response;
    try {
      upstream = await fetch(target, {
        headers: { Authorization: this.authHeader },
      });
    } catch (err) {
      this.logger.warn(`HLS proxy fetch failed for ${target}: ${(err as Error).message}`);
      res.status(502).json({ statusCode: 502, message: 'HLS upstream unreachable' });
      return;
    }

    res.status(upstream.status);
    const contentType = upstream.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    const contentLength = upstream.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);
    res.setHeader('Cache-Control', 'no-store');

    if (!upstream.body) {
      res.end();
      return;
    }

    const stream = Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream);
    stream.on('error', (err) => {
      this.logger.warn(`HLS proxy stream error for ${target}: ${err.message}`);
      res.destroy(err);
    });
    stream.pipe(res);
  }
}
