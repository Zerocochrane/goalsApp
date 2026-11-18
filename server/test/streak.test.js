import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { buildCalendar } from '../src/activities/recurrence.js';
import { computeStreak, milestoneFor, pendingMilestone } from '../src/streak/streak.js';

const TODAY = '2026-11-18'; // quarta-feira
const NOW = new Date('2026-11-18T12:00:00-03:00');

/** Dia simplificado: status + atividades (para os casos de "em andamento"). */
function day(date, status, activities = []) {
  return { date, status, activities };
}

const streak = (days, opts = {}) => computeStreak(days, { today: TODAY, now: NOW, ...opts });

describe('computeStreak', () => {
  test('sem dias → 0', () => {
    assert.equal(streak([]), 0);
  });

  test('conta dias concluídos consecutivos até hoje', () => {
    assert.equal(
      streak([
        day('2026-11-15', 'concluido'),
        day('2026-11-16', 'concluido'),
        day('2026-11-17', 'concluido'),
        day('2026-11-18', 'concluido'),
      ]),
      4,
    );
  });

  test('a ordem dos dias na entrada não importa', () => {
    assert.equal(
      streak([
        day('2026-11-17', 'concluido'),
        day('2026-11-15', 'falhou'),
        day('2026-11-16', 'concluido'),
      ]),
      2,
    );
  });

  test('dias vazios são ignorados: não contam e não quebram', () => {
    assert.equal(
      streak([
        day('2026-11-12', 'concluido'),
        day('2026-11-13', 'vazio'),
        day('2026-11-14', 'vazio'),
        day('2026-11-15', 'concluido'),
        day('2026-11-16', 'vazio'),
        day('2026-11-17', 'concluido'),
        day('2026-11-18', 'vazio'),
      ]),
      3,
    );
  });

  test('falha quebra a sequência', () => {
    assert.equal(
      streak([
        day('2026-11-14', 'concluido'),
        day('2026-11-15', 'falhou'),
        day('2026-11-16', 'concluido'),
        day('2026-11-17', 'concluido'),
      ]),
      2,
    );
  });

  test('falha ontem zera a sequência', () => {
    assert.equal(streak([day('2026-11-16', 'concluido'), day('2026-11-17', 'falhou')]), 0);
  });

  test('hoje pendente não quebra (nem conta)', () => {
    assert.equal(
      streak([
        day('2026-11-16', 'concluido'),
        day('2026-11-17', 'concluido'),
        day('2026-11-18', 'pendente'),
      ]),
      2,
    );
  });

  test('hoje com falha quebra', () => {
    assert.equal(streak([day('2026-11-17', 'concluido'), day('2026-11-18', 'falhou')]), 0);
  });

  test('dia passado pendente sem como concluir quebra', () => {
    assert.equal(
      streak([
        day('2026-11-16', 'concluido'),
        day('2026-11-17', 'pendente', [{ status: 'pendente', occurrence: null }]),
      ]),
      0,
    );
  });

  test('dia anterior com atividade ainda na janela de validação não quebra', () => {
    const now = new Date('2026-11-18T00:10:00-03:00');
    const lateItem = {
      status: 'pendente',
      occurrence: { expiresAt: new Date('2026-11-18T00:30:00-03:00').toISOString() },
    };
    assert.equal(
      streak(
        [
          day('2026-11-16', 'concluido'),
          day('2026-11-17', 'pendente', [{ status: 'concluida' }, lateItem]),
          day('2026-11-18', 'pendente'),
        ],
        { now },
      ),
      1,
    );
    // Depois que a janela expirou, o dia (ainda pendente) quebra
    assert.equal(
      streak([day('2026-11-16', 'concluido'), day('2026-11-17', 'pendente', [lateItem])], {
        now: new Date('2026-11-18T01:00:00-03:00'),
      }),
      0,
    );
  });

  test('dias futuros são desconsiderados', () => {
    assert.equal(streak([day('2026-11-17', 'concluido'), day('2026-11-19', 'falhou')]), 1);
  });

  test('integra com buildCalendar (atividade seg/qua/sex)', () => {
    // seg 09, qua 11, sex 13 falhou; seg 16 ok; qua 18 (hoje) pendente
    const activity = {
      id: 1,
      name: 'Academia',
      hour: 7,
      minute: 0,
      weekdays: [1, 3, 5],
      startDate: '2026-11-09',
      endDate: null,
      active: true,
    };
    const occ = (id, date, status) => ({
      id,
      activityId: 1,
      date,
      status,
      scheduledAt: null,
      expiresAt: null,
      notifiedAt: null,
      completedAt: null,
      activity: { name: 'Academia', hour: 7, minute: 0 },
    });
    const occurrences = [
      occ(1, '2026-11-09', 'concluida'),
      occ(2, '2026-11-11', 'concluida'),
      occ(3, '2026-11-13', 'falhou'),
      occ(4, '2026-11-16', 'concluida'),
    ];
    const days = buildCalendar({
      activities: [activity],
      occurrences,
      start: '2026-11-09',
      end: TODAY,
      today: TODAY,
    });
    assert.equal(streak(days), 1);
  });
});

describe('marcos', () => {
  test('milestoneFor arredonda para baixo em múltiplos de 10', () => {
    assert.equal(milestoneFor(0), 0);
    assert.equal(milestoneFor(9), 0);
    assert.equal(milestoneFor(10), 10);
    assert.equal(milestoneFor(19), 10);
    assert.equal(milestoneFor(30), 30);
  });

  test('pendingMilestone só retorna marco ainda não comemorado', () => {
    assert.equal(pendingMilestone(9, 0), null);
    assert.equal(pendingMilestone(10, 0), 10);
    assert.equal(pendingMilestone(15, 10), null);
    assert.equal(pendingMilestone(20, 10), 20);
    assert.equal(pendingMilestone(10, 30), null);
  });
});
