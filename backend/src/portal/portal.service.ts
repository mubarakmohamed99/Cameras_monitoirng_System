import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { Site } from '../sites/entities/site.entity';
import { SitesService } from '../sites/sites.service';
import { CamerasService } from '../cameras/cameras.service';
import { CreateCameraDto } from '../cameras/dto/create-camera.dto';
import { SupportService } from '../support/support.service';
import { ActivityService } from '../activity/activity.service';
import { AuthService } from '../auth/auth.service';
import { ChangePasswordDto } from '../auth/dto/change-password.dto';
import {
  CreateIssueDto,
  CreatePortalSiteDto,
  UpdatePortalSiteDto,
  UpdateProfileDto,
} from './dto/portal.dto';

/**
 * Customer self-service. Every query is scoped to the logged-in customer's
 * own customerId — a customer can never see or touch another customer's
 * sites or cameras.
 */
@Injectable()
export class PortalService {
  constructor(
    @InjectRepository(Customer)
    private readonly customers: Repository<Customer>,
    @InjectRepository(Site)
    private readonly sites: Repository<Site>,
    private readonly sitesService: SitesService,
    private readonly camerasService: CamerasService,
    private readonly support: SupportService,
    private readonly activity: ActivityService,
    private readonly auth: AuthService,
  ) {}

  private actor(customer: Customer) {
    return { role: 'customer' as const, id: customer.id, email: customer.email };
  }

  private async getCustomer(customerId: string): Promise<Customer> {
    const customer = await this.customers.findOne({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('Account not found');
    return customer;
  }

  private async getOwnSite(customerId: string, siteId: string): Promise<Site> {
    const site = await this.sites.findOne({
      where: { id: siteId },
      relations: { cameras: true },
    });
    if (!site) throw new NotFoundException('Site not found');
    if (site.customerId !== customerId) {
      throw new ForbiddenException('This site belongs to another customer');
    }
    return site;
  }

  /** Throws unless the camera belongs to one of the customer's own sites. */
  private async assertOwnCamera(customerId: string, cameraId: string) {
    const camera = await this.camerasService.getEntity(cameraId);
    if (camera.site?.customerId !== customerId) {
      throw new ForbiddenException('This camera belongs to another customer');
    }
    return camera;
  }

  /* ------------------------------ profile ------------------------------- */

  async me(customerId: string) {
    const customer = await this.getCustomer(customerId);
    const sites = await this.sites.find({
      where: { customerId },
      relations: { cameras: true },
      order: { name: 'ASC' },
    });
    const cameraCount = sites.reduce((n, s) => n + (s.cameras?.length ?? 0), 0);
    return {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      contactPhone: customer.contactPhone,
      notes: customer.notes,
      lastLoginAt: customer.lastLoginAt,
      createdAt: customer.createdAt,
      siteCount: sites.length,
      cameraCount,
    };
  }

  async updateProfile(customerId: string, dto: UpdateProfileDto) {
    const customer = await this.getCustomer(customerId);
    if (dto.name !== undefined) customer.name = dto.name;
    if (dto.contactPhone !== undefined) customer.contactPhone = dto.contactPhone;
    if (dto.notes !== undefined) customer.notes = dto.notes;
    await this.customers.save(customer);
    return this.me(customerId);
  }

  changePassword(customerId: string, dto: ChangePasswordDto) {
    return this.auth.changePassword(customerId, dto);
  }

  /* ------------------------------- sites -------------------------------- */

  mySites(customerId: string) {
    return this.sites.find({
      where: { customerId },
      relations: { cameras: true },
      order: { name: 'ASC' },
    });
  }

  async createSite(customerId: string, dto: CreatePortalSiteDto) {
    const customer = await this.getCustomer(customerId);
    const site = await this.sitesService.create({ ...dto, customerId });
    await this.activity.log(
      this.actor(customer),
      'site.created',
      `Created site "${site.name}"${site.address ? ` (${site.address})` : ''}`,
    );
    return site;
  }

  async updateSite(customerId: string, siteId: string, dto: UpdatePortalSiteDto) {
    await this.getOwnSite(customerId, siteId);
    const site = await this.sitesService.update(siteId, dto);
    const customer = await this.getCustomer(customerId);
    await this.activity.log(
      this.actor(customer),
      'site.updated',
      `Updated site "${site.name}"`,
    );
    return site;
  }

  async deleteSite(customerId: string, siteId: string) {
    const site = await this.getOwnSite(customerId, siteId);
    const customer = await this.getCustomer(customerId);
    const result = await this.sitesService.remove(siteId);
    await this.activity.log(
      this.actor(customer),
      'site.deleted',
      `Deleted site "${site.name}" and its ${site.cameras?.length ?? 0} camera(s)`,
    );
    return result;
  }

  /* ------------------------------ cameras ------------------------------- */

  myCameras(customerId: string) {
    return this.camerasService.findAllForCustomer(customerId);
  }

  async createCamera(customerId: string, dto: CreateCameraDto) {
    await this.getOwnSite(customerId, dto.siteId);
    const camera = await this.camerasService.create(dto);
    const customer = await this.getCustomer(customerId);
    await this.activity.log(
      this.actor(customer),
      'camera.created',
      `Added camera "${camera.name}" to site "${camera.site?.name ?? ''}"`,
    );
    return camera;
  }

  async updateCamera(
    customerId: string,
    cameraId: string,
    dto: Partial<CreateCameraDto>,
  ) {
    await this.assertOwnCamera(customerId, cameraId);
    if (dto.siteId) await this.getOwnSite(customerId, dto.siteId);
    const camera = await this.camerasService.update(cameraId, dto);
    const customer = await this.getCustomer(customerId);
    await this.activity.log(
      this.actor(customer),
      'camera.updated',
      `Updated camera "${camera.name}"`,
    );
    return camera;
  }

  async startCamera(customerId: string, cameraId: string) {
    await this.assertOwnCamera(customerId, cameraId);
    return this.camerasService.start(cameraId);
  }

  async stopCamera(customerId: string, cameraId: string) {
    await this.assertOwnCamera(customerId, cameraId);
    return this.camerasService.stop(cameraId);
  }

  async deleteCamera(customerId: string, cameraId: string) {
    const existing = await this.assertOwnCamera(customerId, cameraId);
    const customer = await this.getCustomer(customerId);
    const result = await this.camerasService.remove(cameraId);
    await this.activity.log(
      this.actor(customer),
      'camera.deleted',
      `Deleted camera "${existing.name}"`,
    );
    return result;
  }

  demoSources() {
    return this.camerasService.listDemoSources();
  }

  /* ------------------------------- issues ------------------------------- */

  async myIssues(customerId: string) {
    return this.support.issuesForCustomer(customerId);
  }

  async reportIssue(customerId: string, dto: CreateIssueDto) {
    const customer = await this.getCustomer(customerId);
    const issue = await this.support.createIssue({
      customerId,
      category: dto.category,
      subject: dto.subject,
      message: dto.message,
    });
    await this.activity.log(
      this.actor(customer),
      'issue.created',
      `Reported an issue: "${dto.subject}" (${dto.category})`,
    );
    return issue;
  }
}
