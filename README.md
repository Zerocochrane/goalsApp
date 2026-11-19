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

| Variável                | Para que serve                                                              |
| ----------------------- | --------------------------------------------------------------------------- |
| `API_PORT` / `PORT`     | Porta da API em dev (padrão 4100). `PORT`, se definida, prevalece.          |
| `WEB_PORT`              | Porta do Vite em dev e do app em produção (padrão 4101)                     |
| `APP_URL`               | Endereço público do app (usado nos links enviados pelo WhatsApp)            |
| `JWT_SECRET`            | Texto longo e aleatório para assinar o login — **troque**                   |
| `COOKIE_SECURE`         | `false` só se o app for servido em `http://` fora do localhost              |
| `DATABASE_URL`          | Caminho do banco SQLite (`file:./data/goals.db`)                            |
| `MASTER_ADMIN_USER`     | Usuário do admin master criado no primeiro start                            |
| `MASTER_ADMIN_PASSWORD` | Senha do admin master — **troque**                                          |
| `SIGNUP_MODE`           | Cadastro pela própria pessoa: `aprovacao` (padrão), `aberto` ou `desligado` |
| `WA_SESSION_DIR`        | Pasta da sessão do WhatsApp (padrão `data/wa-session`, fora do git)         |
| `WA_SEND_INTERVAL_MS`   | Intervalo mínimo entre envios no WhatsApp (padrão 3000)                     |
| `WA_DISABLED`           | `true` desliga o WhatsApp (ex.: em desenvolvimento)                         |
| `BACKUP_DIR`            | Pasta dos backups diários do SQLite (padrão `data/backups`)                 |
| `BACKUP_KEEP_DAYS`      | Quantos dias de backup guardar (padrão 14)                                  |
| `UPLOAD_DIR`            | Pasta dos anexos das atividades (padrão `data/uploads`, fora do git)        |
| `TZ`                    | Fuso horário (`America/Sao_Paulo`)                                          |

O `server/.env` nunca é versionado.

## Execução

