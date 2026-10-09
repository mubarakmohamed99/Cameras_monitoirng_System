import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ConfigModule } from '@nestjs/config';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import env from './config/env';

import { DatabaseModule } from './database/database.module';
import { ActivityModule } from './activity/activity.module';
import { AuthModule } from './auth/auth.module';
import { CustomersModule } from './customers/customers.module';
import { SitesModule } from './sites/sites.module';
import { CamerasModule } from './cameras/cameras.module';
import { StreamingModule } from './streaming/streaming.module';
import { PortalModule } from './portal/portal.module';
import { AdminModule } from './admin/admin.module';

/** Pick the first existing candidate so the app works in docker and dev. */
function firstExisting(candidates: string[]): string {
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

const frontendRoot = firstExisting([
  join(process.cwd(), 'public', 'frontend'), // docker: /app/public/frontend
  join(process.cwd(), '..', 'frontend'), // repo dev when cwd = backend/
  join(process.cwd(), 'frontend'),
]);

const videosRoot = firstExisting([
  process.env.VIDEOS_DIR || '/videos', // docker volume mount
  join(process.cwd(), '..', 'videos'), // repo dev when cwd = backend/
  join(process.cwd(), 'videos'),
]);

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: frontendRoot,
      // SPA-ish fallback to index.html for any non-API/non-video GET.
      exclude: ['/api/(.*)', '/videos/(.*)'],
    }),
    ServeStaticModule.forRoot({
      rootPath: videosRoot,
      serveRoot: '/videos',
      // never render an index.html for the videos mount
      renderPath: '/__videos_no_index__',
    }),

    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        resolve(process.cwd(), '.env'), // docker: /app/.env (env_file) / backend dev
        resolve(process.cwd(), '..', '.env'), // repo-root .env when cwd = backend/
      ],
      load: [env],
    }),

    DatabaseModule,
    ActivityModule,
    AuthModule,
    CustomersModule,
    SitesModule,
    CamerasModule,
    StreamingModule,
    PortalModule,
    AdminModule,
  ],

  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
