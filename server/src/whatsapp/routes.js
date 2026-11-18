// Página "WhatsApp" (somente admin master): status, QR Code, teste de envio e logs.
import { Router } from 'express';
import { requireMaster } from '../auth/middleware.js';
import { parsePhone } from '../users/validation.js';
import {
  connectWhatsApp,
  getWhatsAppStatus,
  logoutWhatsApp,
  recentMessageLogs,
  sendMessage,
} from './whatsapp.js';

const TEXT_MAX = 1000;

async function statusPayload() {
  return { ...getWhatsAppStatus(), logs: await recentMessageLogs() };
}

export function whatsappRouter() {
  const router = Router();
  router.use(requireMaster);

  router.get('/', async (_req, res) => {
    res.json(await statusPayload());
  });

  router.post('/connect', async (_req, res) => {
    await connectWhatsApp();
    res.json(await statusPayload());
  });

  router.post('/logout', async (_req, res) => {
    await logoutWhatsApp();
    res.json(await statusPayload());
  });

  router.post('/test', async (req, res) => {
    const body = req.body ?? {};
    const errors = {};
    const phone = parsePhone(body.phone);
    if (phone.error) errors.phone = phone.error;
    else if (!phone.value) errors.phone = 'Informe o telefone';
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) errors.text = 'Escreva a mensagem';
    else if (text.length > TEXT_MAX) errors.text = `Máximo de ${TEXT_MAX} caracteres`;
    if (Object.keys(errors).length) {
      return res.status(400).json({ error: Object.values(errors)[0], fields: errors });
    }

    try {
      await sendMessage(phone.value, text);
    } catch (err) {
      return res.status(400).json({ error: `Falha no envio: ${err.message}` });
    }
    res.json(await statusPayload());
  });

  return router;
}
