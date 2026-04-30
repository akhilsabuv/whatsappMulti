import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@whatsapp-platform/common';
import { PlatformService } from '../platform.service';
import { StatusDto } from '../dto';
import { BackupService } from '../backup.service';
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
    private readonly backupService: BackupService,
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

  @Get('backups')
  backups() {
    return this.backupService.listBackups();
  }

  @Post('backups')
  createBackup() {
    return this.backupService.createBackup();
  }

  @Post('backups/:filename/restore')
  restoreBackup(@Param('filename') filename: string, @Body() body: { confirmation?: string }) {
    return this.backupService.restoreBackup(filename, body.confirmation ?? '');
  }

  @Delete('backups/:filename')
  deleteBackup(@Param('filename') filename: string) {
    return this.backupService.deleteBackup(filename);
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
