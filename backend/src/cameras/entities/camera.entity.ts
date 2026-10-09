import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Site } from '../../sites/entities/site.entity';

export type CameraStatus = 'online' | 'offline' | 'pending';
export type CameraSourceType = 'demo' | 'rtsp';

@Entity('cameras')
export class Camera {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column('uuid')
  siteId: string;

  @ManyToOne(() => Site, (site) => site.cameras, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'siteId' })
  site: Site;

  @Column({ type: 'varchar', default: 'demo' })
  sourceType: CameraSourceType;

  @Column({ nullable: true })
  demoSource: string;

  @Column({ nullable: true })
  rtspUrl: string;

  @Column({ unique: true })
  path: string;

  @Column({ type: 'varchar', default: 'offline' })
  status: CameraStatus;

  @CreateDateColumn()
  createdAt: Date;
}
