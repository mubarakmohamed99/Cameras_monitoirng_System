import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from './entities/customer.entity';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/create-customer.dto';

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer)
    private readonly customers: Repository<Customer>,
  ) {}

  create(dto: CreateCustomerDto) {
    return this.customers.save(this.customers.create(dto));
  }

  findAll() {
    return this.customers.find({ relations: { sites: true } });
  }

  async findOne(id: string) {
    const customer = await this.customers.findOne({
      where: { id },
      relations: { sites: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async update(id: string, dto: UpdateCustomerDto) {
    const customer = await this.findOne(id);
    Object.assign(customer, dto);
    return this.customers.save(customer);
  }

  async remove(id: string) {
    const customer = await this.findOne(id);
    await this.customers.remove(customer);
    return { deleted: true, id };
  }
}
