import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { execFile } from 'child_process';
import { readFile, rm } from 'fs/promises';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

type UploadSignature = {
  mimeType: string;
  extensions: string[];
  matches: (bytes: Buffer) => boolean;
  text?: boolean;
};

const SIGNATURES: UploadSignature[] = [
  {
    mimeType: 'application/pdf',
    extensions: ['.pdf'],
    matches: (bytes) => bytes.subarray(0, 5).equals(Buffer.from('%PDF-')),
  },
  {
    mimeType: 'image/jpeg',
    extensions: ['.jpg', '.jpeg'],
    matches: (bytes) => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  {
    mimeType: 'image/png',
    extensions: ['.png'],
    matches: (bytes) => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mimeType: 'image/webp',
    extensions: ['.webp'],
    matches: (bytes) => bytes.subarray(0, 4).equals(Buffer.from('RIFF')) && bytes.subarray(8, 12).equals(Buffer.from('WEBP')),
  },
  {
    mimeType: 'text/plain',
    extensions: ['.txt'],
    text: true,
    matches: (bytes) => isPlainText(bytes),
  },
];

@Injectable()
export class UploadSecurityService {
  private readonly logger = new Logger(UploadSecurityService.name);

  async inspect(file: Express.Multer.File) {
    const header = await readFile(file.path);
    const detected = SIGNATURES.find((signature) => signature.matches(header));
    const extension = this.getExtension(file.originalname);

    if (!detected) {
      await this.discard(file.path);
      throw new BadRequestException('Unsupported or unrecognized file content');
    }

    if (file.mimetype !== detected.mimeType || !detected.extensions.includes(extension)) {
      await this.discard(file.path);
      throw new BadRequestException('Uploaded file extension, content, and MIME type do not match');
    }

    await this.scan(file.path);
    return detected.mimeType;
  }

  async discard(path: string) {
    await rm(path, { force: true }).catch(() => undefined);
  }

  private async scan(path: string) {
    const scanner = process.env.CLAMSCAN_PATH;
    if (!scanner) {
      if (process.env.REQUIRE_MALWARE_SCAN === 'true') {
        await this.discard(path);
        throw new ServiceUnavailableException('Malware scanner is required but not configured');
      }
      return;
    }

    try {
      await execFileAsync(scanner, ['--no-summary', path], { timeout: Number(process.env.CLAMSCAN_TIMEOUT_MS ?? 30_000) });
    } catch (error) {
      await this.discard(path);
      const message = error instanceof Error ? error.message : 'Unknown malware scanner error';
      this.logger.warn(`Upload rejected by malware scanner: ${message}`);
      throw new BadRequestException('Uploaded file did not pass malware scanning');
    }
  }

  private getExtension(fileName: string) {
    const dotIndex = fileName.lastIndexOf('.');
    return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : '';
  }
}

function isPlainText(bytes: Buffer) {
  if (!bytes.length) {
    return false;
  }

  for (const byte of bytes) {
    if (byte === 0) {
      return false;
    }
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) {
      return false;
    }
  }

  return true;
}

