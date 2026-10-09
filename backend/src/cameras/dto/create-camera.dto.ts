import { IsIn, IsNotEmpty, IsOptional, IsString, IsUrl, IsUUID } from 'class-validator';

export class CreateCameraDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsUUID()
  siteId: string;

  @IsOptional()
  @IsIn(['demo', 'rtsp'])
  sourceType?: 'demo' | 'rtsp';

  @IsOptional()
  @IsString()
  demoSource?: string;

  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['rtsp', 'rtsps', 'http', 'https'] })
  rtspUrl?: string;
}
