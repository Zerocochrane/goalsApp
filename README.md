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

| Variável                | Para que serve                                                      |
| ----------------------- | ------------------------------------------------------------------- |
| `API_PORT` / `PORT`     | Porta da API (padrão 4100). `PORT`, se definida, tem prioridade.    |
| `WEB_PORT`              | Porta do frontend (padrão 4101)                                     |
| `APP_URL`               | Endereço público do app (usado nos links enviados pelo WhatsApp)    |
| `JWT_SECRET`            | Texto longo e aleatório para assinar o login — **troque**           |
| `COOKIE_SECURE`         | `false` só se o app for servido em `http://` fora do localhost      |
| `DATABASE_URL`          | Caminho do banco SQLite (`file:./data/goals.db`)                    |
| `MASTER_ADMIN_USER`     | Usuário do admin master criado no primeiro start                    |
| `MASTER_ADMIN_PASSWORD` | Senha do admin master — **troque**                                  |
| `WA_SESSION_DIR`        | Pasta da sessão do WhatsApp (padrão `data/wa-session`, fora do git) |
| `WA_SEND_INTERVAL_MS`   | Intervalo mínimo entre envios no WhatsApp (padrão 3000)             |
| `WA_DISABLED`           | `true` desliga o WhatsApp (ex.: em desenvolvimento)                 |
| `TZ`                    | Fuso horário (`America/Sao_Paulo`)                                  |

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

## Autenticação

Login com usuário e senha (hash bcrypt). A sessão é um JWT (7 dias) num cookie `httpOnly`,
`secure`, `sameSite=lax`. No primeiro start, o servidor cria o **admin master** com
`MASTER_ADMIN_USER` / `MASTER_ADMIN_PASSWORD` (só se ainda não existir — mudar a senha no `.env`
depois não altera um admin já criado).

| Rota                    | O que faz                                                  |
| ----------------------- | ---------------------------------------------------------- |
| `POST /api/auth/login`  | `{ username, password }` → grava o cookie e devolve `user` |
| `POST /api/auth/logout` | Apaga o cookie                                             |
| `GET /api/auth/me`      | Usuário logado (401 sem sessão)                            |

Todas as outras rotas `/api/*` exigem login (401 sem sessão), exceto `GET /api/health`, usada
pelo deploy. O login aceita 5 tentativas erradas por minuto por IP. Nas rotas, use os middlewares
`requireAuth` e `requireMaster` de [`server/src/auth/middleware.js`](server/src/auth/middleware.js).

### Usuários

Só o **admin master** cria, edita e exclui usuários (página **Usuários**, API `/api/users` —
qualquer outro usuário recebe `403`). Cada usuário criado administra apenas os próprios dados
(atividades, telefone, sequência). O nome de usuário é guardado em minúsculas e o telefone
WhatsApp em E.164 brasileiro (`+55` + DDD + número). O master não pode excluir a si mesmo.

Em **Meu perfil** (`/api/profile`), qualquer usuário altera o próprio telefone e a própria senha
(pedindo a senha atual).

## Atividades e calendário

Cada usuário só vê e altera as próprias atividades (de outro usuário → `404`).

| Rota                                       | O que faz                                                     |
| ------------------------------------------ | ------------------------------------------------------------- |
| `GET /api/activities`                      | Atividades ativas do usuário, por horário                     |
| `POST /api/activities`                     | `{ name, hour, minute, weekdays, startDate? }` (padrão: hoje) |
| `PUT /api/activities/:id`                  | Edita (campos omitidos ficam como estão)                      |
| `DELETE /api/activities/:id`               | Exclusão lógica (`active=false`)                              |
| `GET /api/calendar?start=AAAA-MM-DD&end=…` | Por dia: atividades previstas + ocorrências + status do dia   |

