import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Customer } from '../../customers/entities/customer.entity';

export type ResetRequestStatus = 'pending' | 'resolved';

/**
 * Created when a customer uses "Forgot password" on the portal.
 * The prototype has no mail server, so the admin resolves the request
 * from the admin console by setting a new password for the customer.
 */
@Entity('password_reset_requests')
export class PasswordResetRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  customerId: string;

  @ManyToOne(() => Customer, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customerId' })
  customer: Customer;

  /** Email the customer typed on the forgot-password form. */
  @Column()
  email: string;

  @Column({ type: 'varchar', default: 'pending' })
  status: ResetRequestStatus;

  @Column({ nullable: true })
  resolvedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
