import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Param,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { SendFileDto, SendMessageDto, SendTextDto } from '../dto';
import { PlatformService } from '../platform.service';
import { ApiKeyGuard } from '../security/guards';
import { UploadSecurityService } from '../upload-security.service';

@ApiTags('API User')
@ApiHeader({ name: 'X-API-Key', required: true })
@ApiSecurity('api-key')
@UseGuards(ApiKeyGuard)
@Controller('api')
export class ApiController {
  constructor(
    private readonly platformService: PlatformService,
    private readonly uploadSecurity: UploadSecurityService,
  ) {}

  @Post('session/request-qr')
  @ApiOperation({
    summary: 'Request a WhatsApp QR code for the authenticated API user session',
    description: 'Authenticates with X-API-Key, resolves the user session, and queues QR generation.',
  })
  @ApiResponse({ status: 201, description: 'QR request accepted.' })
  requestQr(@Req() request: { apiUser: { id: string }; session: { id: string } | null }) {
    if (!request.session) {
      throw new BadRequestException('No session found for this API user');
    }

    return this.platformService.requestQr(request.apiUser.id, request.session.id);
  }

  @Get('session/status')
  @ApiOperation({
    summary: 'Get current WhatsApp session status',
    description: 'Returns whether the resolved session is connected, pending QR, disconnected, and related metadata.',
  })
  status(@Req() request: { apiUser: { id: string }; session: { id: string } | null }) {
    return this.platformService.apiSessionStatus(request.apiUser.id, request.session?.id);
  }

  @Get('contacts/check-number')
  @ApiOperation({
    summary: 'Check whether a phone number exists on WhatsApp',
  })
  @ApiQuery({ name: 'phone', required: true, example: '60123456789' })
  checkNumber(@Req() request: { apiUser: { id: string }; session: { id: string } | null }, @Query('phone') phone: string) {
    if (!phone || !/^\+?[1-9]\d{7,15}$/.test(phone)) {
      throw new BadRequestException('phone must be an E.164-like phone number without spaces');
    }

    return this.platformService.queueNumberCheck(request.apiUser.id, request.session?.id, phone);
  }

  @Post('messages/send-text')
  @ApiOperation({
    summary: 'Send a text message through the authenticated user session',
  })
  sendText(@Req() request: { apiUser: { id: string }; session: { id: string } | null }, @Body() body: SendTextDto) {
    return this.platformService.queueTextMessage(request.apiUser.id, request.session?.id, body.to, body.text);
  }

  @Post('messages/send')
  @ApiOperation({
    summary: 'Check a WhatsApp number, then send a text or file message if the number exists',
  })
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        to: { type: 'string' },
        type: { type: 'string', enum: ['text', 'file'] },
        text: { type: 'string', description: 'Text body for text messages, or caption for file messages.' },
        file: { type: 'string', format: 'binary' },
      },
      required: ['to', 'type'],
    },
  })
  async sendMessage(
    @Req() request: { apiUser: { id: string }; session: { id: string } | null },
    @UploadedFile() file: Express.Multer.File,
    @Body() body: SendMessageDto,
  ) {
    if (body.type === 'text') {
      if (!body.text?.trim()) {
        throw new BadRequestException('text is required when type is text');
      }

      if (file) {
        await this.uploadSecurity.discard(file.path);
      }

      return this.platformService.queueCheckedMessage(request.apiUser.id, request.session?.id, {
        to: body.to,
        type: 'text',
        text: body.text,
      });
    }

    if (!file) {
      throw new BadRequestException('file is required when type is file');
    }

    if (file.originalname.length > 180) {
      await this.uploadSecurity.discard(file.path);
      throw new BadRequestException('File name is too long');
    }

    const verifiedMimeType = await this.uploadSecurity.inspect(file);

    return this.platformService.queueCheckedMessage(request.apiUser.id, request.session?.id, {
      to: body.to,
      type: 'file',
      text: body.text,
      fileName: file.originalname,
      mimeType: verifiedMimeType,
      storagePath: file.path,
    });
  }

  @Post('messages/send-file')
  @ApiOperation({
    summary: 'Send a file attachment through the authenticated user session',
  })
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        to: { type: 'string' },
        caption: { type: 'string' },
        file: { type: 'string', format: 'binary' },
      },
      required: ['to', 'file'],
    },
  })
  async sendFile(
    @Req() request: { apiUser: { id: string }; session: { id: string } | null },
    @UploadedFile() file: Express.Multer.File,
    @Body() body: SendFileDto,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded (use "file" field name)');
    }

    if (file.originalname.length > 180) {
      await this.uploadSecurity.discard(file.path);
      throw new BadRequestException('File name is too long');
    }

    const verifiedMimeType = await this.uploadSecurity.inspect(file);

    return this.platformService.queueFileMessage(request.apiUser.id, request.session?.id, {
      to: body.to,
      caption: body.caption,
      fileName: file.originalname,
      mimeType: verifiedMimeType,
      storagePath: file.path,
    });
  }

  @Get('messages/:id/status')
  @ApiOperation({
    summary: 'Get the status of a specific message',
    description: 'Retrieves the current status and metadata of a message previously sent.',
  })
  @ApiResponse({ status: 200, description: 'Message status retrieved successfully.' })
  @ApiResponse({ status: 404, description: 'Message not found.' })
  messageStatus(@Req() request: { apiUser: { id: string } }, @Param('id') id: string) {
    return this.platformService.getMessageStatus(request.apiUser.id, id);
  }

  @Get('usage/me')
  @ApiOperation({
    summary: 'Get usage stats for the authenticated API user',
  })
  usage(@Req() request: { apiUser: { id: string } }) {
    return this.platformService.usageForUser(request.apiUser.id);
  }
}
