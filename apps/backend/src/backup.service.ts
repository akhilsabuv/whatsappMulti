import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { execFile } from 'child_process';
import { mkdir, readdir, stat, unlink } from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const backupNamePattern = /^whatsapp-platform-\d{8}-\d{6}\.dump$/;

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private readonly backupDir = path.resolve(process.env.BACKUP_DIR ?? '/shared/backups/database');
  private running = false;

  async listBackups() {
    await mkdir(this.backupDir, { recursive: true });
    const entries = await readdir(this.backupDir);
    const backups = await Promise.all(
      entries
        .filter((entry) => backupNamePattern.test(entry))
        .map(async (filename) => {
          const absolutePath = this.resolveBackupPath(filename);
          const details = await stat(absolutePath);
          return {
            filename,
            sizeBytes: details.size,
            createdAt: details.mtime,
          };
        }),
    );

    return backups.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async createBackup() {
    return this.runExclusive(async () => {
      await mkdir(this.backupDir, { recursive: true });
      const filename = this.buildBackupFilename();
      const absolutePath = this.resolveBackupPath(filename);

      await execFileAsync('pg_dump', [
        '--dbname',
        this.getDatabaseUrl(),
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        '--file',
        absolutePath,
      ]);

      const details = await stat(absolutePath);
      await this.pruneOldBackups();

      return {
        filename,
        sizeBytes: details.size,
        createdAt: details.mtime,
      };
    });
  }

  async restoreBackup(filename: string, confirmation: string) {
    if (confirmation !== 'CLEAR_AND_RESTORE') {
      throw new BadRequestException('Type CLEAR_AND_RESTORE to restore a backup');
    }

    return this.runExclusive(async () => {
      const absolutePath = this.resolveBackupPath(filename);
      try {
        await stat(absolutePath);
      } catch {
        throw new NotFoundException('Backup not found');
      }

      const safetyBackup = await this.createSafetyBackupBeforeRestore();

      await execFileAsync('pg_restore', [
        '--dbname',
        this.getDatabaseUrl(),
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-privileges',
        '--single-transaction',
        absolutePath,
      ]);

      return {
        success: true,
        restoredFrom: filename,
        safetyBackup,
      };
    });
  }

  private async createSafetyBackupBeforeRestore() {
    await mkdir(this.backupDir, { recursive: true });
    const filename = this.buildBackupFilename('pre-restore');
    const absolutePath = this.resolveBackupPath(filename);

    await execFileAsync('pg_dump', [
      '--dbname',
      this.getDatabaseUrl(),
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      '--file',
      absolutePath,
    ]);

    return filename;
  }

  private async pruneOldBackups() {
    const retainCount = Number(process.env.BACKUP_RETAIN_COUNT ?? 14);
    if (!Number.isFinite(retainCount) || retainCount < 1) {
      return;
    }

    const backups = await this.listBackups();
    await Promise.all(
      backups.slice(retainCount).map(async (backup) => {
        try {
          await unlink(this.resolveBackupPath(backup.filename));
        } catch (error) {
          this.logger.warn(`Unable to prune backup ${backup.filename}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }),
    );
  }

  private async runExclusive<T>(operation: () => Promise<T>) {
    if (this.running) {
      throw new BadRequestException('Another backup operation is already running');
    }

    this.running = true;
    try {
      return await operation();
    } finally {
      this.running = false;
    }
  }

  private buildBackupFilename(prefix = 'whatsapp-platform') {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    return `${prefix}-${stamp}.dump`;
  }

  private resolveBackupPath(filename: string) {
    if (!backupNamePattern.test(filename) && !/^pre-restore-\d{8}-\d{6}\.dump$/.test(filename)) {
      throw new BadRequestException('Invalid backup filename');
    }

    const absolutePath = path.resolve(this.backupDir, filename);
    if (!absolutePath.startsWith(`${this.backupDir}${path.sep}`)) {
      throw new BadRequestException('Invalid backup path');
    }
    return absolutePath;
  }

  private getDatabaseUrl() {
    if (!process.env.DATABASE_URL) {
      throw new BadRequestException('DATABASE_URL is not configured');
    }
    return process.env.DATABASE_URL;
  }
}
