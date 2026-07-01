import { Body, Controller, Post } from '@nestjs/common';
import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
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
}
