import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PortalSendTestMessageDto } from '../dto';
import { PlatformService } from '../platform.service';

@ApiTags('Client Portal')
@Controller('client-portal')
export class ClientPortalController {
  constructor(private readonly platformService: PlatformService) {}

  @Get(':token')
  portal(@Param('token') token: string) {
    return this.platformService.getClientPortal(token);
  }

  @Post(':token/request-qr')
  requestQr(@Param('token') token: string) {
    return this.platformService.requestQrFromPortal(token);
  }

  @Post(':token/send-test-message')
  sendTestMessage(@Param('token') token: string, @Body() body: PortalSendTestMessageDto) {
    return this.platformService.sendPortalTestMessage(token, body.to, body.text);
  }
}
