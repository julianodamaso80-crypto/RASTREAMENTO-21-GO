import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Iniciando seed...');

  // Criar tenant padrão
  const tenant = await prisma.tenant.upsert({
    where: { slug: '21-go-rastreamento' },
    update: {},
    create: {
      name: '21 GO Rastreamento',
      slug: '21-go-rastreamento',
      document: '00000000000000',
      primaryColor: '#10b981',
    },
  });
  console.log(`Tenant criada: ${tenant.name} (${tenant.id})`);

  // Criar usuário admin
  const hashedPassword = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@rastreamento21go.com.br' },
    update: {},
    create: {
      email: 'admin@rastreamento21go.com.br',
      password: hashedPassword,
      name: 'Administrador',
      role: 'SUPER_ADMIN',
      tenantId: tenant.id,
    },
  });
  console.log(`Usuário admin criado: ${admin.email} (${admin.id})`);

  console.log('Seed concluído!');
}

main()
  .catch((e) => {
    console.error('Erro no seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
