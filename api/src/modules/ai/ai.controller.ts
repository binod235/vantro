import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { IsArray, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AiService } from './ai.service';
import { PipInsightsService } from './pip-insights.service';
import { PipMemoryService } from './pip-memory.service';
import { PipDashboardService } from './pip-dashboard.service';
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

  @IsOptional()
  @IsString()
  currentPage?: string;
}

class SendEmailDto {
  @IsString()
  to!: string;

  @IsString()
  subject!: string;

  @IsString()
  body!: string;
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

class SessionMessageDto {
  @IsString()
  role!: string;

  @IsString()
  content!: string;

  @IsOptional()
  @IsString()
  timestamp?: string;
}

class SaveSessionDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SessionMessageDto)
  messages!: SessionMessageDto[];
}

@Controller('ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly pipInsights: PipInsightsService,
    private readonly memory: PipMemoryService,
    private readonly dashboard: PipDashboardService,
  ) {}

  @Get('dashboard')
  @Roles('OWNER')
  getDashboard(@CurrentUser() user: { companyId: string }) {
    return this.dashboard.getDashboardData(user.companyId!);
  }

  @Post('chat')
  chat(
    @CurrentUser() user: { companyId: string; id: string; role: string },
    @Body() body: ChatDto,
  ) {
    return this.ai.chat(
      user.companyId,
      user.id,
      body.message,
      body.conversationHistory ?? [],
      body.confirmedAction,
      body.currentPage,
      user.role,
    );
  }

  @Post('send-email')
  @Roles('OWNER')
  async sendEmail(
    @CurrentUser() user: { companyId: string },
    @Body() body: SendEmailDto,
  ) {
    await this.ai.sendEmail(user.companyId!, body.to, body.subject, body.body);
    return { success: true };
  }

  @Post('smart-write')
  smartWrite(@Body() body: SmartWriteDto) {
    return this.ai.smartWrite(body.text, body.context, body.action);
  }

  @Get('insights')
  @Roles('OWNER')
  getInsights(@CurrentUser() user: { companyId: string }) {
    return this.pipInsights.getUnread(user.companyId!);
  }

  @Get('insights/count')
  @Roles('OWNER')
  async getInsightCount(@CurrentUser() user: { companyId: string }) {
    const count = await this.pipInsights.getUnreadCount(user.companyId!);
    return { count };
  }

  @Post('insights/mark-read')
  @Roles('OWNER')
  markInsightsRead(@CurrentUser() user: { companyId: string }) {
    return this.pipInsights.markRead(user.companyId!);
  }

  @Delete('insights/:id')
  @Roles('OWNER')
  dismissInsight(
    @CurrentUser() user: { companyId: string },
    @Param('id') id: string,
  ) {
    return this.pipInsights.dismiss(user.companyId!, id);
  }

  @Post('save-session')
  @Roles('OWNER')
  async saveSession(
    @CurrentUser() user: { companyId: string; id: string },
    @Body() body: SaveSessionDto,
  ) {
    await this.memory.saveSession(user.companyId!, user.id, body.messages);
    return { success: true };
  }

  @Get('last-session')
  @Roles('OWNER')
  async getLastSession(@CurrentUser() user: { companyId: string; id: string }) {
    const messages = await this.memory.getLastSession(user.companyId!, user.id);
    return { messages };
  }
}
