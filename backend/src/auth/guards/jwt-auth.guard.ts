import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const auth = request.headers['authorization'];
    const [type, bearerToken] = auth?.split(' ') ?? [];
    // Also accept ?access_token= for clients that cannot set headers
    // (e.g. <video>/HLS element requests).
    const queryToken = request.query?.access_token;
    const token = type === 'Bearer' && bearerToken ? bearerToken : queryToken;
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }
    try {
      const payload = await this.jwtService.verifyAsync(token);
      request.user = payload; // { sub, email, role }
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    return true;
  }
}
