// Conexão com o WhatsApp via Baileys (biblioteca NÃO oficial — use um número dedicado).
//
// - A sessão fica em disco (server/data/wa-session, fora do git): depois de parear,
//   reinícios do PM2 reconectam sozinhos, sem novo QR Code.
// - Se a conexão cair, reconecta automaticamente com espera crescente (até 1 min).
// - sendMessage() coloca a mensagem numa fila e envia uma por vez, com intervalo
//   entre os envios para não parecer spam. Cada envio/falha vai para MessageLog.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { prisma } from '../db/prisma.js';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SESSION_DIR = path.resolve(SERVER_DIR, process.env.WA_SESSION_DIR || 'data/wa-session');
const SEND_INTERVAL_MS = Number(process.env.WA_SEND_INTERVAL_MS) || 3000;
const SEND_TIMEOUT_MS = 30_000;
const MAX_RECONNECT_DELAY_MS = 60_000;

const logger = pino({ level: process.env.WA_LOG_LEVEL || 'warn' }).child({ module: 'whatsapp' });

/**
 * status:
 *  - disconnected: sem sessão (precisa parear) ou parado
 *  - connecting:   abrindo conexão
 *  - qr:           aguardando leitura do QR Code
 *  - open:         conectado e pronto para enviar
 *  - reconnecting: a conexão caiu, nova tentativa agendada
 */
const state = {
  status: 'disconnected',
  qr: null, // data URL (PNG) do QR Code atual
  me: null, // número conectado (E.164)
  lastError: null,
  connectedAt: null,
};

let sock = null;
let generation = 0; // ignora eventos de sockets antigos
let reconnectTimer = null;
let reconnectAttempts = 0;
let stopping = false;

const queue = [];
let processing = false;
let lastSendAt = 0;

function log(message, extra) {
  console.log(`[whatsapp] ${message}`, extra ?? '');
}

function setState(patch) {
  Object.assign(state, patch);
}

/** Estado atual (para a página do master). */
export function getWhatsAppStatus() {
  return { ...state, queueLength: queue.length };
}

async function hasSavedSession() {
  try {
    const creds = JSON.parse(await fs.readFile(path.join(SESSION_DIR, 'creds.json'), 'utf8'));
    return Boolean(creds?.registered || creds?.me?.id);
  } catch {
    return false;
  }
}

async function clearSession() {
  await fs.rm(SESSION_DIR, { recursive: true, force: true });
}

function jidToPhone(jid) {
  const digits = String(jid || '').split(/[:@]/)[0];
  return digits ? `+${digits}` : null;
}

function closeSocket() {
  if (!sock) return;
  const old = sock;
  sock = null;
  generation++;
  try {
    old.ev.removeAllListeners();
    old.end(undefined);
  } catch {
    // já fechado
  }
}

function scheduleReconnect(reason) {
  if (stopping || reconnectTimer) return;
  reconnectAttempts++;
  const delay = Math.min(2000 * 2 ** (reconnectAttempts - 1), MAX_RECONNECT_DELAY_MS);
  setState({ status: 'reconnecting', qr: null, lastError: reason });
  log(`conexão caiu (${reason}); nova tentativa em ${Math.round(delay / 1000)}s`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect().catch((err) => scheduleReconnect(err.message));
  }, delay);
}

async function connect() {
  closeSocket();
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  stopping = false;

  await fs.mkdir(SESSION_DIR, { recursive: true });
  const { state: authState, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const myGeneration = ++generation;
  setState({ status: 'connecting', qr: null });

  sock = makeWASocket({
    auth: authState,
    logger,
    browser: Browsers.ubuntu('Goals App'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    if (myGeneration !== generation) return;
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        setState({ status: 'qr', qr: await QRCode.toDataURL(qr, { margin: 1, width: 280 }) });
      } catch (err) {
        logger.error({ err }, 'falha ao gerar QR Code');
      }
    }

    if (connection === 'open') {
      reconnectAttempts = 0;
      setState({
        status: 'open',
        qr: null,
        me: jidToPhone(sock?.user?.id),
        lastError: null,
        connectedAt: new Date().toISOString(),
      });
      log(`conectado como ${state.me}`);
      processQueue();
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const reason = lastDisconnect?.error?.message || `código ${code ?? '?'}`;
      closeSocket();
      if (stopping) return;

      if (code === DisconnectReason.loggedOut) {
        // Desconectado pelo celular: a sessão não vale mais, precisa parear de novo.
        await clearSession();
        reconnectAttempts = 0;
        setState({
          status: 'disconnected',
          qr: null,
          me: null,
          lastError: 'Sessão encerrada no celular. Pareie novamente.',
        });
        log('sessão encerrada (logout); é preciso parear de novo');
        return;
      }

      if (code === DisconnectReason.restartRequired) {
        // Normal logo após ler o QR Code: reabre com as credenciais novas.
        connect().catch((err) => scheduleReconnect(err.message));
        return;
      }

      if (!(await hasSavedSession())) {
        // Ainda não pareado (ex.: QR Code expirou sem leitura): espera o master clicar
        // em "Conectar" de novo, em vez de gerar QR Codes para sempre.
        setState({
          status: 'disconnected',
          qr: null,
          lastError: 'QR Code expirou. Clique em "Conectar" para gerar outro.',
        });
        return;
      }

      scheduleReconnect(reason);
    }
  });
}

