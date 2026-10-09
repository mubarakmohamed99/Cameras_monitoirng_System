import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ActivityLog } from './entities/activity-log.entity';

export interface ActivityActor {
  role: 'admin' | 'customer' | 'system';
  id?: string | null;
  email?: string | null;
}

@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(
    @InjectRepository(ActivityLog)
    private readonly logs: Repository<ActivityLog>,
  ) {}

  /** Fire-and-forget audit entry; never breaks the calling request. */
  async log(actor: ActivityActor, action: string, detail?: string) {
    try {
      await this.logs.save(
        this.logs.create({
          actorRole: actor.role,
          actorId: actor.id ?? null,
          actorEmail: actor.email ?? null,
          action,
          detail: detail ?? null,
        }),
      );
    } catch (err) {
      this.logger.warn(`Failed to write activity log: ${err}`);
    }
  }

  recent(limit = 100) {
    return this.logs.find({
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 500),
    });
  }

  /** Recent activity for one customer (portal "my activity" or admin detail). */
  forCustomer(customerId: string, limit = 50) {
    return this.logs.find({
      where: { actorRole: 'customer', actorId: customerId },
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 200),
    });
  }
}
