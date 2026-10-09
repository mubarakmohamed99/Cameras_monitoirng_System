import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('database.host'),
        port: config.get<number>('database.port'),
        username: config.get<string>('database.username'),
        password: config.get<string>('database.password'),
        database: config.get<string>('database.database'),
        autoLoadEntities: true,
        synchronize: true, // prototype only; use migrations in production
        // gen_random_uuid() is core since PG13; avoids uuid-ossp extension
        uuidExtension: 'pgcrypto',
        // backend must survive postgres boot
        retryAttempts: 20,
        retryDelay: 3000,
      }),
    }),
  ],
})
export class DatabaseModule {}
