import { Body, Controller, Delete, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@whatsapp-platform/common';
import { PlatformService } from '../platform.service';
import { StatusDto } from '../dto';
import { Roles } from '../security/decorators';
import { JwtAuthGuard, RolesGuard } from '../security/guards';
import { UserEntity } from '../types';
import { WorkerStatusService } from '../worker-status.service';

@ApiTags('Superadmin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPERADMIN)
@Controller('superadmin')
export class SuperadminController {
  constructor(
    private readonly platformService: PlatformService,
    private readonly workerStatusService: WorkerStatusService,
  ) {}

  @Get('users')
  users() {
    return this.platformService.superadminUsers();
  }

  @Get('sessions')
  sessions() {
    return this.platformService.superadminSessions();
  }

  @Get('dashboard/summary')
  summary() {
    return this.platformService.superadminSummary();
  }

  @Get('usage')
  usage() {
    return this.platformService.usageOverview();
  }

  @Get('queues/stats')
  queues() {
    return this.workerStatusService.getQueueStats();
  }

  @Get('health')
  health() {
    return this.workerStatusService.getWorkerStatus();
  }

  @Patch('admins/:id/status')
  setAdminStatus(@Req() request: { user: UserEntity }, @Param('id') id: string, @Body() body: StatusDto) {
    return this.platformService.superadminSetAdminStatus(request.user, id, body.isActive);
  }

  @Delete('admins/:id')
  deleteAdmin(@Req() request: { user: UserEntity }, @Param('id') id: string) {
    return this.platformService.superadminDeleteAdmin(request.user, id);
  }
}
