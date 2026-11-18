#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# deploy-pm2.sh — instala dependências, compila o frontend e (re)inicia o
# Goals App no PM2. Pode ser rodado de novo a cada atualização do código.
# Chamado automaticamente pelo GitHub Actions (.github/workflows/deploy.yml).
#
# Uso:   bash scripts/deploy-pm2.sh
# Rode como o mesmo usuário (sem sudo) que roda o PM2 do Site.
# Só mexe nos processos goals-api e goals-web — o Site não é afetado.
# -----------------------------------------------------------------------------
set -euo pipefail

APPS="goals-api goals-web"

info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m✔\033[0m  %s\n' "$*"; }
warn()  { printf '\033[1;33m!\033[0m  %s\n' "$*"; }
fail()  { printf '\033[1;31m✘\033[0m  %s\n' "$*" >&2; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
info "Pasta do projeto: $ROOT"

# Enquanto o código do app (issues #1–#14) não existir, não há o que publicar.
if [ ! -f server/package.json ] || [ ! -f client/package.json ]; then
  warn "server/package.json ou client/package.json ainda não existem — nada para publicar por enquanto."
  exit 0
fi

command -v node >/dev/null || fail "Node.js não está instalado."
NODE_MAJOR="$(node -v | sed -E 's/^v([0-9]+)\..*/\1/')"
NODE_MINOR="$(node -v | sed -E 's/^v[0-9]+\.([0-9]+).*/\1/')"
# Vite 8 e ESLint 10 exigem Node 20.19+ (ou 22.12+)
if [ "$NODE_MAJOR" -lt 20 ] || { [ "$NODE_MAJOR" -eq 20 ] && [ "$NODE_MINOR" -lt 19 ]; }; then
  fail "Este projeto precisa do Node.js 20.19 ou superior (encontrado $(node -v))."
fi
command -v pm2 >/dev/null || fail "PM2 não está instalado."

# Corrige finais de linha do Windows
for f in server/.env server/.env.example scripts/*.sh; do
  [ -f "$f" ] && sed -i 's/\r$//' "$f"
done

# 1. Configuração -------------------------------------------------------------
if [ ! -f server/.env ]; then
  cp server/.env.example server/.env
  warn "server/.env criado a partir do exemplo."
  fail "Edite server/.env (MASTER_ADMIN_PASSWORD, JWT_SECRET, APP_URL) e rode o deploy de novo."
fi
env_get() { grep -E "^$1=" server/.env | tail -n1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/'; }

[ "$(env_get MASTER_ADMIN_PASSWORD)" = "change-me" ] && fail "Defina uma MASTER_ADMIN_PASSWORD real em server/.env."
case "$(env_get JWT_SECRET)" in
  ""|replace-with-a-long-random-string) fail "Defina JWT_SECRET em server/.env." ;;
esac
API_PORT="$(env_get API_PORT)"; API_PORT="${API_PORT:-4100}"
WEB_PORT="$(env_get WEB_PORT)"; WEB_PORT="${WEB_PORT:-4101}"
[ "$API_PORT" != "$WEB_PORT" ] || fail "API_PORT e WEB_PORT precisam ser diferentes."

# Garante que as portas não estão ocupadas por outro processo (ex.: o Site)
port_owner() { ss -ltnpH "( sport = :$1 )" 2>/dev/null | grep -o 'pid=[0-9]*' | head -n1 | cut -d= -f2; }
for P in "$API_PORT" "$WEB_PORT"; do
  PID="$(port_owner "$P" || true)"
  if [ -n "$PID" ]; then
    NAME="$(pm2 jlist 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const a=JSON.parse(d).find(x=>x.pid==$PID);console.log(a?a.name:'')}catch{console.log('')}})" || true)"
    case " $APPS " in
      *" $NAME "*) ;;  # é o próprio Goals App (reinício)
      *) fail "A porta $P já está em uso por outro processo (pid $PID${NAME:+, pm2: $NAME}). Escolha outra em server/.env." ;;
    esac
  fi
done
ok "Configuração ok (API na porta $API_PORT, frontend na porta $WEB_PORT)"

mkdir -p server/data logs

# 2. Dependências, banco e build ----------------------------------------------
info "Instalando dependências do servidor…"
npm install --prefix server --omit=dev --no-audit --no-fund
if [ -f server/prisma/schema.prisma ]; then
  info "Aplicando migrações do banco…"
  (cd server && npx --no-install prisma generate)
  # O goals-api em execução mantém o SQLite aberto e o "prisma migrate" falha com
  # "database is locked". Para o processo antes de migrar; o PM2 o sobe de novo abaixo.
  if pm2 describe goals-api >/dev/null 2>&1; then
    info "Parando goals-api para aplicar as migrações…"
    pm2 stop goals-api >/dev/null
  fi
  for i in 1 2 3 4 5; do
    (cd server && npx --no-install prisma migrate deploy) && break
    [ "$i" -eq 5 ] && fail "Não foi possível aplicar as migrações (banco bloqueado?). Veja: fuser -v server/data/goals.db"
    warn "Banco ocupado — nova tentativa em 3s ($i/5)…"
    sleep 3
  done
fi
ok "Servidor pronto (Node $(node -v))"

info "Instalando dependências do frontend e gerando o build…"
[ -d client/node_modules ] && [ ! -x client/node_modules/.bin/vite ] && rm -rf client/node_modules
npm install --prefix client --no-audit --no-fund
npm run build --prefix client
ok "Frontend compilado (client/dist)"

# 3. Iniciar / recarregar no PM2 ---------------------------------------------
info "Iniciando $APPS no PM2…"
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save >/dev/null
ok "Lista de processos do PM2 salva (sobrevive a reinícios)"

# 4. Verificação ---------------------------------------------------------------
info "Verificando se o app responde…"
for i in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${API_PORT}/api/health" >/dev/null 2>&1 \
     && curl -fsS "http://127.0.0.1:${WEB_PORT}/" >/dev/null 2>&1; then
    echo
    ok "Goals App no ar: frontend http://127.0.0.1:${WEB_PORT}  ·  API http://127.0.0.1:${API_PORT}"
    echo "   Logs:      pm2 logs goals-api   |   pm2 logs goals-web"
    echo "   Status:    pm2 status"
    exit 0
  fi
  sleep 1
done
pm2 logs goals-api --lines 30 --nostream || true
pm2 logs goals-web --lines 30 --nostream || true
fail "O app não respondeu nas portas $API_PORT/$WEB_PORT. Veja os logs acima."
