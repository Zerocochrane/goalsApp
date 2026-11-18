import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  buildCalendar,
  dayStatus,
  daysBetween,
  eachDate,
  isValidDate,
  occurrenceDates,
  occursOn,
  todayInSaoPaulo,
  weekdayOf,
  zonedDateTime,
} from '../src/activities/recurrence.js';

const SUN = 0,
  MON = 1,
  TUE = 2,
  WED = 3,
  THU = 4,
  FRI = 5,
  SAT = 6;

function activity(overrides = {}) {
  return {
    id: 1,
    name: 'Academia',
    hour: 7,
    minute: 30,
    weekdays: [MON, WED, FRI],
    startDate: '2026-11-18', // quarta-feira
    endDate: null,
    active: true,
    ...overrides,
  };
}

describe('datas', () => {
  test('isValidDate aceita só datas reais AAAA-MM-DD', () => {
    assert.ok(isValidDate('2026-11-18'));
    assert.ok(isValidDate('2028-02-29')); // bissexto
    assert.ok(!isValidDate('2026-02-29'));
    assert.ok(!isValidDate('2026-02-30'));
    assert.ok(!isValidDate('2026-13-01'));
    assert.ok(!isValidDate('2026-1-01'));
    assert.ok(!isValidDate('18/11/2026'));
    assert.ok(!isValidDate(null));
  });

  test('addDays atravessa mês e ano', () => {
    assert.equal(addDays('2026-11-30', 1), '2026-12-01');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2027-01-01', -1), '2026-12-31');
    assert.equal(addDays('2028-02-28', 1), '2028-02-29');
    assert.equal(addDays('2027-02-28', 1), '2027-03-01');
  });

  test('weekdayOf usa 0 = domingo', () => {
    assert.equal(weekdayOf('2026-11-18'), WED);
    assert.equal(weekdayOf('2026-11-22'), SUN);
    assert.equal(weekdayOf('2026-11-23'), MON);
    assert.equal(weekdayOf('2027-01-01'), FRI);
  });

  test('eachDate e daysBetween', () => {
    assert.deepEqual(eachDate('2026-11-29', '2026-12-02'), [
      '2026-11-29',
      '2026-11-30',
      '2026-12-01',
      '2026-12-02',
    ]);
    assert.deepEqual(eachDate('2026-11-18', '2026-11-17'), []);
    assert.equal(daysBetween('2026-11-01', '2026-12-01'), 30);
  });

  test('todayInSaoPaulo usa o fuso de São Paulo (UTC-3)', () => {
    // 02:59 UTC do dia 19 ainda é 23:59 do dia 18 em São Paulo
    assert.equal(todayInSaoPaulo(new Date('2026-11-19T02:59:00Z')), '2026-11-18');
    assert.equal(todayInSaoPaulo(new Date('2026-11-19T03:00:00Z')), '2026-11-19');
    // Virada do ano
    assert.equal(todayInSaoPaulo(new Date('2027-01-01T02:00:00Z')), '2026-12-31');
  });

  test('zonedDateTime converte horário de São Paulo para UTC', () => {
    assert.equal(zonedDateTime('2026-11-18', 7, 30).toISOString(), '2026-11-18T10:30:00.000Z');
    assert.equal(zonedDateTime('2026-12-31', 23, 0).toISOString(), '2027-01-01T02:00:00.000Z');
  });
});

