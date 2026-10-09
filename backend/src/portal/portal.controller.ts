import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { PortalService } from './portal.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { ChangePasswordDto } from '../auth/dto/change-password.dto';
import { CreateCameraDto } from '../cameras/dto/create-camera.dto';
import {
  CreateIssueDto,
  CreatePortalSiteDto,
  UpdatePortalSiteDto,
  UpdateProfileDto,
} from './dto/portal.dto';

interface PortalRequest {
  user: { sub: string; email: string; role: string; customerId: string };
}

/** Customer self-service API — every route requires a customer token. */
@Roles('customer')
@Controller('portal')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  /* ------------------------------ profile ------------------------------- */

  @Get('me')
  me(@Req() req: PortalRequest) {
    return this.portal.me(req.user.customerId);
  }

  @Patch('me')
  updateMe(@Req() req: PortalRequest, @Body() dto: UpdateProfileDto) {
    return this.portal.updateProfile(req.user.customerId, dto);
  }

  @Post('me/password')
  changePassword(@Req() req: PortalRequest, @Body() dto: ChangePasswordDto) {
    return this.portal.changePassword(req.user.customerId, dto);
  }

  /* ------------------------------- sites -------------------------------- */

  @Get('sites')
  sites(@Req() req: PortalRequest) {
    return this.portal.mySites(req.user.customerId);
  }

  @Post('sites')
  createSite(@Req() req: PortalRequest, @Body() dto: CreatePortalSiteDto) {
    return this.portal.createSite(req.user.customerId, dto);
  }

  @Patch('sites/:id')
  updateSite(
    @Req() req: PortalRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePortalSiteDto,
  ) {
    return this.portal.updateSite(req.user.customerId, id, dto);
  }

  @Delete('sites/:id')
  deleteSite(@Req() req: PortalRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.deleteSite(req.user.customerId, id);
  }

  /* ------------------------------ cameras ------------------------------- */

  @Get('cameras')
  cameras(@Req() req: PortalRequest) {
    return this.portal.myCameras(req.user.customerId);
  }

  @Post('cameras')
  createCamera(@Req() req: PortalRequest, @Body() dto: CreateCameraDto) {
    return this.portal.createCamera(req.user.customerId, dto);
  }

  @Get('cameras/demo-sources')
  demoSources() {
    return this.portal.demoSources();
  }

  @Patch('cameras/:id')
  updateCamera(
    @Req() req: PortalRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Partial<CreateCameraDto>,
  ) {
    return this.portal.updateCamera(req.user.customerId, id, dto);
  }

  @Post('cameras/:id/start')
  startCamera(@Req() req: PortalRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.startCamera(req.user.customerId, id);
  }

  @Post('cameras/:id/stop')
  stopCamera(@Req() req: PortalRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.stopCamera(req.user.customerId, id);
  }

  @Delete('cameras/:id')
  deleteCamera(@Req() req: PortalRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.deleteCamera(req.user.customerId, id);
  }

  /* ------------------------------- issues ------------------------------- */

  @Get('issues')
  issues(@Req() req: PortalRequest) {
    return this.portal.myIssues(req.user.customerId);
  }

  @Post('issues')
  reportIssue(@Req() req: PortalRequest, @Body() dto: CreateIssueDto) {
    return this.portal.reportIssue(req.user.customerId, dto);
  }
}
