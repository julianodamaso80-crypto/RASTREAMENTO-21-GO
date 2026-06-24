/**
 * Define/redefine a senha de um associado pra acessar o app mobile.
 *
 * Uso:
 *   npx ts-node prisma/set-associate-password.ts <cpf> <senha>
 *
 * Ex.: npx ts-node prisma/set-associate-password.ts 123.456.789-00 minhasenha
 *
 * Operacional até existir UI de gestão/convite. CPF aceita máscara (normalizado).
 */
import { PrismaClient } from '.prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const [, , rawCpf, password] = process.argv;
  if (!rawCpf || !password) {
    console.error('Uso: ts-node prisma/set-associate-password.ts <cpf> <senha>');
    process.exit(1);
  }
  if (password.length < 6) {
    console.error('Senha precisa ter ao menos 6 caracteres.');
    process.exit(1);
  }

  const cpf = rawCpf.replace(/\D/g, '');
  const associate = await prisma.associate.findFirst({
    where: { cpf, deletedAt: null },
    select: { id: true, name: true },
  });

  if (!associate) {
    console.error(`Nenhum associado ativo com CPF ${cpf}.`);
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 10);
  await prisma.associate.update({
    where: { id: associate.id },
    data: { password: hash },
  });

  console.log(`✓ Senha definida para "${associate.name}" (CPF ${cpf}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
