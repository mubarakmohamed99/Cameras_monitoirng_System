import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupportIssue } from './entities/support-issue.entity';
import { PasswordResetRequest } from './entities/password-reset-request.entity';

@Injectable()
export class SupportService {
  constructor(
    @InjectRepository(SupportIssue)
    private readonly issues: Repository<SupportIssue>,
    @InjectRepository(PasswordResetRequest)
    private readonly resetRequests: Repository<PasswordResetRequest>,
  ) {}

  /* ------------------------------- issues ------------------------------- */

  createIssue(data: {
    customerId: string;
    category: string;
    subject: string;
    message: string;
  }) {
    return this.issues.save(this.issues.create({ ...data, status: 'open' }));
  }

  issuesForCustomer(customerId: string) {
    return this.issues.find({
      where: { customerId },
      order: { createdAt: 'DESC' },
    });
  }

  allIssues(status?: 'open' | 'resolved') {
    return this.issues.find({
      where: status ? { status } : {},
      relations: { customer: true },
      order: { createdAt: 'DESC' },
    });
  }

  async resolveIssue(id: string, adminNote?: string) {
    const issue = await this.issues.findOne({
      where: { id },
      relations: { customer: true },
    });
    if (!issue) throw new NotFoundException('Issue not found');
    issue.status = 'resolved';
    issue.adminNote = adminNote ?? issue.adminNote;
    issue.resolvedAt = new Date();
    return this.issues.save(issue);
  }

  async reopenIssue(id: string) {
    const issue = await this.issues.findOne({ where: { id } });
    if (!issue) throw new NotFoundException('Issue not found');
    issue.status = 'open';
    issue.resolvedAt = null;
    return this.issues.save(issue);
  }

  /* -------------------------- reset requests ---------------------------- */

  async createResetRequest(customerId: string, email: string) {
    // Don't stack duplicate pending requests for the same customer.
    const existing = await this.resetRequests.findOne({
      where: { customerId, status: 'pending' },
    });
    if (existing) return existing;
    return this.resetRequests.save(
      this.resetRequests.create({ customerId, email, status: 'pending' }),
    );
  }

  pendingResetRequests() {
    return this.resetRequests.find({
      where: { status: 'pending' },
      relations: { customer: true },
      order: { createdAt: 'DESC' },
    });
  }

  async resolveResetRequest(id: string) {
    const req = await this.resetRequests.findOne({
      where: { id },
      relations: { customer: true },
    });
    if (!req) throw new NotFoundException('Reset request not found');
    req.status = 'resolved';
    req.resolvedAt = new Date();
    return this.resetRequests.save(req);
  }

  /** Mark every pending request for a customer as resolved. */
  async resolveResetRequestsForCustomer(customerId: string) {
    await this.resetRequests.update(
      { customerId, status: 'pending' },
      { status: 'resolved', resolvedAt: new Date() },
    );
  }
}
