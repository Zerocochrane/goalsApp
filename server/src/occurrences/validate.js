// Validação de uma ocorrência pelo link enviado no WhatsApp (/validar/:token).
//
// Regras:
//  - só o dono da ocorrência pode validá-la;
//  - vale apenas enquanto `expiresAt` não passou (1 hora após o horário) e uma única vez;
//  - link vencido nunca conclui, mesmo que o agendador ainda não tenha marcado `falhou`:
//    a conclusão é um UPDATE condicional (status pendente E expiresAt > agora), então
//    nem uma corrida com o agendador ou com um segundo clique conclui duas vezes.

export const VALIDATION_MESSAGES = {
  concluida: 'Atividade concluída! 🎉',
  expirado: 'Este link expirou. A atividade foi marcada como não realizada.',
  ja_validado: 'Esta atividade já foi validada.',
  outro_usuario: 'Este link não pertence à sua conta.',
  invalido: 'Link de validação inválido.',
};

const HTTP_STATUS = {
  concluida: 200,
  expirado: 410,
  ja_validado: 409,
  outro_usuario: 403,
  invalido: 404,
};

function result(code, occurrence) {
  return {
    code,
    httpStatus: HTTP_STATUS[code],
    message: VALIDATION_MESSAGES[code],
    occurrence: occurrence
      ? {
          id: occurrence.id,
          activityName: occurrence.activity?.name ?? null,
          date: occurrence.date,
          scheduledAt: occurrence.scheduledAt,
          completedAt: occurrence.completedAt,
        }
      : null,
  };
}

const include = { activity: { select: { name: true } } };

/** Classifica uma ocorrência que não está (ou deixou de estar) validável. */
async function settle(prisma, occurrence, at) {
  if (occurrence.status === 'concluida') return result('ja_validado', occurrence);
  if (occurrence.status === 'pendente' && occurrence.expiresAt <= at) {
    // O agendador ainda não rodou: já registra como não realizada
    await prisma.taskOccurrence.updateMany({
      where: { id: occurrence.id, status: 'pendente' },
      data: { status: 'falhou' },
    });
  }
  return result('expirado', occurrence);
}

/**
 * Valida a ocorrência do `token` para o usuário `userId` no instante `now`.
 * Retorna `{ code, httpStatus, message, occurrence }`.
 */
export async function validateOccurrence({ prisma, token, userId, now = new Date() }) {
  if (typeof token !== 'string' || !token || token.length > 128) return result('invalido');

  const occurrence = await prisma.taskOccurrence.findUnique({ where: { token }, include });
  if (!occurrence) return result('invalido');
  // Antes de olhar o status: não revela nada da atividade de outra pessoa
  if (occurrence.userId !== userId) return result('outro_usuario');

  const { count } = await prisma.taskOccurrence.updateMany({
    where: { id: occurrence.id, status: 'pendente', expiresAt: { gt: now } },
    data: { status: 'concluida', completedAt: now },
  });
  if (count === 1) {
    return result('concluida', { ...occurrence, status: 'concluida', completedAt: now });
  }

  // Não concluiu: relê para responder com o estado atual (pode ter mudado em paralelo)
  const current = await prisma.taskOccurrence.findUnique({
    where: { id: occurrence.id },
    include,
  });
  if (!current) return result('invalido');
  return settle(prisma, current, now);
}
