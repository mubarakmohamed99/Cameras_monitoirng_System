import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { Site } from './entities/site.entity';
import { CreateSiteDto } from './dto/create-site.dto';

@Injectable()
export class SitesService {
  constructor(
    @InjectRepository(Site)
    private readonly sites: Repository<Site>,
    @InjectRepository(Customer)
    private readonly customers: Repository<Customer>,
  ) {}

  async create(dto: CreateSiteDto) {
    const customer = await this.customers.findOne({ where: { id: dto.customerId } });
    if (!customer) throw new NotFoundException('Customer not found');

    const site = this.sites.create({
      name: dto.name,
      address: dto.address,
      owner: dto.owner,
      customerId: dto.customerId,
      customer,
    });
    return this.sites.save(site);
  }

  findAll() {
    return this.sites.find({
      relations: {
        customer: true,
        cameras: true,
      },
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string) {
    const site = await this.sites.findOne({
      where: { id },
      relations: { customer: true, cameras: true },
    });
    if (!site) throw new NotFoundException('Site not found');
    return site;
  }

  async update(id: string, dto: Partial<CreateSiteDto>) {
    const site = await this.findOne(id);

    if (dto.customerId && dto.customerId !== site.customerId) {
      const customer = await this.customers.findOne({ where: { id: dto.customerId } });
      if (!customer) throw new NotFoundException('Customer not found');
      site.customer = customer;
      site.customerId = dto.customerId;
    }

    if (dto.name !== undefined) site.name = dto.name;
    if (dto.address !== undefined) site.address = dto.address;

    return this.sites.save(site);
  }

  async remove(id: string) {
    const site = await this.findOne(id);
    await this.sites.remove(site);
    return { deleted: true, id };
  }
}
