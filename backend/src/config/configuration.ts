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
  },
  server: {
    primaryIp: process.env.SERVER_PRIMARY_IP || '0.0.0.0',
    secondaryIp: process.env.SERVER_SECONDARY_IP || '0.0.0.0',
  },
});
