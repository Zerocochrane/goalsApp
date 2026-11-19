// Limites por IP do cadastro e do envio de códigos pelo WhatsApp.
// Protegem o número do app contra bloqueio (Baileys) e contra uso para spam.
import { rateLimit } from 'express-rate-limit';

const common = { standardHeaders: 'draft-8', legacyHeaders: false };

/** Até 10 tentativas de cadastro por hora por IP. */
export const signupLimiter = rateLimit({
  ...common,
  windowMs: 60 * 60 * 1000,
  limit: 10,
  message: { error: 'Muitos cadastros a partir desta rede. Tente novamente mais tarde.' },
});

// Envio de código: 1 por minuto e 5 por hora por IP. Só contam os envios que deram
// certo (um formulário com erro não gasta o limite).
const codeMinuteLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  limit: 1,
  skipFailedRequests: true,
  message: { error: 'Aguarde um minuto para pedir outro código.' },
});
const codeHourLimiter = rateLimit({
  ...common,
  windowMs: 60 * 60 * 1000,
  limit: 5,
  skipFailedRequests: true,
  message: { error: 'Muitos códigos pedidos. Tente novamente em uma hora.' },
});
export const codeSendLimiters = [codeMinuteLimiter, codeHourLimiter];

/** Conferência do código: 30 por 10 minutos por IP (cada código já aceita só 5). */
export const codeCheckLimiter = rateLimit({
  ...common,
  windowMs: 10 * 60 * 1000,
  limit: 30,
  message: { error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
});
