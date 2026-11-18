# Goals App

Monorepo com o frontend e o backend do Goals App.

| Pasta     | O que é                                     |
| --------- | ------------------------------------------- |
| `client/` | Frontend — React + Vite                     |
| `server/` | Backend — Node.js + Express (API em `/api`) |

**Stack:** React (Vite) · Node.js (Express) · SQLite (better-sqlite3 + Prisma) · WhatsApp via Baileys · PM2 (1 instância, modo fork) · Fuso `America/Sao_Paulo`.

## Pré-requisitos

- Node.js 20 — a versão está fixada em [`.nvmrc`](.nvmrc), a mesma do servidor (mínimo **20.19**,
  exigido pelo Vite 8 e pelo ESLint 10).
  Com o nvm: `nvm install && nvm use` (no Windows, com nvm-windows: `nvm install 20 && nvm use 20`).
- npm (vem com o Node).

## Instalação

```bash
npm install
```

O `npm install` na raiz instala as ferramentas compartilhadas (ESLint, Prettier, concurrently) e,
em seguida, as dependências de `server/` e `client/`.

Crie o arquivo de configuração do backend a partir do exemplo e ajuste os valores:

```bash
cp server/.env.example server/.env
```

| Variável                | Para que serve                                                   |
| ----------------------- | ---------------------------------------------------------------- |
| `API_PORT` / `PORT`     | Porta da API (padrão 4100). `PORT`, se definida, tem prioridade. |
| `WEB_PORT`              | Porta do frontend (padrão 4101)                                  |
| `APP_URL`               | Endereço público do app (usado nos links enviados pelo WhatsApp) |
| `JWT_SECRET`            | Texto longo e aleatório para assinar o login — **troque**        |
| `DATABASE_URL`          | Caminho do banco SQLite (`file:./data/goals.db`)                 |
| `MASTER_ADMIN_USER`     | Usuário do admin master criado no primeiro start                 |
| `MASTER_ADMIN_PASSWORD` | Senha do admin master — **troque**                               |
| `TZ`                    | Fuso horário (`America/Sao_Paulo`)                               |

O `server/.env` nunca é versionado.

## Execução

| Comando          | O que faz                                                            |
| ---------------- | -------------------------------------------------------------------- |
| `npm run dev`    | Sobe server (`node --watch`) e client (Vite) em paralelo             |
| `npm run build`  | Gera o build de produção do frontend em `client/dist`                |
| `npm start`      | Sobe server e client em modo produção (o client serve `client/dist`) |
| `npm run lint`   | Roda o ESLint em todo o projeto (`lint:fix` corrige o que der)       |
| `npm run format` | Formata tudo com o Prettier (`format:check` só verifica)             |

Em desenvolvimento, abra <http://localhost:4101>. O Vite encaminha `/api` para a API
(<http://localhost:4100/api/health> responde `{"status":"ok"}`).

## Banco de dados

SQLite com Prisma 7 (driver `better-sqlite3`). O schema fica em
[`server/prisma/schema.prisma`](server/prisma/schema.prisma) e o cliente é um singleton em
[`server/src/db/prisma.js`](server/src/db/prisma.js), que liga o modo WAL ao iniciar o servidor.

| Comando (em `server/`) | O que faz                                                     |
| ---------------------- | ------------------------------------------------------------- |
| `npm run db:migrate`   | `prisma migrate dev` — cria o banco do zero / nova migration  |
| `npm run db:deploy`    | `prisma migrate deploy` — aplica migrations (usado no deploy) |
| `npm run db:generate`  | Regera o Prisma Client (roda sozinho no `npm install`)        |
| `npm run db:studio`    | Abre o Prisma Studio para ver os dados                        |

## Deploy

Cada push na `main` publica o app no servidor via GitHub Actions
([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)), que roda
[`scripts/deploy-pm2.sh`](scripts/deploy-pm2.sh). No servidor, os processos `goals-api` e
`goals-web` rodam no PM2 conforme [`ecosystem.config.cjs`](ecosystem.config.cjs) — sempre
**1 instância em modo fork** (SQLite, agendador e sessão do WhatsApp não podem duplicar).
