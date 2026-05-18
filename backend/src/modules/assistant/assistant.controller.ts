import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { AssistantService } from './assistant.service';

interface AuthenticatedRequest {
  tenantId: string;
  user: { id: string; tenantId: string; role: string };
}

@Controller('assistant')
export class AssistantController {
  constructor(private service: AssistantService) {}

  @Post('chat')
  async chat(
    @Req() req: AuthenticatedRequest,
    @Body() body: { message: string; conversationId?: string },
  ) {
    return this.service.chat(req.user.id, req.tenantId, body.message, body.conversationId);
  }

  @Get('conversations')
  list(@Req() req: AuthenticatedRequest) {
    return this.service.listConversations(req.user.id, req.tenantId);
  }

  @Get('conversations/:id')
  history(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.history(id, req.user.id, req.tenantId);
  }
}
