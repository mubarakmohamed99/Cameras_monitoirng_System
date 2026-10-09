import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { Site } from '../sites/entities/site.entity';
import { Camera } from '../cameras/entities/camera.entity';
import { SupportModule } from '../support/support.module';
import { ActivityModule } from '../activity/activity.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Customer, Site, Camera]),
    SupportModule,
    ActivityModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
