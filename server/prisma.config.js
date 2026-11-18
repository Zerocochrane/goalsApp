// Configuração do Prisma CLI (migrate, generate, studio).
// O DATABASE_URL vem de server/.env; caminhos relativos partem da pasta server/.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL || 'file:./data/goals.db' },
});
