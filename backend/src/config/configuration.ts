export default () => ({
  port: parseInt(process.env.PORT || '3001', 10),
  database: {
    url: process.env.DATABASE_URL,
  },
  redis: {
    url: process.env.REDIS_URL,
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret',
    expiration: process.env.JWT_EXPIRATION || '24h',
    // Segredo PRÓPRIO do mundo do associado. Diferente do interno de propósito:
    // é o que torna um token de cliente matematicamente inválido no painel.
    associateSecret: process.env.JWT_ASSOCIATE_SECRET || 'dev-associate-secret',
    // Sessão do time interno é mais curta que a do cliente — o celular de quem
    // trabalha carrega o sistema inteiro no bolso.
    internalExpiration: process.env.JWT_INTERNAL_EXPIRATION || '12h',
    // Vira 'true' no segundo deploy, quando todo token legado (sem `type`)
    // já expirou. Antes disso, exigir o campo derrubaria quem está logado.
    requireType: process.env.JWT_REQUIRE_TYPE === 'true',
  },
  traccar: {
    url: process.env.TRACCAR_URL || 'http://localhost:8082',
    apiUrl: process.env.TRACCAR_API_URL || 'http://localhost:8082/api',
    adminEmail:
      process.env.TRACCAR_ADMIN_EMAIL || 'admin@rastreamento21go.com.br',
    adminPassword: process.env.TRACCAR_ADMIN_PASSWORD || 'admin123',
  },
  hinova: {
    // API SGA Hinova v2 — credenciais reais (copiadas do Controle de Acesso).
    baseUrl:
      process.env.HINOVA_SGA_BASE_URL ||
      process.env.HINOVA_BASE_URL ||
      'https://api.hinova.com.br/api/sga/v2',
    token: process.env.HINOVA_SGA_TOKEN,
    usuario: process.env.HINOVA_SGA_USUARIO,
    senha: process.env.HINOVA_SGA_SENHA,
    verifySsl: process.env.HINOVA_SGA_VERIFY_SSL !== 'false',
    mock: process.env.HINOVA_MOCK === 'true',
    syncInterval: parseInt(process.env.HINOVA_SYNC_INTERVAL || '21600000', 10),
    // Em prod: 'false' enquanto não temos credenciais Hinova reais.
    // Caso contrário o cron do mock cria vehicles/associates fantasmas.
    syncEnabled: process.env.HINOVA_SYNC_ENABLED || 'true',
    // Flag SEPARADA de propósito. O sync acima escreve em Vehicle/Associate e
    // por isso vive desligado; o de pendências só toca a tabela espelho
    // installation_pendings, que é descartável — desligar não protege nada.
    pendingsSyncEnabled: process.env.INSTALLATION_PENDINGS_SYNC_ENABLED || 'true',
  },
  server: {
    primaryIp: process.env.SERVER_PRIMARY_IP || '0.0.0.0',
    secondaryIp: process.env.SERVER_SECONDARY_IP || '0.0.0.0',
  },
  whatsapp: {
    // 'meta' (Cloud API oficial), 'evolution' (instância própria) ou 'none'.
    // Fica 'none' até o número ser liberado — o reset pelo painel cobre o
    // atendimento nesse meio-tempo.
    provider: process.env.WHATSAPP_PROVIDER || 'none',
    meta: {
      token: process.env.WHATSAPP_META_TOKEN,
      phoneNumberId: process.env.WHATSAPP_META_PHONE_NUMBER_ID,
      // Template da categoria AUTHENTICATION aprovado no Meta Business.
      // Sem ele a Meta recusa o envio — exigência da plataforma, não nossa.
      template: process.env.WHATSAPP_META_TEMPLATE || 'codigo_verificacao',
      language: process.env.WHATSAPP_META_LANGUAGE || 'pt_BR',
      apiVersion: process.env.WHATSAPP_META_API_VERSION || 'v21.0',
      // 'false' quando o template foi criado SEM botão de copiar código.
      copyCodeButton: process.env.WHATSAPP_META_COPY_BUTTON || 'true',
    },
    evolution: {
      url: process.env.EVOLUTION_API_URL,
      apiKey: process.env.EVOLUTION_API_KEY,
      instance: process.env.EVOLUTION_INSTANCE,
    },
  },
  positions: {
    // Histórico de posições cresce pra sempre e enche o disco do droplet —
    // disco cheio derruba TUDO. 90 dias cobre investigação de sinistro com
    // folga. `0` desliga a limpeza (usar só se migrar pra particionamento).
    retentionDays: parseInt(process.env.POSITION_RETENTION_DAYS || '90', 10),
  },
});
