import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Audit trail of everything customers and admins do, so the admin can
 * see "who did what and when" (logins, signups, site/camera changes,
 * support activity...).
 */
@Entity('activity_log')
export class ActivityLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 'admin' | 'customer' | 'system' */
  @Column()
  actorRole: string;

  @Column({ type: 'uuid', nullable: true })
  actorId: string;

  @Column({ nullable: true })
  actorEmail: string;

  /** Machine-readable action, e.g. 'customer.registered', 'camera.created'. */
  @Column()
  action: string;

  /** Human-readable detail line, e.g. 'Added camera "Front Gate" to site "HQ Berlin"'. */
  @Column({ type: 'text', nullable: true })
  detail: string;

  @CreateDateColumn()
  createdAt: Date;
}
