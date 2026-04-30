import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@whatsapp-platform/common';
import { ChangePasswordDto, CreateApiKeyDto, CreateApiUserDto, CreateSessionDto, StatusDto } from '../dto';
import { PlatformService } from '../platform.service';
import { Roles } from '../security/decorators';
import { JwtAuthGuard, RolesGuard } from '../security/guards';
import { UserEntity } from '../types';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPERADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly platformService: PlatformService) {}

  @Post('users')
  createUser(@Req() request: { user: UserEntity }, @Body() body: CreateApiUserDto) {
    return this.platformService.createApiUser(request.user, body);
  }

  @Post('api-users')
  createApiUser(@Req() request: { user: UserEntity }, @Body() body: CreateApiUserDto) {
    return this.platformService.createApiUser(request.user, {
      ...body,
      role: UserRole.API_USER,
    });
  }

  @Get('api-users/active-api-key')
  activeApiKeyByEmail(@Req() request: { user: UserEntity }, @Query('email') email: string) {
    return this.platformService.getActiveApiKeyForManagedUserByEmail(request.user, email);
  }

  @Get('users')
  listUsers(@Req() request: { user: UserEntity }) {
    return this.platformService.listManagedUsers(request.user);
  }

  @Get('dashboard/summary')
  summary(@Req() request: { user: UserEntity }) {
    return this.platformService.adminSummary(request.user);
  }

  @Post('users/:id/api-keys')
  createApiKey(@Req() request: { user: UserEntity }, @Param('id') id: string, @Body() body: CreateApiKeyDto) {
    return this.platformService.createApiKeyForManagedUser(request.user, id, body.name);
  }

  @Delete('api-keys/:id')
  revokeApiKey(@Req() request: { user: UserEntity }, @Param('id') id: string) {
    return this.platformService.revokeApiKey(request.user, id);
  }

  @Patch('api-keys/:id/status')
  setApiKeyStatus(@Req() request: { user: UserEntity }, @Param('id') id: string, @Body() body: StatusDto) {
    return this.platformService.setApiKeyStatus(request.user, id, body.isActive);
  }

  @Post('users/:id/sessions')
  createSession(@Req() request: { user: UserEntity }, @Param('id') id: string, @Body() body: CreateSessionDto) {
    return this.platformService.createManagedSession(request.user, id, body.label);
  }

  @Post('users/:id/password')
  changePassword(@Req() request: { user: UserEntity }, @Param('id') id: string, @Body() body: ChangePasswordDto) {
    return this.platformService.changeManagedUserPassword(request.user, id, body.password);
  }

  @Post('sessions/:id/request-qr')
  requestQr(@Req() request: { user: UserEntity }, @Param('id') id: string) {
    return this.platformService.requestQrForManagedSession(request.user, id);
  }

  @Get('sessions/:id/live')
  sessionLive(@Req() request: { user: UserEntity }, @Param('id') id: string) {
    return this.platformService.getManagedSessionLive(request.user, id);
  }

  @Get('users/:id/usage')
  usage(@Param('id') id: string) {
    return this.platformService.usageForUser(id);
  }

  @Get('users/:id/messages')
  messages(@Req() request: { user: UserEntity }, @Param('id') id: string) {
    return this.platformService.getManagedUserMessages(request.user, id);
  }

  @Get('users/:id/api-access')
  apiAccess(@Req() request: { user: UserEntity }, @Param('id') id: string) {
    return this.platformService.getApiUserAccessBundle(request.user, id);
  }

  @Post('users/:id/portal/revoke')
  revokePortalLinks(@Req() request: { user: UserEntity }, @Param('id') id: string) {
    return this.platformService.revokeManagedUserPortalLinks(request.user, id);
  }

  @Delete('users/:id')
  deleteUser(@Req() request: { user: UserEntity }, @Param('id') id: string) {
    return this.platformService.deleteManagedUser(request.user, id);
  }
}
