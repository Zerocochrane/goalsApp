// POST /api/occurrences/validate/:token — conclui a ocorrência pelo link do WhatsApp.
import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import { validateOccurrence } from './validate.js';

export function occurrencesRouter() {
  const router = Router();

  router.post('/validate/:token', async (req, res) => {
    const { code, httpStatus, message, occurrence } = await validateOccurrence({
      prisma,
      token: req.params.token,
      userId: req.user.id,
    });
    const body = { code, message, occurrence };
    if (httpStatus >= 400) body.error = message;
    res.status(httpStatus).json(body);
  });

  return router;
}
