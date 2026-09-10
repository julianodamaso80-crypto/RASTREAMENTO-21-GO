'use client';

import { useState } from 'react';
import { Loader2, MessageCircle, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Cadastro obrigatório do WhatsApp no login.
 *
 * Ocupa a tela inteira e não fecha: sem um número verificado a pessoa não tem
 * como recuperar a senha depois, e é esse número que recebe o código.
 *
 * As funções de API vêm de fora — o mesmo componente serve o painel
 * (`authApi`) e o PWA do técnico (`techApi`), que falam com rotas diferentes.
 */
export function VerificarWhatsappDialog({
  nome,
  iniciar,
  confirmar,
  onVerificado,
  onSair,
}: {
  nome?: string;
  iniciar: (phone: string) => Promise<{ sentTo: string }>;
  confirmar: (code: string) => Promise<unknown>;
  onVerificado: () => void;
  onSair?: () => void;
}) {
  const [etapa, setEtapa] = useState<'numero' | 'codigo'>('numero');
  const [telefone, setTelefone] = useState('');
  const [enviadoPara, setEnviadoPara] = useState<string | null>(null);
  const [codigo, setCodigo] = useState('');
  const [loading, setLoading] = useState(false);

  const enviarCodigo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (telefone.replace(/\D/g, '').length < 10) {
      toast.error('Informe o número com DDD.');
      return;
    }
    setLoading(true);
    try {
      const res = await iniciar(telefone);
      setEnviadoPara(res.sentTo);
      setEtapa('codigo');
      toast.success('Código enviado no seu WhatsApp.');
    } catch (err) {
      const mensagem =
        (err as { response?: { data?: { message?: string } } }).response?.data
          ?.message ?? 'Não consegui enviar o código para esse número.';
      toast.error(mensagem);
    } finally {
      setLoading(false);
    }
  };

  const confirmarCodigo = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await confirmar(codigo);
      toast.success('WhatsApp confirmado.');
      onVerificado();
    } catch {
      toast.error('Código inválido ou expirado. Peça um novo código.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div
          className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl"
          style={{
            background:
              etapa === 'numero'
                ? 'rgba(242,145,29,0.12)'
                : 'rgba(199,211,1,0.15)',
            border:
              etapa === 'numero'
                ? '1px solid rgba(242,145,29,0.3)'
                : '1px solid rgba(199,211,1,0.3)',
          }}
        >
          {etapa === 'numero' ? (
            <MessageCircle className="h-6 w-6" style={{ color: '#f2911d' }} />
          ) : (
            <ShieldCheck className="h-6 w-6" style={{ color: '#9fab01' }} />
          )}
        </div>

        <h2 className="text-xl font-bold text-slate-900">
          {etapa === 'numero'
            ? 'Cadastre seu WhatsApp'
            : 'Confirme o código'}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          {etapa === 'numero' ? (
            <>
              {nome ? `${nome}, ` : ''}é por ele que você recupera a senha se
              esquecer. Sem número confirmado não dá para continuar.
            </>
          ) : (
            <>
              Enviamos 6 números para{' '}
              <span className="font-medium text-slate-900">
                {enviadoPara ?? 'o seu WhatsApp'}
              </span>
              . O código vale 15 minutos.
            </>
          )}
        </p>

        {etapa === 'numero' ? (
          <form onSubmit={enviarCodigo} className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="whatsapp">WhatsApp com DDD</Label>
              <Input
                id="whatsapp"
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                inputMode="tel"
                autoComplete="tel"
                autoFocus
                placeholder="(21) 99999-8888"
                className="h-11"
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Enviar código
            </Button>
          </form>
        ) : (
          <form onSubmit={confirmarCodigo} className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="codigo-whatsapp">Código</Label>
              <Input
                id="codigo-whatsapp"
                value={codigo}
                onChange={(e) =>
                  setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))
                }
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                placeholder="000000"
                className="h-11 text-center text-2xl tracking-[0.4em]"
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar
            </Button>
            <button
              type="button"
              onClick={() => setEtapa('numero')}
              className="w-full text-center text-sm text-slate-500 hover:text-slate-700"
            >
              Digitei o número errado
            </button>
          </form>
        )}

        {onSair && (
          <button
            type="button"
            onClick={onSair}
            className="mt-5 w-full text-center text-xs text-slate-400 hover:text-slate-600"
          >
            Sair da conta
          </button>
        )}
      </div>
    </div>
  );
}
