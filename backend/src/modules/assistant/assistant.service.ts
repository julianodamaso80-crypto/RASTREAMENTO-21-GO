import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AssistantTools, TOOL_DEFINITIONS } from './assistant.tools';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || 'anthropic/claude-haiku-4.5';
const MAX_TOOL_ITERATIONS = 6;

const SYSTEM_PROMPT = `Você é o assistente do Rastreamento 21GO, uma plataforma de rastreamento veicular multi-tenant.
Responde em português correto com acentuação. Use as tools disponíveis pra consultar dados reais antes de responder — NUNCA invente números.

Regras:
- Quando o usuário perguntar sobre dados (quantos veículos, alertas, score, manutenção), CHAME UMA TOOL primeiro.
- Citações de placas: sempre maiúsculo.
- Períodos: "hoje" = 24h; "essa semana" = 7d; "esse mês" = 30d.
- Respostas curtas e diretas. Se a pergunta é "quantos X?", responda com o número e 1 linha de contexto.
- Se faltar dado, diga o que falta — não chute.
- Você NÃO tem acesso a dados de outros tenants. Toda tool já filtra automaticamente pelo tenant do usuário.

Tools disponíveis: query_vehicles, query_alerts, vehicle_behavior, vehicle_score, maintenance_overview, fleet_summary.`;

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface OpenRouterResponse {
  id: string;
  choices: Array<{
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: 'stop' | 'tool_calls' | 'length' | string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

/**
 * Tools no formato OpenAI/OpenRouter (function calling), convertidas de TOOL_DEFINITIONS
 * (que estão no formato Anthropic — mantidos como fonte única de verdade).
 */
const OPENROUTER_TOOLS = TOOL_DEFINITIONS.map((t) => ({
  type: 'function' as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  },
}));

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  private readonly apiKey = process.env.OPENROUTER_API_KEY ?? '';
  private readonly siteUrl = process.env.PUBLIC_SITE_URL ?? 'https://trackgo.site';
  private readonly siteName = '21GO Rastreamento';

  constructor(
    private prisma: PrismaService,
    private tools: AssistantTools,
  ) {}

  async chat(
    userId: string,
    tenantId: string,
    userMessage: string,
    conversationId?: string,
  ) {
    if (!this.apiKey) {
      return {
        conversationId: conversationId ?? '',
        reply: {
          id: 'no-key',
          role: 'assistant' as const,
          content: 'Assistente indisponível: OPENROUTER_API_KEY não configurada no backend.',
          createdAt: new Date().toISOString(),
        },
      };
    }

    let conversation = conversationId
      ? await this.prisma.assistantConversation.findFirst({
          where: { id: conversationId, userId, tenantId },
          include: { messages: { orderBy: { createdAt: 'asc' } } },
        })
      : null;

    if (!conversation) {
      conversation = await this.prisma.assistantConversation.create({
        data: { userId, tenantId, title: userMessage.slice(0, 80) },
        include: { messages: true },
      });
    }

    const history: ChatMessage[] = conversation.messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    await this.prisma.assistantMessage.create({
      data: { conversationId: conversation.id, role: 'user', content: userMessage },
    });

    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history,
      { role: 'user', content: userMessage },
    ];

    const { reply, usage } = await this.runWithTools(messages, tenantId);

    const stored = await this.prisma.assistantMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'assistant',
        content: reply,
        ...(usage ? { tokenUsage: usage as unknown as object } : {}),
      },
    });

    return {
      conversationId: conversation.id,
      reply: {
        id: stored.id,
        role: 'assistant' as const,
        content: stored.content,
        createdAt: stored.createdAt.toISOString(),
      },
    };
  }

  async listConversations(userId: string, tenantId: string) {
    return this.prisma.assistantConversation.findMany({
      where: { userId, tenantId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
  }

  async history(conversationId: string, userId: string, tenantId: string) {
    const conv = await this.prisma.assistantConversation.findFirst({
      where: { id: conversationId, userId, tenantId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!conv) return [];
    return conv.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    }));
  }

  /**
   * Loop de tool use. OpenRouter expõe API OpenAI-compatible — tool calls vêm
   * em `message.tool_calls` e devem ser respondidos com role: 'tool' por ID.
   * Filtro de tenantId é injetado server-side; modelo nunca o recebe.
   */
  private async runWithTools(
    messages: ChatMessage[],
    tenantId: string,
  ): Promise<{ reply: string; usage?: OpenRouterResponse['usage'] }> {
    let iterations = 0;
    let response = await this.callOpenRouter(messages);
    let lastUsage = response.usage;

    while (
      iterations < MAX_TOOL_ITERATIONS &&
      response.choices[0]?.finish_reason === 'tool_calls' &&
      response.choices[0]?.message?.tool_calls?.length
    ) {
      iterations += 1;
      const assistantMsg = response.choices[0].message;
      messages.push({
        role: 'assistant',
        content: assistantMsg.content ?? null,
        tool_calls: assistantMsg.tool_calls,
      });

      for (const tc of assistantMsg.tool_calls ?? []) {
        let parsedInput: Record<string, unknown> = {};
        try {
          parsedInput = JSON.parse(tc.function.arguments || '{}');
        } catch {
          parsedInput = {};
        }
        const result = await this.tools.execute(tc.function.name, parsedInput, tenantId);
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.function.name,
          content: JSON.stringify(result),
        });
      }

      response = await this.callOpenRouter(messages);
      if (response.usage) lastUsage = response.usage;
    }

    const reply = response.choices[0]?.message?.content?.trim() || 'Não consegui formular uma resposta.';
    return { reply, usage: lastUsage };
  }

  private async callOpenRouter(messages: ChatMessage[]): Promise<OpenRouterResponse> {
    const res = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'HTTP-Referer': this.siteUrl,
        'X-Title': this.siteName,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages,
        tools: OPENROUTER_TOOLS,
        tool_choice: 'auto',
        temperature: 0.2,
        max_tokens: 1024,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      this.logger.error(`OpenRouter ${res.status}: ${body}`);
      throw new Error(`OpenRouter falhou: ${res.status}`);
    }

    return (await res.json()) as OpenRouterResponse;
  }
}