- `weekdays`: dias 0–6 (0 = domingo); pelo menos um. `startDate` não pode ser no passado.
- A atividade repete nos dias escolhidos a partir de `startDate` até `endDate` (null = sem fim).
- **Dias passados não mudam:** editar ou excluir uma atividade que já valeu em algum dia encerra
  essa versão (`active=false`, `endDate` = véspera) e, na edição, cria uma nova versão (novo `id`;
  a resposta traz `previousId`). Ocorrências já geradas ficam com a versão que as gerou. Se a
  ocorrência de hoje já foi enviada ou resolvida, a mudança vale a partir de amanhã.
- Status do dia: `vazio` (sem atividades), `falhou` (alguma falhou), `concluido` (todas
  concluídas) ou `pendente`. O período do calendário vai até 93 dias.
- Datas são AAAA-MM-DD em `America/Sao_Paulo` — lógica em
  [`server/src/activities/recurrence.js`](server/src/activities/recurrence.js), testada com
  `npm test --prefix server` (`node --test`).

## WhatsApp (Baileys)

> ⚠ Baileys é uma biblioteca **não oficial**: use um **número dedicado** — há risco de bloqueio.

- Serviço em [`server/src/whatsapp/whatsapp.js`](server/src/whatsapp/whatsapp.js):
  `sendMessage(phone, text)` (E.164) entra numa fila, envia um por vez com intervalo mínimo de
  `WA_SEND_INTERVAL_MS` e grava cada envio/falha na tabela `MessageLog` (e no log do PM2).
- **Parear:** página **WhatsApp** (só master) → **Conectar** → ler o QR Code em
  _Dispositivos conectados_ no celular. A sessão fica em `server/data/wa-session` (o deploy não
  apaga), então reinícios do PM2 reconectam sem novo QR Code. Se a conexão cair, reconecta
  sozinho (espera crescente até 1 min). Se o QR Code expirar sem leitura, basta clicar em
  **Conectar** de novo.
- **Desconectar** na página (ou encerrar a sessão no celular) apaga a sessão; é preciso parear
  de novo.
- API (só master): `GET /api/whatsapp` (status, QR, últimos envios), `POST /api/whatsapp/connect`,
  `POST /api/whatsapp/logout`, `POST /api/whatsapp/test` `{ phone, text }`.
- Não rode o mesmo número em dois servidores ao mesmo tempo (ex.: dev e produção): use
  `WA_DISABLED=true` no ambiente que não deve conectar.

## Frontend

React 19 + Vite, com React Router 7 (o 8 exige Node 22) e `date-fns` com locale `ptBR`.

| Onde                                                         | O quê                                                                            |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| [`client/src/i18n/pt-BR.js`](client/src/i18n/pt-BR.js)       | **Todos** os textos da interface — nada de texto fixo nos componentes            |
| [`client/src/auth/`](client/src/auth/)                       | Contexto de login (`/api/auth/me` ao carregar) e rotas protegidas                |
| [`client/src/lib/api.js`](client/src/lib/api.js)             | `api(path, { method, body })` — chama `/api`; um 401 encerra a sessão no app     |
| [`client/src/lib/dates.js`](client/src/lib/dates.js)         | `format()` / `formatLongDate()` do date-fns já em pt-BR                          |
| [`client/src/styles/theme.css`](client/src/styles/theme.css) | Variáveis CSS de cor; modo escuro pelo sistema ou por `<html data-theme="dark">` |

Sem sessão, qualquer rota protegida manda para `/login?redirect=<url original>` e, depois do
login, volta para essa URL (usado pelo link de validação enviado no WhatsApp). Só caminhos
internos são aceitos no `redirect`.

## Deploy

Cada push na `main` publica o app no servidor via GitHub Actions
([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)), que roda
[`scripts/deploy-pm2.sh`](scripts/deploy-pm2.sh). No servidor, os processos `goals-api` e
`goals-web` rodam no PM2 conforme [`ecosystem.config.cjs`](ecosystem.config.cjs) — sempre
**1 instância em modo fork** (SQLite, agendador e sessão do WhatsApp não podem duplicar).
