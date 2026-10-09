import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Site } from '../../sites/entities/site.entity';

@Entity('customers')
export class Customer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  /** Login email for the customer portal. Null = record only, no login yet. */
  @Column({ unique: true, nullable: true })
  email: string;

  /** bcrypt hash of the portal password. Null until credentials are set. */
  @Column({ nullable: true })
  passwordHash: string;

  @Column({ nullable: true })
  contactEmail: string;

  @Column({ nullable: true })
  contactPhone: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  /** Last successful customer-portal login (null = never logged in). */
  @Column({ nullable: true })
  lastLoginAt: Date;

  @OneToMany(() => Site, (site) => site.customer, { cascade: true })
  sites: Site[];

  @CreateDateColumn()
  createdAt: Date;
}
