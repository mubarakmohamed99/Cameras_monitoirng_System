import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreatePortalSiteDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  /** Site area / location, e.g. "North Warehouse, Berlin". */
  @IsOptional()
  @IsString()
  address?: string;

  /** Site owner / responsible person. */
  @IsOptional()
  @IsString()
  owner?: string;
}

export class UpdatePortalSiteDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  owner?: string;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateIssueDto {
  @IsIn(['camera-view', 'login', 'password', 'editing', 'other'])
  category: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  subject: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(4000)
  message: string;
}