describe('recorrência', () => {
  test('não acontece antes da data de início (dia clicado)', () => {
    const a = activity({ startDate: '2026-11-18' });
    assert.ok(!occursOn(a, '2026-11-16')); // segunda anterior
    assert.ok(occursOn(a, '2026-11-18')); // o próprio dia clicado (quarta)
  });

  test('só nos dias da semana escolhidos', () => {
    const a = activity();
    assert.deepEqual(occurrenceDates(a, '2026-11-18', '2026-11-24'), [
      '2026-11-18', // qua
      '2026-11-20', // sex
      '2026-11-23', // seg
    ]);
  });

  test('dia clicado fora dos dias escolhidos: começa no próximo dia válido', () => {
    const a = activity({ startDate: '2026-11-17', weekdays: [THU] }); // terça
    assert.deepEqual(occurrenceDates(a, '2026-11-16', '2026-11-22'), ['2026-11-19']);
  });

  test('virada de semana (sábado → domingo → segunda)', () => {
    const a = activity({ startDate: '2026-11-21', weekdays: [SAT, SUN, MON] });
    assert.deepEqual(occurrenceDates(a, '2026-11-20', '2026-11-24'), [
      '2026-11-21',
      '2026-11-22',
      '2026-11-23',
    ]);
  });

  test('virada de mês', () => {
    const a = activity({ startDate: '2026-11-27', weekdays: [MON, TUE] });
    assert.deepEqual(occurrenceDates(a, '2026-11-27', '2026-12-08'), [
      '2026-11-30',
      '2026-12-01',
      '2026-12-07',
      '2026-12-08',
    ]);
  });

  test('virada de ano', () => {
    const a = activity({ startDate: '2026-12-30', weekdays: [THU, FRI] });
    assert.deepEqual(occurrenceDates(a, '2026-12-28', '2027-01-03'), ['2026-12-31', '2027-01-01']);
  });

  test('fevereiro de ano bissexto', () => {
    const a = activity({ startDate: '2028-02-28', weekdays: [TUE] }); // 29/02/2028 é terça
    assert.deepEqual(occurrenceDates(a, '2028-02-28', '2028-03-07'), ['2028-02-29', '2028-03-07']);
  });

  test('todos os dias da semana', () => {
    const a = activity({ weekdays: [0, 1, 2, 3, 4, 5, 6] });
    assert.equal(occurrenceDates(a, '2026-11-18', '2026-12-17').length, 30);
  });

  test('para depois de endDate (edição/exclusão)', () => {
    const a = activity({ weekdays: [0, 1, 2, 3, 4, 5, 6], endDate: '2026-11-20' });
    assert.deepEqual(occurrenceDates(a, '2026-11-17', '2026-11-23'), [
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
    ]);
  });

  test('endDate antes do início: nunca acontece', () => {
    const a = activity({ startDate: '2026-11-20', endDate: '2026-11-19' });
    assert.deepEqual(occurrenceDates(a, '2026-11-16', '2026-11-30'), []);
  });
});

describe('status do dia', () => {
  test('regras', () => {
    assert.equal(dayStatus([]), 'vazio');
    assert.equal(dayStatus(['concluida', 'concluida']), 'concluido');
    assert.equal(dayStatus(['concluida', 'pendente']), 'pendente');
    assert.equal(dayStatus(['concluida', 'falhou', 'pendente']), 'falhou');
  });
});

describe('buildCalendar', () => {
  const base = { start: '2026-11-16', end: '2026-11-22', today: '2026-11-18' };

  test('junta previsões e ocorrências reais, ordenadas por horário', () => {
    const academia = activity({ id: 1, weekdays: [WED], startDate: '2026-11-16' });
    const leitura = activity({
      id: 2,
      name: 'Leitura',
      hour: 6,
      minute: 0,
      weekdays: [WED],
      startDate: '2026-11-16',
    });
    const occurrences = [
      {
        id: 10,
        activityId: 2,
        date: '2026-11-18',
        status: 'concluida',
        activity: { name: 'Leitura', hour: 6, minute: 0 },
      },
    ];
    const days = buildCalendar({ ...base, activities: [academia, leitura], occurrences });

    assert.equal(days.length, 7);
    const wed = days.find((d) => d.date === '2026-11-18');
    assert.equal(wed.isToday, true);
    assert.equal(wed.weekday, WED);
    assert.deepEqual(
      wed.activities.map((a) => [a.time, a.name, a.status, a.occurrence?.id ?? null]),
      [
        ['06:00', 'Leitura', 'concluida', 10],
        ['07:30', 'Academia', 'pendente', null],
      ],
    );
    assert.equal(wed.status, 'pendente');
    assert.ok(wed.activities.every((a) => a.editable));

    const mon = days[0];
    assert.equal(mon.isPast, true);
    assert.equal(mon.status, 'vazio');
    assert.deepEqual(mon.activities, []);
  });

  test('ocorrência real sem previsão (versão antiga) continua aparecendo', () => {
    const occurrences = [
      {
        id: 5,
        activityId: 99,
        date: '2026-11-17',
        status: 'falhou',
        activity: { name: 'Corrida', hour: 5, minute: 45 },
      },
    ];
    const days = buildCalendar({ ...base, activities: [], occurrences });
    const tue = days.find((d) => d.date === '2026-11-17');
    assert.equal(tue.status, 'falhou');
    assert.equal(tue.activities[0].name, 'Corrida');
    assert.equal(tue.activities[0].activityId, 99);
    assert.equal(tue.activities[0].editable, false);
  });
});
