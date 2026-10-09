import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SupportIssue } from './entities/support-issue.entity';
import { PasswordResetRequest } from './entities/password-reset-request.entity';
import { SupportService } from './support.service';

@Module({
  imports: [TypeOrmModule.forFeature([SupportIssue, PasswordResetRequest])],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
