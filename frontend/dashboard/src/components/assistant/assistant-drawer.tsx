'use client';

import { useEffect, useRef, useState } from 'react';
import { Send, Sparkles } from 'lucide-react';
import { assistantApi, type AssistantMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

export function AssistantDrawer() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: AssistantMessage = {
      id: `tmp-${Date.now()}`,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setSending(true);
    try {
      const res = await assistantApi.ask(text, conversationId);
      setConversationId(res.conversationId);
      setMessages((m) => [...m, res.reply]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: `Falha ao consultar assistente: ${(e as Error).message}`,
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="outline" size="sm" className="gap-1">
            <Sparkles className="h-3.5 w-3.5 text-emerald-500" />
            Assistente
          </Button>
        }
      />

      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-emerald-500" />
            Assistente da frota
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto py-4 space-y-3">
          {messages.length === 0 && (
            <div className="text-sm text-muted-foreground space-y-2">
              <p>Faça perguntas sobre sua frota:</p>
              <ul className="list-disc pl-4 space-y-1 text-xs">
                <li>"Quantos veículos estão offline há mais de 6 horas?"</li>
                <li>"Quais alertas de sabotagem aconteceram essa semana?"</li>
                <li>"Qual é o score do carro de placa ABC1234?"</li>
                <li>"Quais carros precisam de troca de óleo?"</li>
              </ul>
            </div>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={`text-sm rounded-lg p-3 ${
                m.role === 'user'
                  ? 'bg-primary/10 text-foreground ml-6'
                  : 'bg-muted text-foreground mr-6'
              }`}
            >
              <div className="whitespace-pre-wrap">{m.content}</div>
            </div>
          ))}
          {sending && (
            <div className="text-sm text-muted-foreground mr-6 px-3">Consultando dados…</div>
          )}
          <div ref={bottomRef} />
        </div>
        <div className="border-t pt-3 flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Pergunte algo sobre a frota…"
            className="resize-none"
            rows={2}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <Button size="icon" onClick={send} disabled={sending || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
