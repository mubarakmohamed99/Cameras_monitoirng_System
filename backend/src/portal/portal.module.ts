import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { Site } from '../sites/entities/site.entity';
import { SitesModule } from '../sites/sites.module';
import { CamerasModule } from '../cameras/cameras.module';
import { SupportModule } from '../support/support.module';
import { ActivityModule } from '../activity/activity.module';
import { AuthModule } from '../auth/auth.module';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Customer, Site]),
    SitesModule,
    CamerasModule,
    SupportModule,
    ActivityModule,
    AuthModule,
  ],
  controllers: [PortalController],
  providers: [PortalService],
})
export class PortalModule {}
