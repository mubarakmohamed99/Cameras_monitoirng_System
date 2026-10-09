import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Customer } from '../customers/entities/customer.entity';
import { Site } from '../sites/entities/site.entity';
import { Camera } from '../cameras/entities/camera.entity';
import { SupportService } from '../support/support.service';
import { ActivityService } from '../activity/activity.service';
import {
  AdminUpdateCustomerDto,
  ResolveIssueDto,
  ResolveResetRequestDto,
  SetCredentialsDto,
} from './dto/admin.dto';

/** A customer is "inactive" when they haven't signed in for this many days. */
const INACTIVE_DAYS = 14;

interface AdminActor {
  sub: string;
  email: string;
}

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(Customer)
    private readonly customers: Repository<Customer>,
    @InjectRepository(Site)
    private readonly sites: Repository<Site>,
    @InjectRepository(Camera)
    private readonly cameras: Repository<Camera>,
    private readonly support: SupportService,
    private readonly activity: ActivityService,
  ) {}

  private isInactive(customer: Customer, now = Date.now()) {
    const threshold = INACTIVE_DAYS * 24 * 60 * 60 * 1000;
    const last = customer.lastLoginAt ?? customer.createdAt;
    return now - new Date(last).getTime() > threshold;
  }

  private summarize(customer: Customer) {
    const sites = customer.sites ?? [];
    const cameras = sites.flatMap((s) => s.cameras ?? []);
    return {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      hasLogin: Boolean(customer.email && customer.passwordHash),
      contactEmail: customer.contactEmail,
      contactPhone: customer.contactPhone,
      notes: customer.notes,
      lastLoginAt: customer.lastLoginAt,
      createdAt: customer.createdAt,
      siteCount: sites.length,
      cameraCount: cameras.length,
      camerasOnline: cameras.filter((c) => c.status === 'online').length,
      camerasOffline: cameras.filter((c) => c.status !== 'online').length,
      inactive: this.isInactive(customer),
    };
  }

  /* ----------------------------- overview ------------------------------- */

  async overview() {
    const [customers, sites, cameras, openIssues, pendingResets] =
      await Promise.all([
        this.customers.find({ relations: { sites: { cameras: true } } }),
        this.sites.count(),
        this.cameras.find(),
        this.support.allIssues('open'),
        this.support.pendingResetRequests(),
      ]);

    return {
      customers: customers.length,
      sites,
      cameras: cameras.length,
      camerasOnline: cameras.filter((c) => c.status === 'online').length,
      camerasOffline: cameras.filter((c) => c.status !== 'online').length,
      openIssues: openIssues.length,
      pendingResetRequests: pendingResets.length,
      inactiveCustomers: customers.filter((c) => this.isInactive(c)).length,
    };
  }

  /* ----------------------------- customers ------------------------------ */

  async listCustomers() {
    const customers = await this.customers.find({
      relations: { sites: { cameras: true } },
      order: { createdAt: 'DESC' },
    });
    return customers.map((c) => this.summarize(c));
  }

  async customerDetail(id: string) {
    const customer = await this.customers.findOne({
      where: { id },
      relations: { sites: { cameras: true } },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    const [issues, activity] = await Promise.all([
      this.support.issuesForCustomer(id),
      this.activity.forCustomer(id),
    ]);
    return { ...this.summarize(customer), sites: customer.sites, issues, activity };
  }

  async updateCustomer(id: string, dto: AdminUpdateCustomerDto) {
    const customer = await this.customers.findOne({ where: { id } });
    if (!customer) throw new NotFoundException('Customer not found');
    if (dto.email !== undefined && dto.email !== customer.email) {
      const email = dto.email.toLowerCase().trim();
      const dupe = await this.customers.findOne({ where: { email } });
      if (dupe && dupe.id !== id) {
        throw new ConflictException('Another customer already uses this email');
      }
      customer.email = email;
    }
    if (dto.name !== undefined) customer.name = dto.name;
    if (dto.contactEmail !== undefined) customer.contactEmail = dto.contactEmail;
    if (dto.contactPhone !== undefined) customer.contactPhone = dto.contactPhone;
    if (dto.notes !== undefined) customer.notes = dto.notes;
    return this.customers.save(customer);
  }

  /**
   * Create or reset a customer's portal credentials. Used when a customer
   * loses their password, can't use forgot-password, or when the admin
   * creates an account for a customer who can't sign up themselves.
   */
  async setCredentials(id: string, dto: SetCredentialsDto, admin: AdminActor) {
    const customer = await this.customers.findOne({ where: { id } });
    if (!customer) throw new NotFoundException('Customer not found');

    if (dto.email) {
      const email = dto.email.toLowerCase().trim();
      const dupe = await this.customers.findOne({ where: { email } });
      if (dupe && dupe.id !== id) {
        throw new ConflictException('Another customer already uses this email');
      }
      customer.email = email;
    }
    if (!customer.email) {
      throw new ConflictException(
        'This customer has no login email — provide one to create credentials',
      );
    }

    customer.passwordHash = await bcrypt.hash(dto.password, 10);
    await this.customers.save(customer);
    await this.support.resolveResetRequestsForCustomer(id);

    await this.activity.log(
      { role: 'admin', id: admin.sub, email: admin.email },
      'admin.customer_credentials_set',
      `Set/reset portal password for ${customer.name} (${customer.email})`,
    );
    return { ok: true, id: customer.id, email: customer.email };
  }

  async deleteCustomer(id: string, admin: AdminActor) {
    const customer = await this.customers.findOne({ where: { id } });
    if (!customer) throw new NotFoundException('Customer not found');
    await this.customers.remove(customer);
    await this.activity.log(
      { role: 'admin', id: admin.sub, email: admin.email },
      'admin.customer_deleted',
      `Deleted customer ${customer.name} and all their sites/cameras`,
    );
    return { deleted: true, id };
  }

  /* ------------------------- password resets ---------------------------- */

  pendingResetRequests() {
    return this.support.pendingResetRequests();
  }

  /** Resolve a reset request by setting a new password for the customer. */
  async resolveResetRequest(
    id: string,
    dto: ResolveResetRequestDto,
    admin: AdminActor,
  ) {
    const pending = await this.support.pendingResetRequests();
    const request = pending.find((r) => r.id === id);
    if (!request) throw new NotFoundException('Reset request not found or already resolved');

    const customer = await this.customers.findOne({
      where: { id: request.customerId },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    customer.passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.customers.save(customer);
    await this.support.resolveResetRequest(id);

    await this.activity.log(
      { role: 'admin', id: admin.sub, email: admin.email },
      'admin.password_reset_resolved',
      `Reset password for ${customer.name} (${customer.email})`,
    );
    return { ok: true, customerId: customer.id, email: customer.email };
  }

  /* ------------------------------- issues ------------------------------- */

  issues(status?: 'open' | 'resolved') {
    return this.support.allIssues(status);
  }

  async resolveIssue(id: string, dto: ResolveIssueDto, admin: AdminActor) {
    const issue = await this.support.resolveIssue(id, dto.note);
    await this.activity.log(
      { role: 'admin', id: admin.sub, email: admin.email },
      'admin.issue_resolved',
      `Resolved issue "${issue.subject}" from ${issue.customer?.name ?? 'customer'}`,
    );
    return issue;
  }

  reopenIssue(id: string) {
    return this.support.reopenIssue(id);
  }

  /* ------------------------------ activity ------------------------------ */

  recentActivity(limit = 100) {
    return this.activity.recent(limit);
  }
}
