import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

interface SendPasswordResetArgs {
  to: string;
  name: string;
  resetUrl: string;
  expiresInMinutes: number;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;
  private readonly fromAddress: string;
  private readonly mockMode: boolean;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    this.fromAddress = process.env.EMAIL_FROM || 'Rastreamento 21GO <no-reply@trackgo.site>';
    this.mockMode = !apiKey;
    this.resend = apiKey ? new Resend(apiKey) : null;
    if (this.mockMode) {
      this.logger.warn('RESEND_API_KEY não configurada — EmailService em modo mock (loga no console)');
    }
  }

  async sendPasswordReset(args: SendPasswordResetArgs): Promise<void> {
    const { to, name, resetUrl, expiresInMinutes } = args;
    const subject = 'Redefinição de senha - Rastreamento 21GO';
    const html = this.passwordResetTemplate(name, resetUrl, expiresInMinutes);
    const text = this.passwordResetTextTemplate(name, resetUrl, expiresInMinutes);

    if (this.mockMode || !this.resend) {
      this.logger.log(`[MOCK EMAIL] to=${to} subject="${subject}"`);
      this.logger.log(`[MOCK EMAIL] reset URL: ${resetUrl}`);
      return;
    }

    try {
      const { data, error } = await this.resend.emails.send({
        from: this.fromAddress,
        to,
        subject,
        html,
        text,
      });
      if (error) {
        this.logger.error(`Resend falhou ao enviar reset para ${to}: ${JSON.stringify(error)}`);
        throw new Error(`Falha ao enviar email: ${error.message}`);
      }
      this.logger.log(`Email de reset enviado para ${to} (id=${data?.id})`);
    } catch (err) {
      // Não propagamos erro de envio pro controller — o response é sempre 202
      // pra não vazar se o email existe. Apenas logamos.
      this.logger.error(`Exceção no envio de email pra ${to}: ${String(err)}`);
    }
  }

  private passwordResetTemplate(name: string, resetUrl: string, minutes: number): string {
    return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<title>Redefinição de senha</title>
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#e2e8f0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#1e293b;border-radius:12px;overflow:hidden;border:1px solid #334155;">
          <tr>
            <td style="padding:32px 32px 16px;">
              <div style="font-size:20px;font-weight:700;color:#10b981;">Rastreamento 21GO</div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 0;">
              <h1 style="margin:0;font-size:20px;color:#f1f5f9;">Redefinição de senha</h1>
              <p style="margin:16px 0;font-size:14px;line-height:1.6;color:#cbd5e1;">Olá ${this.escapeHtml(name)},</p>
              <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#cbd5e1;">
                Recebemos um pedido pra redefinir sua senha. Clique no botão abaixo pra criar uma nova.
                Este link expira em <strong style="color:#f1f5f9;">${minutes} minutos</strong> e só pode ser usado uma vez.
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:16px 32px 8px;">
              <a href="${resetUrl}" style="display:inline-block;background:#10b981;color:#0f172a;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px;">Redefinir senha</a>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;">
              <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;">
                Se o botão não funcionar, copie e cole este link no navegador:
                <br/>
                <span style="word-break:break-all;color:#38bdf8;">${resetUrl}</span>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 32px;border-top:1px solid #334155;">
              <p style="margin:0;font-size:12px;line-height:1.6;color:#64748b;">
                Se você não pediu essa redefinição, ignore este email — sua senha continua a mesma.
                Nenhuma ação é necessária.
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0;font-size:11px;color:#475569;">© Rastreamento 21GO</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private passwordResetTextTemplate(name: string, resetUrl: string, minutes: number): string {
    return `Olá ${name},

Recebemos um pedido pra redefinir sua senha no Rastreamento 21GO.
Abra este link pra criar uma nova (expira em ${minutes} minutos, uso único):

${resetUrl}

Se você não pediu essa redefinição, ignore este email.

— Rastreamento 21GO`;
  }

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
