import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../common/decorators';

const PRIVACY_HTML = `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Política de Privacidade — Track Go Rastreamento</title>
<style>
  :root{--navy:#293c82;--orange:#f2911d;--text:#0f172a;--muted:#475569}
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Inter,sans-serif;color:var(--text);line-height:1.65;background:#f8fafc}
  header{background:var(--navy);color:#fff;padding:40px 20px}
  .wrap{max-width:780px;margin:0 auto;padding:0 20px}
  header .wrap{display:flex;align-items:center;gap:14px}
  .logo{width:46px;height:46px;border-radius:13px;background:#1f2d63;display:flex;align-items:center;justify-content:center}
  h1{font-size:22px;margin:0}
  .tag{font-size:12px;letter-spacing:2px;color:#c7d301;font-weight:700}
  main{padding:36px 0 60px}
  h2{color:var(--navy);font-size:19px;margin-top:32px}
  p,li{color:var(--muted);font-size:15.5px}
  .upd{color:#94a3b8;font-size:13px}
  a{color:var(--orange)}
  footer{border-top:1px solid #e2e8f0;padding:24px 0;color:#94a3b8;font-size:13px}
</style></head>
<body>
<header><div class="wrap">
  <div class="logo">
    <svg width="26" height="26" viewBox="0 0 64 64"><circle cx="32" cy="32" r="22" fill="none" stroke="#f2911d" stroke-width="8" stroke-linecap="round" stroke-dasharray="115 6" transform="rotate(-30 32 32)"/><path d="M22 36c0-4.4 3.6-8 8-8s8 3.6 8 8c0 6-8 14-8 14s-8-8-8-14z" fill="#c7d301"/><circle cx="30" cy="36" r="3" fill="#fff"/></svg>
  </div>
  <div><h1>Track Go Rastreamento</h1><div class="tag">PROTEÇÃO VEICULAR</div></div>
</div></header>
<main class="wrap">
  <h1 style="color:#0f172a">Política de Privacidade</h1>
  <p class="upd">Última atualização: junho de 2026</p>

  <p>Esta Política de Privacidade descreve como o aplicativo <strong>Track Go Rastreamento</strong>
  (o "App"), oferecido pela 21 Go Proteção Veicular, coleta, usa e protege as informações dos
  associados que utilizam o serviço de rastreamento veicular.</p>

  <h2>1. Dados que coletamos</h2>
  <ul>
    <li><strong>CPF e senha:</strong> usados exclusivamente para autenticar o associado no login do App.</li>
    <li><strong>Dados do veículo:</strong> placa, modelo e a localização (GPS) reportada pelo
    rastreador instalado no veículo vinculado à conta do associado.</li>
  </ul>
  <p>O App <strong>não coleta a localização do seu celular</strong> e não acessa contatos, fotos,
  microfone ou câmera. A posição exibida no mapa é a do <em>veículo</em>, enviada pelo
  equipamento de rastreamento ao nosso servidor.</p>

  <h2>2. Como usamos os dados</h2>
  <p>Os dados são utilizados apenas para o funcionamento do serviço: permitir o login, exibir a
  localização do veículo em tempo real, mostrar o histórico de trajetos e os alertas. Não usamos
  os dados para publicidade nem para rastrear você em outros apps ou sites.</p>

  <h2>3. Compartilhamento</h2>
  <p>Não vendemos nem compartilhamos seus dados com terceiros para fins comerciais. As informações
  são acessíveis apenas a você e à sua associação ou empresa de proteção veicular responsável pela
  sua conta.</p>

  <h2>4. Segurança</h2>
  <p>O acesso é protegido por CPF e senha, com senhas armazenadas de forma criptografada. A
  comunicação entre o App e o servidor é feita por conexão segura (HTTPS).</p>

  <h2>5. Seus direitos (LGPD)</h2>
  <p>Conforme a Lei Geral de Proteção de Dados (Lei nº 13.709/2018), você pode solicitar acesso,
  correção ou exclusão dos seus dados, bem como informações sobre o tratamento realizado. Para
  exercer esses direitos, entre em contato pelos canais abaixo.</p>

  <h2>6. Exclusão de conta e dados</h2>
  <p>Para solicitar a exclusão da sua conta e dos dados associados, entre em contato com a sua
  associação ou pelo e-mail informado abaixo.</p>

  <h2>7. Contato</h2>
  <p>Dúvidas sobre esta política ou sobre seus dados:<br>
  E-mail: <a href="mailto:contato@trackgo.site">contato@trackgo.site</a><br>
  Site: <a href="https://trackgo.site">trackgo.site</a></p>
</main>
<footer class="wrap">© 2026 21 Go Proteção Veicular — Track Go Rastreamento. Todos os direitos reservados.</footer>
</body></html>`;

@ApiExcludeController()
@Controller()
export class LegalController {
  @Public()
  @Get(['privacidade', 'privacy'])
  @Header('Content-Type', 'text/html; charset=utf-8')
  privacy(): string {
    return PRIVACY_HTML;
  }
}
