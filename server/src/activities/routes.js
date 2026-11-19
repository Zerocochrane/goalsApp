// CRUD das atividades recorrentes do usuário logado.
//
// Dias passados nunca mudam: editar ou excluir uma atividade que já valeu em algum
// dia encerra a versão atual (active=false, endDate=véspera do corte) e, na edição,
// cria uma nova versão a partir do corte. Assim as ocorrências já geradas continuam
// ligadas à versão (nome/horário) que as gerou.
import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import { attachmentRoutes, attachmentSelect } from '../attachments/routes.js';
import { removeFiles } from '../attachments/storage.js';
import { addDays, formatTime, todayInSaoPaulo } from './recurrence.js';
import { completeActivity } from '../occurrences/complete.js';
import { dayCelebrationPending } from '../day/celebration.js';
import {
  parseActivityName,
  parseDescription,
  parseHour,
  parseMinute,
  parseStartDate,
  parseVideoUrl,
  parseWeekdays,
} from './validation.js';

const NOT_FOUND = 'Atividade não encontrada';

const activitySelect = {
  id: true,
  name: true,
  hour: true,
  minute: true,
  weekdays: true,
  startDate: true,
  endDate: true,
  description: true,
  videoUrl: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  attachment: { select: attachmentSelect },
};

// Campos que definem quando a atividade acontece: mudar algum deles gera uma nova versão.
// Descrição e vídeo podem mudar na própria versão (não alteram dias passados).
const SCHEDULE_FIELDS = ['name', 'hour', 'minute', 'weekdays', 'startDate'];

function toPublic(activity) {
  return {
    ...activity,
    attachment: activity.attachment ?? null,
    time: formatTime(activity.hour, activity.minute),
  };
}

