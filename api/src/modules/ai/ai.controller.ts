import { Body, Controller, Post } from '@nestjs/common';
import { IsArray, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AiService } from './ai.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

class ConversationMessageDto {
  @IsString()
  role!: string;

  @IsString()
  content!: string;
}

class ChatDto {
  @IsString()
  message!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConversationMessageDto)
  conversationHistory?: ConversationMessageDto[];

  @IsOptional()
  confirmedAction?: { tool: string; args: Record<string, unknown> };
}

class SmartWriteDto {
  @IsString()
  text!: string;

  @IsString()
  context!: string;

  @IsString()
  @IsIn(['improve', 'expand', 'shorten', 'professional'])
  action!: string;
}

@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Post('chat')
  @Roles('OWNER')
  chat(
    @CurrentUser() user: { companyId: string; id: string },
    @Body() body: ChatDto,
  ) {
    return this.ai.chat(
      user.companyId,
      user.id,
      body.message,
      body.conversationHistory ?? [],
      body.confirmedAction,
    );
  }

  @Post('smart-write')
  smartWrite(@Body() body: SmartWriteDto) {
    return this.ai.smartWrite(body.text, body.context, body.action);
  }
}
