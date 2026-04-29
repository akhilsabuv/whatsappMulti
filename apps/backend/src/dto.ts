import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@whatsapp-platform/common';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @ApiProperty()
  @IsEmail()
  @MaxLength(150)
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

export class CreateApiUserDto {
  @ApiPropertyOptional({ enum: [UserRole.ADMIN, UserRole.API_USER] })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @ApiProperty()
  @IsEmail()
  @MaxLength(150)
  email!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @MinLength(8)
  @MaxLength(128)
  password?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  apiKeyName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  sessionLabel?: string;
}

export class CreateApiKeyDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;
}

export class CreateSessionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  label!: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

export class ChangeOwnPasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}

export class SendTextDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?[1-9]\d{7,15}$/, { message: 'to must be an E.164-like phone number without spaces' })
  to!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  text!: string;
}

export class SendFileDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?[1-9]\d{7,15}$/, { message: 'to must be an E.164-like phone number without spaces' })
  to!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  caption?: string;
}

export class SendMessageDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?[1-9]\d{7,15}$/, { message: 'to must be an E.164-like phone number without spaces' })
  to!: string;

  @ApiProperty({ enum: ['text', 'file'] })
  @IsString()
  @IsIn(['text', 'file'])
  type!: 'text' | 'file';

  @ApiPropertyOptional({ description: 'Text body for text messages, or caption for file messages.' })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  text?: string;
}

export class RequestQrDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sessionId?: string;
}

export class StatusDto {
  @ApiProperty()
  @IsBoolean()
  isActive!: boolean;
}

export class PortalSendTestMessageDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?[1-9]\d{7,15}$/, { message: 'to must be an E.164-like phone number without spaces' })
  to!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  text!: string;
}
