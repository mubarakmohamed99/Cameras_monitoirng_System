import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Customer } from '../../customers/entities/customer.entity';
import { Camera } from '../../cameras/entities/camera.entity';

@Entity('sites')
export class Site {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  address: string;

  /** Name of the person who owns / is responsible for this site. */
  @Column({ nullable: true })
  owner: string;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => Customer, (customer) => customer.sites, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'customerId' })
  customer: Customer;

  @Column('uuid')
  customerId: string;

  @OneToMany(() => Camera, (camera) => camera.site, { cascade: true })
  cameras: Camera[];
}