export function parseId(raw) {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function validationError(res, errors) {
  return res.status(400).json({ error: Object.values(errors)[0], fields: errors });
}

/**
 * Lê e valida o corpo. Na edição (`current`), campos ausentes mantêm o valor atual.
 * Sem `startDate`, a criação começa hoje.
 */
function readActivityInput(body, { today, current }) {
  const data = {};
  const errors = {};
  const check = (field, parse) => {
    if (current && body[field] === undefined) {
      data[field] = current[field];
      return;
    }
    const result = parse(body[field]);
    if (result.error) errors[field] = result.error;
    else data[field] = result.value;
  };

  check('name', parseActivityName);
  check('hour', parseHour);
  check('minute', parseMinute);
  check('weekdays', parseWeekdays);
  if (!current && body.startDate === undefined) data.startDate = today;
  else check('startDate', (value) => parseStartDate(value, today));
  check('description', parseDescription);
  check('videoUrl', parseVideoUrl);

  return { data, errors };
}

/**
 * Primeiro dia que a edição/exclusão pode alterar: hoje, ou amanhã se a ocorrência
 * de hoje já foi enviada ou resolvida (ela fica como está).
 */
async function cutoverDate(tx, activityId, today) {
  const locked = await tx.taskOccurrence.count({
    where: {
      activityId,
      date: today,
      OR: [{ status: { not: 'pendente' } }, { notifiedAt: { not: null } }],
    },
  });
  return locked ? addDays(today, 1) : today;
}

/** Apaga ocorrências de hoje em diante que ainda não foram enviadas. */
function deleteUnsentOccurrences(tx, activityId, today) {
  return tx.taskOccurrence.deleteMany({
    where: { activityId, date: { gte: today }, status: 'pendente', notifiedAt: null },
  });
}

function findOwnActive(tx, id, userId) {
  return tx.activity.findFirst({ where: { id, userId, active: true } });
}

export function activitiesRouter() {
  const router = Router();

  router.get('/', async (req, res) => {
    const activities = await prisma.activity.findMany({
      where: { userId: req.user.id, active: true },
      select: activitySelect,
      orderBy: [{ hour: 'asc' }, { minute: 'asc' }, { name: 'asc' }],
    });
    res.json({ activities: activities.map(toPublic) });
  });

  router.get('/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const activity =
      id &&
      (await prisma.activity.findFirst({
        where: { id, userId: req.user.id, active: true },
        select: activitySelect,
      }));
    if (!activity) return res.status(404).json({ error: NOT_FOUND });
    res.json({ activity: toPublic(activity) });
  });

  router.post('/', async (req, res) => {
    const today = todayInSaoPaulo();
    const { data, errors } = readActivityInput(req.body ?? {}, { today });
    if (Object.keys(errors).length) return validationError(res, errors);

    const activity = await prisma.activity.create({
      data: { ...data, userId: req.user.id },
      select: activitySelect,
    });
    res.status(201).json({ activity: toPublic(activity) });
  });

  router.put('/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const current = id && (await findOwnActive(prisma, id, req.user.id));
    if (!current) return res.status(404).json({ error: NOT_FOUND });

    const today = todayInSaoPaulo();
    const { data, errors } = readActivityInput(req.body ?? {}, { today, current });
    if (Object.keys(errors).length) return validationError(res, errors);

    const activity = await prisma.$transaction(async (tx) => {
      // Relê dentro da transação: pode ter sido alterada/excluída nesse meio-tempo
      const fresh = await findOwnActive(tx, id, req.user.id);
      if (!fresh) return null;

      // Só descrição/vídeo mudaram: atualiza esta versão, sem mexer nas ocorrências
      const sameSchedule = SCHEDULE_FIELDS.every(
        (field) => JSON.stringify(data[field]) === JSON.stringify(fresh[field]),
      );
      if (sameSchedule) {
        return tx.activity.update({
          where: { id },
          data: { description: data.description, videoUrl: data.videoUrl },
          select: activitySelect,
        });
      }

      const cutover = await cutoverDate(tx, id, today);
      await deleteUnsentOccurrences(tx, id, today);
      const startDate = data.startDate > cutover ? data.startDate : cutover;

      if (fresh.startDate >= cutover) {
        // Ainda não valeu em nenhum dia: altera a própria atividade
        return tx.activity.update({
          where: { id },
          data: { ...data, startDate },
          select: activitySelect,
        });
      }

      // Já valeu em dias anteriores: encerra esta versão e cria a nova
      await tx.activity.update({
        where: { id },
        data: { active: false, endDate: addDays(cutover, -1) },
      });
      const created = await tx.activity.create({
        data: { ...data, startDate, userId: req.user.id },
        select: { id: true },
      });
      // O anexo acompanha a versão ativa
      await tx.attachment.updateMany({
        where: { activityId: id },
        data: { activityId: created.id },
      });
      return tx.activity.findUnique({ where: { id: created.id }, select: activitySelect });
    });

    if (!activity) return res.status(404).json({ error: NOT_FOUND });
    // `previousId` ajuda o cliente quando a edição gerou uma nova versão (novo id)
    res.json({ activity: toPublic(activity), previousId: id });
  });

  // Anexo (foto ou PDF): enviar, abrir e remover — só o dono
  router.use('/:id/attachment', attachmentRoutes());

  // Conclui a atividade de hoje pelo site (mesmas regras do link do WhatsApp).
  // Ao concluir, `diaConcluidoParaComemorar` diz se hoje acabou de ficar todo concluído.
  router.post('/:id/complete', async (req, res) => {
    const { code, httpStatus, message, occurrence } = await completeActivity({
      prisma,
      activityId: parseId(req.params.id) ?? 0,
      userId: req.user.id,
    });
    const body = { code, message, occurrence };
    if (code === 'concluida')
      body.diaConcluidoParaComemorar = await dayCelebrationPending(req.user.id);
    if (httpStatus >= 400) body.error = message;
    res.status(httpStatus).json(body);
  });

  router.delete('/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: NOT_FOUND });
    const today = todayInSaoPaulo();

    const deleted = await prisma.$transaction(async (tx) => {
      if (!(await findOwnActive(tx, id, req.user.id))) return false;
      // O anexo vai embora com a atividade (o arquivo é apagado depois da transação)
      const attachment = await tx.attachment.findUnique({
        where: { activityId: id },
        select: { storedName: true },
      });
      if (attachment) await tx.attachment.delete({ where: { activityId: id } });
      const cutover = await cutoverDate(tx, id, today);
      await deleteUnsentOccurrences(tx, id, today);
      // Exclusão lógica: os dias até a véspera do corte continuam mostrando a atividade
      await tx.activity.update({
        where: { id },
        data: { active: false, endDate: addDays(cutover, -1) },
      });
      return { storedName: attachment?.storedName };
    });

    if (!deleted) return res.status(404).json({ error: NOT_FOUND });
    if (deleted.storedName) await removeFiles([deleted.storedName]);
    res.status(204).end();
  });

  return router;
}
