import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';
import { LoginDto } from './dto/login.dto';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** Admin console login (staff only). */
  @Public()
  @HttpCode(200)
  @Post('admin/login')
  adminLogin(@Body() dto: LoginDto) {
    return this.authService.adminLogin(dto);
  }

  /** Customer portal login. */
  @Public()
  @HttpCode(200)
  @Post('customer/login')
  customerLogin(@Body() dto: LoginDto) {
    return this.authService.customerLogin(dto);
  }

  /** Customer self-registration. */
  @Public()
  @Post('customer/register')
  registerCustomer(@Body() dto: RegisterCustomerDto) {
    return this.authService.registerCustomer(dto);
  }

  /** Files a password-reset request for the admin to handle. */
  @Public()
  @HttpCode(200)
  @Post('customer/forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  /** Legacy login — kept for backwards compatibility. */
  @Public()
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }
}