| Comando            | O que faz                                                           |
| ------------------ | ------------------------------------------------------------------- |
| `npm run dev`      | Sobe server (`node --watch`) e client (Vite) em paralelo            |
| `npm run build`    | Gera o build de produção do frontend em `client/dist`               |
| `npm start`        | Sobe o server, que também serve o build (`client/dist`), se existir |
| `npm test`         | Testes do backend — unidade e API (veja [Testes](#testes))          |
| `npm run test:e2e` | Compila o frontend e roda os testes de ponta a ponta (Playwright)   |
| `npm run deploy`   | Deploy no PM2 (veja [Deploy](#deploy))                              |
| `npm run lint`     | Roda o ESLint em todo o projeto (`lint:fix` corrige o que der)      |
| `npm run format`   | Formata tudo com o Prettier (`format:check` só verifica)            |

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
pelo deploy. O login aceita 5 tentativas erradas por minuto por IP. Trocar a senha (em **Meu
perfil** ou pelo admin) derruba as sessões abertas em outros aparelhos: o JWT leva a
`sessionVersion` do usuário, que sobe a cada troca. Nas rotas, use os middlewares
`requireAuth` e `requireMaster` de [`server/src/auth/middleware.js`](server/src/auth/middleware.js).

### Usuários

O **admin master** cria, edita e exclui usuários (página **Usuários**, API `/api/users` —
qualquer outro usuário recebe `403`). Cada usuário criado administra apenas os próprios dados
(atividades, telefone, sequência). O nome de usuário é guardado em minúsculas e o telefone
WhatsApp em E.164 brasileiro (`+55` + DDD + número). O master não pode excluir a si mesmo.

Em **Meu perfil** (`/api/profile`), qualquer usuário altera o próprio telefone e a própria senha
(pedindo a senha atual; 5 tentativas erradas por minuto).

### Cadastro (criar a própria conta)

Com `SIGNUP_MODE` diferente de `desligado`, a tela de login mostra **Criar conta** (`/cadastro`):
nome, nome de usuário, senha + confirmação e telefone WhatsApp (as mesmas validações da
gestão de usuários). A conta nasce **pendente**, nunca master, e o app envia pelo WhatsApp um
código de 6 dígitos (vale 10 min, até 5 tentativas; só o hash HMAC fica no banco).

| `SIGNUP_MODE`        | Depois de confirmar o telefone                                                   |
| -------------------- | -------------------------------------------------------------------------------- |
| `aprovacao` (padrão) | Fica "Aguardando aprovação" até o master **Aprovar** (ou **Recusar**, que apaga) |
| `aberto`             | Conta liberada e login automático                                                |
| `desligado`          | Sem link nem cadastro — só o master cria usuários (comportamento anterior)       |

- Conta pendente não usa a API (`403` com `code: pending_approval`). Quem fechou a tela do
  código e entra com a senha certa volta para ela (`code: phone_unverified`).
- Lembretes só vão para telefone **confirmado** de conta **ativa**. Telefone definido pelo
  master (ou trocado em "Meu perfil" por quem ele criou) já vale confirmado; quem se cadastrou
  e troca o número precisa confirmar de novo em **Meu perfil**.
- O master vê o contador na aba **Usuários**, o filtro **Aguardando aprovação** e recebe um
  aviso no WhatsApp a cada cadastro pendente (se o telefone dele estiver cadastrado). A pessoa
  aprovada também é avisada.
- API pública: `GET /api/signup/config`, `POST /api/signup`, `POST /api/signup/verify-phone`,
  `POST /api/signup/resend-code`. Master: `POST /api/users/:id/approve`,
  `POST /api/users/:id/reject`, `GET /api/users/pending-count`. Perfil:
  `POST /api/profile/phone/send-code`, `POST /api/profile/phone/verify`.

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
  `npm test` (veja [Testes](#testes)).

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

## Agendador

Serviço em [`server/src/scheduler/scheduler.js`](server/src/scheduler/scheduler.js), iniciado
pelo `server/index.js`. Roda a cada minuto (`node-cron`, fuso `America/Sao_Paulo`):

1. `pendente` com `expiresAt` vencido → `falhou`.
2. Gera as `TaskOccurrence` cujo horário já chegou (status `pendente`, token aleatório de
   32 bytes, `expiresAt` = horário + 1h). Olha 1 dia para trás, então um minuto perdido não
   perde atividade. A idempotência vem do índice único `(activityId, date)`.
3. Envia pelo WhatsApp: `*<atividade>* deve ser feita agora! Depois de concluir, clique neste
link para validar a atividade. APP_URL/validar/<token>` e grava `notifiedAt`. Se o envio
   falhar, tenta de novo a cada 2 min enquanto o link vale. Usuário sem telefone, com telefone
   não confirmado ou com a conta aguardando aprovação não recebe.

- **Recuperação após reinício:** no start, olha até 31 dias para trás. O que deveria ter sido
  gerado com o servidor fora nasce `falhou`; o que ainda está dentro de 1h é enviado.
- Uma atividade criada (ou editada) depois do horário do dia só começa a valer no próximo dia.
- Testes com relógio simulado em
  [`server/test/scheduler.test.js`](server/test/scheduler.test.js) (SQLite temporário).

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

## Testes

| Comando                   | O que roda                                                  |
| ------------------------- | ----------------------------------------------------------- |
| `npm test`                | Vitest em `server/test/` — unidade e API (Supertest), ~30 s |
| `npm run test:e2e`        | `npm run build` + Playwright em `e2e/` (Chromium; ~1–2 min) |
| `npm run test:responsivo` | `npm run build` + só `e2e/responsivo.spec.js` (roda no CI)  |

- **API** ([`server/test/api/`](server/test/api/)): o app Express real sobre um SQLite temporário
  com as migrations reais — login/cookie/JWT e rate limit, permissões (master × usuário ×
  sem login), usuários e perfil, atividades (validação, isolamento entre usuários, versões),
  calendário, validação pelo link (concluída, já validada, expirada, de outra pessoa),
  sequência, cadastro (os três modos, código certo/errado/expirado, limite de tentativas e de
  envios, aprovação/recusa, conta pendente sem acesso), amigos (pedido → aceitar/recusar/cancelar → desfazer, duplicidade, privacidade)
  e ranking (só amigos aceitos, empates, sem atividades, só números agregados). O cálculo do
  ranking tem testes unitários próprios em `server/test/leaderboard.test.js`.
- **E2E** ([`e2e/`](e2e/)): sobe `server/index.js` servindo o build, na porta 4199 (ou
  `E2E_PORT`, para rodar duas suítes ao mesmo tempo), com banco próprio em `e2e/.data/` (apagado a cada execução) e WhatsApp desligado.
  - `fluxo.spec.js`: login → criar atividade → validar pelo link → dia verde; e link expirado →
    atividade e dia vermelhos. A atividade é de amanhã e o agendador roda com relógio simulado,
    então o teste não depende da hora em que roda.
  - `cadastro.spec.js`: pelo celular, criar a conta → código do WhatsApp → master aprova →
    entrar e criar atividade; voltar à tela do código pelo login; recusar; telas do cadastro
    em 320–1280 px, claro e escuro.
  - `amigos.spec.js`: dois usuários viram amigos pela tela (contador na aba, aceitar, remover
    com confirmação), recusar e cancelar pedidos, sem expor atividades nem telefone.
  - `ranking.spec.js`: ranking por sequência e mês com pódio, "Você" destacado, quem não tem
    atividades no fim, estado vazio e atualização ao voltar para a aba.
  - `revisao.spec.js`: todas as telas em claro e escuro, no celular (360 px), tablet e desktop —
    textos em pt-BR, cores do tema e nenhuma rolagem horizontal. Grava um print de cada tela em
    `test-results/`.
  - `responsivo.spec.js`: todas as telas em 320, 375, 414, 768 e 1280 px, claro e escuro, com
    dados longos (nomes de 80 caracteres, sequência de 3 dígitos). Falha com rolagem
    horizontal, elemento saindo da tela ou controle menor que 44×44 px no celular. Roda no job
    **responsivo** do GitHub Actions antes do deploy — se falhar, o deploy não acontece — e as
    capturas ficam no artefato `capturas-responsivo`.
- Na primeira vez, instale o navegador: `npx playwright install chromium`.

## Revisão de segurança

| Item          | Como está                                                                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Senhas        | bcrypt (12 rounds); usuário inexistente gasta o mesmo tempo (não revela quem existe)                                                           |
| Cookie        | `goals_session`: `httpOnly`, `sameSite=lax`, `secure` com `APP_URL` em HTTPS, 7 dias                                                           |
| JWT           | HS256 fixo (rejeita `none`/outro algoritmo); `sessionVersion` derruba sessões ao trocar a senha                                                |
| Rate limit    | Login: 5 erros/min por IP (IP real via Nginx, `trust proxy` só do loopback). Troca de senha: 5 erros/min por usuário                           |
| Cadastro      | 10/hora por IP; código do WhatsApp: 1/min e 5/hora por IP e 1/min por conta; 5 tentativas por código; campo isca; não revela telefone já usado |
| Permissões    | Tudo em `/api` exige login; `/api/users` e `/api/whatsapp` só master; dados sempre do próprio usuário (404 para o de outro)                    |
| Link WhatsApp | Token aleatório de 32 bytes; exige login do dono; vale 1 hora e uma única vez (UPDATE condicional)                                             |
| Cabeçalhos    | `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy` (o Nginx acrescenta HSTS)                                                 |
| Entrada       | JSON até 100 kB; validação de todos os campos no servidor; `redirect` do login só aceita caminhos internos                                     |

Ponto em aberto: não há CSP (o `index.html` tem um script inline que aplica o tema antes da
primeira pintura); o `sameSite=lax` já impede que outro site use a sessão em POSTs.

## Deploy

Cada push na `main` publica o app no servidor via GitHub Actions
([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)), que envia o código e roda
`npm run deploy` ([`scripts/deploy-pm2.sh`](scripts/deploy-pm2.sh)).

### Como roda em produção

- **Um único processo** no PM2, `goals-app` ([`ecosystem.config.cjs`](ecosystem.config.cjs)):
  o Express serve a API (`/api`) e o build do React (`client/dist`), com fallback para
  `index.html` nas rotas do React Router. Escuta em `WEB_PORT` (4101), só para o Nginx.
- **1 instância em modo fork** — nunca cluster nem mais instâncias: o agendador e a sessão do
  WhatsApp não podem duplicar.
- `NODE_ENV=production`, `TZ=America/Sao_Paulo`. Logs em `logs/app-*.log`, com rotação diária
  pelo `pm2-logrotate` (10 MB, 14 arquivos, compactados — instalado pelo deploy).
- O que sobrevive a reinícios e deploys (fica em `server/data/`, que o deploy nunca apaga):
  banco SQLite, sessão do WhatsApp (`wa-session/`, reconecta sem QR Code) e backups. No start,
  o agendador recupera o que ficou para trás enquanto o app estava fora.

### `npm run deploy`

No servidor, na pasta do app (como o usuário do PM2, sem `sudo`):

1. confere o `server/.env` e a porta; instala o `pm2-logrotate` se faltar;
2. `npm install` do server; **backup** do banco; para o app (o `prisma migrate deploy` precisa
   do SQLite sem uso) e aplica as migrações;
3. `npm install` + `vite build` do client;
4. `pm2 startOrReload ecosystem.config.cjs` + `pm2 save`;
5. espera `GET /api/health` e `/` responderem.

Na primeira vez, ele também remove os processos antigos `goals-api`/`goals-web`.

### Subir junto com o servidor (`pm2 startup`)

Uma vez só, para o PM2 voltar (com o `goals-app`) depois de um reboot da máquina:

```bash
pm2 startup        # imprime um comando "sudo env PATH=… pm2 startup systemd -u …": rode-o
npm run deploy     # sobe o app e roda "pm2 save" (lista salva = o que volta no boot)
```

Depois de mexer nos processos à mão, rode `pm2 save` de novo. Comandos úteis: `pm2 status`,
`pm2 logs goals-app`, `pm2 reload goals-app`.

### Nginx + HTTPS

O app precisa de HTTPS: o link do WhatsApp usa `APP_URL` e o cookie de login é `secure` com
`https://`. Exemplo de proxy reverso com Let's Encrypt (certbot), com o passo a passo nos
comentários: [`deploy/nginx/goals.conf.example`](deploy/nginx/goals.conf.example). Depois, defina
`APP_URL=https://seu.dominio` em `server/.env` e rode `npm run deploy`.

### Backup do SQLite

- Todo dia às 03:00 o próprio app grava `server/data/backups/goals-AAAA-MM-DD.db` (via
  `VACUUM INTO`, seguro com o app rodando) e apaga os com mais de `BACKUP_KEEP_DAYS` dias.
  O deploy também faz um antes das migrações. Manual: `npm run backup --prefix server`.
- Os anexos das atividades (`server/data/uploads`) são copiados no mesmo horário para
  `server/data/backups/uploads/`; os removidos do app ficam lá por `BACKUP_KEEP_DAYS` dias.
  Restaurar: copie os arquivos de volta para `server/data/uploads/`.
- Os backups ficam no mesmo disco: copie-os para fora de vez em quando (ex.: `rsync`/`scp`).
- Restaurar: `pm2 stop goals-app`, copie o backup sobre `server/data/goals.db` (apague
  `goals.db-wal` e `goals.db-shm`), `pm2 start goals-app`.

### Saúde

`GET /api/health` (público) → `200 {"status":"ok","database":"ok","whatsapp":"open",…}`, ou `503`
se o banco não responder. Usado pelo deploy; serve para monitoramento externo.
