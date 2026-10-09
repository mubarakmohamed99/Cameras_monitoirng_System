import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MediaMTXService {
  private readonly logger = new Logger(MediaMTXService.name);
  private readonly apiUrl: string;
  private readonly apiUser: string;
  private readonly apiPassword: string;

  constructor(private readonly config: ConfigService) {
    this.apiUrl = (this.config.get<string>('mediamtx.apiUrl') || 'http://localhost:9997').replace(/\/+$/, '');
    this.apiUser = this.config.get<string>('mediamtx.apiUser') || 'admin';
    this.apiPassword = this.config.get<string>('mediamtx.apiPassword') || 'admin123';
  }

  private buildHeaders(extra: Record<string, string> = {}) {
    const headers = { ...extra };
    if (this.apiUser || this.apiPassword) {
      headers.Authorization = `Basic ${Buffer.from(`${this.apiUser}:${this.apiPassword}`).toString('base64')}`;
    }
    return headers;
  }

  /** Encode each segment of a (possibly nested) path, keeping '/' literal. */
  private encodePath(name: string): string {
    return name.split('/').map(encodeURIComponent).join('/');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Create a MediaMTX path via the control API.
   * demo -> body {} (publisher mode); rtsp -> body { source } (pull mode).
   * Retries 3x with 1s backoff; 409 (already exists) is ok.
   */
  async addPath(name: string, source?: string): Promise<void> {
    const body = source ? JSON.stringify({ source }) : '{}';
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(`${this.apiUrl}/v3/config/paths/add/${this.encodePath(name)}`, {
          method: 'POST',
          headers: this.buildHeaders({ 'Content-Type': 'application/json' }),
          body,
        });

        if (res.ok || res.status === 409) return;

        const text = await res.text();
        // some mediamtx versions answer 400 {"error":"path already exists"} instead of 409
        if (res.status === 400 && text.includes('already exists')) return;

        throw new Error(`MediaMTX add path failed: ${res.status} ${text}`);
      } catch (err) {
        lastError = err as Error;
        if (attempt < 3) {
          this.logger.warn(`addPath(${name}) attempt ${attempt} failed: ${lastError.message}; retrying in 1s`);
          await this.sleep(1000);
        }
      }
    }

    throw lastError ?? new Error(`MediaMTX add path failed for ${name}`);
  }

  async removePath(name: string): Promise<void> {
    const res = await fetch(`${this.apiUrl}/v3/config/paths/delete/${this.encodePath(name)}`, {
      method: 'DELETE',
      headers: this.buildHeaders(),
    });

    if (!res.ok && res.status !== 404) {
      throw new Error(`MediaMTX remove path failed: ${res.status} ${await res.text()}`);
    }
  }

  async getPath(name: string): Promise<{ ready: boolean } | null> {
    const res = await fetch(`${this.apiUrl}/v3/paths/get/${this.encodePath(name)}`, {
      headers: this.buildHeaders(),
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`MediaMTX get path failed: ${res.status}`);
    }

    const data = (await res.json()) as { ready?: boolean };
    return { ready: Boolean(data.ready) };
  }

  /** True when the MediaMTX control API answers. */
  async isUp(): Promise<boolean> {
    try {
      const res = await fetch(`${this.apiUrl}/v3/paths/list`, {
        headers: this.buildHeaders(),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
