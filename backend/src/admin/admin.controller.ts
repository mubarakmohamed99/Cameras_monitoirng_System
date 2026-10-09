import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  AdminUpdateCustomerDto,
  ResolveIssueDto,
  ResolveResetRequestDto,
  SetCredentialsDto,
} from './dto/admin.dto';

interface AdminRequest {
  user: { sub: string; email: string; role: string };
}

/** Admin oversight API — staff (admin role) only. */
@Roles('admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  overview() {
    return this.admin.overview();
  }

  @Get('customers')
  customers() {
    return this.admin.listCustomers();
  }

  @Get('customers/:id')
  customer(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.customerDetail(id);
  }

  @Patch('customers/:id')
  updateCustomer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUpdateCustomerDto,
  ) {
    return this.admin.updateCustomer(id, dto);
  }

  @Post('customers/:id/credentials')
  setCredentials(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCredentialsDto,
    @Req() req: AdminRequest,
  ) {
    return this.admin.setCredentials(id, dto, req.user);
  }

  @Delete('customers/:id')
  deleteCustomer(@Param('id', ParseUUIDPipe) id: string, @Req() req: AdminRequest) {
    return this.admin.deleteCustomer(id, req.user);
  }

  @Get('reset-requests')
  resetRequests() {
    return this.admin.pendingResetRequests();
  }

  @Post('reset-requests/:id/resolve')
  resolveResetRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveResetRequestDto,
    @Req() req: AdminRequest,
  ) {
    return this.admin.resolveResetRequest(id, dto, req.user);
  }

  @Get('issues')
  issues(@Query('status') status?: 'open' | 'resolved') {
    return this.admin.issues(status);
  }

  @Post('issues/:id/resolve')
  resolveIssue(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveIssueDto,
    @Req() req: AdminRequest,
  ) {
    return this.admin.resolveIssue(id, dto, req.user);
  }

  @Post('issues/:id/reopen')
  reopenIssue(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.reopenIssue(id);
  }

  @Get('activity')
  activity(@Query('limit') limit?: string) {
    return this.admin.recentActivity(limit ? Number(limit) : 100);
  }
}
