import {
  ConflictException,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from './entities/user.entity';
import { Customer } from '../customers/entities/customer.entity';
import { LoginDto } from './dto/login.dto';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { SupportService } from '../support/support.service';
import { ActivityService } from '../activity/activity.service';

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Customer)
    private readonly customers: Repository<Customer>,
    private readonly jwtService: JwtService,
    private readonly support: SupportService,
    private readonly activity: ActivityService,
  ) {}

  async onModuleInit() {
    const count = await this.users.count();
    if (count === 0) {
      await this.users.save([
        this.users.create({
          email: 'admin@local.com',
          passwordHash: await bcrypt.hash('admin123', 10),
          role: 'admin',
        }),
        this.users.create({
          email: 'viewer@local.com',
          passwordHash: await bcrypt.hash('viewer123', 10),
          role: 'viewer',
        }),
      ]);
    }
  }

  /* ----------------------------- admin side ----------------------------- */

  /** Admin console login — staff users only, customers are rejected here. */
  async adminLogin(dto: LoginDto) {
    const user = await this.users.findOne({ where: { email: dto.email } });
    const ok = user && (await bcrypt.compare(dto.password, user.passwordHash));
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    await this.activity.log(
      { role: 'admin', id: user.id, email: user.email },
      'admin.login',
      `${user.email} signed in to the admin console`,
    );

    const token = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
    return {
      access_token: token,
      user: { id: user.id, email: user.email, role: user.role },
    };
  }

  /** Legacy endpoint — kept so older clients keep working. */
  login(dto: LoginDto) {
    return this.adminLogin(dto);
  }

  /* ---------------------------- customer side --------------------------- */

  /** Customer self-registration on the portal. */
  async registerCustomer(dto: RegisterCustomerDto) {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.customers.findOne({ where: { email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const customer = await this.customers.save(
      this.customers.create({
        name: dto.name,
        email,
        passwordHash: await bcrypt.hash(dto.password, 10),
        contactEmail: email,
        contactPhone: dto.contactPhone ?? null,
      }),
    );

    await this.activity.log(
      { role: 'customer', id: customer.id, email: customer.email },
      'customer.registered',
      `${customer.name} created a customer account`,
    );

    return this.issueCustomerToken(customer);
  }

  /** Customer portal login — customer accounts only, staff are rejected. */
  async customerLogin(dto: LoginDto) {
    const email = dto.email.toLowerCase().trim();
    const customer = await this.customers.findOne({ where: { email } });
    const ok =
      customer &&
      customer.passwordHash &&
      (await bcrypt.compare(dto.password, customer.passwordHash));
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    customer.lastLoginAt = new Date();
    await this.customers.save(customer);

    await this.activity.log(
      { role: 'customer', id: customer.id, email: customer.email },
      'customer.login',
      `${customer.name} signed in to the customer portal`,
    );

    return this.issueCustomerToken(customer);
  }

  /**
   * "Forgot password" — the prototype has no mail server, so this files a
   * reset request that the admin sees and resolves in the admin console.
   * Always returns ok so the endpoint can't be used to enumerate emails.
   */
  async forgotPassword(dto: ForgotPasswordDto) {
    const email = dto.email.toLowerCase().trim();
    const customer = await this.customers.findOne({ where: { email } });
    if (customer) {
      await this.support.createResetRequest(customer.id, email);
      await this.activity.log(
        { role: 'customer', id: customer.id, email },
        'customer.password_reset_requested',
        `${customer.name} requested a password reset`,
      );
    }
    return {
      ok: true,
      message:
        'If this email is registered, the administrator has been notified and will reset your password.',
    };
  }

  /** Customer changes their own password while logged in. */
  async changePassword(customerId: string, dto: ChangePasswordDto) {
    const customer = await this.customers.findOne({ where: { id: customerId } });
    if (!customer || !customer.passwordHash) {
      throw new UnauthorizedException('Account not found');
    }
    const ok = await bcrypt.compare(dto.currentPassword, customer.passwordHash);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');

    customer.passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.customers.save(customer);

    await this.activity.log(
      { role: 'customer', id: customer.id, email: customer.email },
      'customer.password_changed',
      `${customer.name} changed their password`,
    );
    return { ok: true };
  }

  private async issueCustomerToken(customer: Customer) {
    const token = await this.jwtService.signAsync({
      sub: customer.id,
      email: customer.email,
      role: 'customer',
      customerId: customer.id,
    });
    return {
      access_token: token,
      user: {
        id: customer.id,
        email: customer.email,
        name: customer.name,
        role: 'customer',
      },
    };
  }
}