/** Chamado no start do servidor: reconecta se já existe sessão pareada. */
export async function startWhatsApp() {
  if (process.env.WA_DISABLED === 'true') {
    log('desativado (WA_DISABLED=true)');
    return;
  }
  if (await hasSavedSession()) {
    log('sessão encontrada; conectando…');
    await connect().catch((err) => scheduleReconnect(err.message));
  } else {
    log('nenhuma sessão salva; pareie pela página WhatsApp');
  }
}

/** Inicia a conexão (gera QR Code se ainda não pareado). */
export async function connectWhatsApp() {
  if (['open', 'connecting', 'qr'].includes(state.status) && sock) return;
  reconnectAttempts = 0;
  setState({ lastError: null });
  await connect();
}

/** Desconecta e apaga a sessão (o próximo "Conectar" pede QR Code). */
export async function logoutWhatsApp() {
  stopping = true;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  const current = sock;
  if (current) {
    try {
      await current.logout();
    } catch {
      // sem conexão: só apaga a sessão local
    }
  }
  closeSocket();
  await clearSession();
  setState({ status: 'disconnected', qr: null, me: null, lastError: null, connectedAt: null });
  log('desconectado e sessão apagada');
}

/** Fecha o socket sem apagar a sessão (encerramento do processo). */
export function stopWhatsApp() {
  stopping = true;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  closeSocket();
}

/** Descobre o JID real do número (resolve o caso do nono dígito). */
async function resolveJid(phone) {
  const digits = phone.replace(/\D/g, '');
  const [result] = (await sock.onWhatsApp(`${digits}@s.whatsapp.net`)) ?? [];
  if (result?.exists) return result.jid;
  throw new Error('Este número não tem WhatsApp');
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function deliver({ phone, text }) {
  if (state.status !== 'open' || !sock) throw new Error('WhatsApp não está conectado');
  const jid = await withTimeout(
    resolveJid(phone),
    SEND_TIMEOUT_MS,
    'Tempo esgotado ao verificar o número',
  );
  await withTimeout(sock.sendMessage(jid, { text }), SEND_TIMEOUT_MS, 'Tempo esgotado no envio');
}

async function writeLog(phone, text, status, error) {
  try {
    await prisma.messageLog.create({ data: { phone, text, status, error } });
  } catch (err) {
    console.error('[whatsapp] falha ao gravar log de envio', err);
  }
}

async function processQueue() {
  if (processing) return;
  processing = true;
  try {
    while (queue.length) {
      // Intervalo mínimo entre envios, mesmo se a mensagem chegou com a fila vazia
      const wait = lastSendAt + SEND_INTERVAL_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const job = queue.shift();
      lastSendAt = Date.now();
      try {
        await deliver(job);
        log(`mensagem enviada para ${job.phone}`);
        await writeLog(job.phone, job.text, 'enviada', null);
        job.resolve();
      } catch (err) {
        log(`falha ao enviar para ${job.phone}: ${err.message}`);
        await writeLog(job.phone, job.text, 'falhou', err.message);
        job.reject(err);
      }
    }
  } finally {
    processing = false;
  }
}

/**
 * Envia uma mensagem de texto. `phone` em E.164 (+5532999999999).
 * Entra na fila (um envio por vez, com intervalo); resolve quando enviada
 * e rejeita com o motivo em caso de falha. Todo resultado é gravado em MessageLog.
 */
export function sendMessage(phone, text) {
  return new Promise((resolve, reject) => {
    queue.push({ phone, text, resolve, reject });
    processQueue();
  });
}

/** Últimos envios (para a página do master). */
export function recentMessageLogs(limit = 20) {
  return prisma.messageLog.findMany({ orderBy: { id: 'desc' }, take: limit });
}
