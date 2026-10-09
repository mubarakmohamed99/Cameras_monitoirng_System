import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateSiteDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  owner?: string;

  @IsUUID()
  customerId: string;
}
