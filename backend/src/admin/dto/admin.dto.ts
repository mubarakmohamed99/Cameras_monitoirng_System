import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SetCredentialsDto {
  /** New login email (optional — keep current when omitted). */
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsString()
  @MinLength(6)
  password: string;
}

export class ResolveResetRequestDto {
  @IsString()
  @MinLength(6)
  newPassword: string;
}

export class ResolveIssueDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string;
}

export class AdminUpdateCustomerDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
