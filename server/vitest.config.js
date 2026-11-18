import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    // Cada arquivo roda em um processo próprio, com o seu SQLite temporário
    pool: 'forks',
    env: {
      TZ: 'America/Sao_Paulo',
      JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres',
      WA_DISABLED: 'true',
      APP_URL: 'http://localhost:4101',
      COOKIE_SECURE: '',
    },
    // bcrypt com 12 rounds é lento de propósito
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
