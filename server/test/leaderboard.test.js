// Ranking entre amigos (issue #29): cálculo puro — percentual, desempates, empates,
// sem atividades, pendentes de hoje e virada de semana/mês no fuso de São Paulo.
import { test, describe, expect } from 'vitest';
import { todayInSaoPaulo } from '../src/activities/recurrence.js';
import {
  percentOf,
  periodMetrics,
  periodRange,
  rankEntries,
  streaks,
  summarizeDays,
} from '../src/leaderboard/leaderboard.js';

const TODAY = '2026-11-19'; // quinta-feira
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

function activity(id, overrides = {}) {
  return { id, weekdays: EVERY_DAY, startDate: '2026-11-16', endDate: null, ...overrides };
}

/** Dia com ocorrências: `done`/`failed` são listas de ids de atividade; `pending` também. */
function occ(date, { done = [], failed = [], pending = [] } = {}) {
  return {
    date,
    concluidas: done.length,
    falhas: failed.length,
    activityIds: [...done, ...failed, ...pending],
  };
}

function summarize({
  activities = [],
  occurrenceDays = [],
  open = [],
  start = '2026-11-16',
  today = TODAY,
}) {
  return summarizeDays({
    activities,
    occurrenceDays,
    openPending: new Set(open),
    start,
    today,
  });
}

function entry(nome, values, voce = false) {
  return {
    usuario: { id: nome.length, nome, username: nome.toLowerCase() },
    concluidas: 0,
    total: 0,
    diasConcluidos: 0,
    sequencia: 0,
    melhorSequencia: 0,
    temHistorico: true,
    voce,
    ...values,
  };
}

describe('periodRange (fuso de São Paulo)', () => {
  test('semana vai de segunda a domingo', () => {
    expect(periodRange('semana', '2026-11-19')).toEqual({
      inicio: '2026-11-16',
      fim: '2026-11-22',
    });
    // Domingo ainda é da semana que começou na segunda anterior
    expect(periodRange('semana', '2026-11-22')).toEqual({
      inicio: '2026-11-16',
      fim: '2026-11-22',
    });
    // Segunda abre uma semana nova
    expect(periodRange('semana', '2026-11-23').inicio).toBe('2026-11-23');
    // Semana que atravessa o mês/ano
    expect(periodRange('semana', '2027-01-01')).toEqual({
      inicio: '2026-12-28',
      fim: '2027-01-03',
    });
  });

  test('mês vai do dia 1 ao último dia (inclusive fevereiro bissexto)', () => {
    expect(periodRange('mes', '2026-11-19')).toEqual({ inicio: '2026-11-01', fim: '2026-11-30' });
    expect(periodRange('mes', '2028-02-10')).toEqual({ inicio: '2028-02-01', fim: '2028-02-29' });
    expect(periodRange('mes', '2026-12-31')).toEqual({ inicio: '2026-12-01', fim: '2026-12-31' });
  });

  test('a virada usa a meia-noite de São Paulo, não a de UTC', () => {
    // 01:30 UTC de segunda = 22:30 de domingo em São Paulo: ainda é a semana anterior
    const sundayNight = new Date('2026-11-23T01:30:00Z');
    expect(todayInSaoPaulo(sundayNight)).toBe('2026-11-22');
    expect(periodRange('semana', todayInSaoPaulo(sundayNight)).inicio).toBe('2026-11-16');
    // 03:00 UTC = 00:00 de segunda em São Paulo: semana nova
    const mondayMidnight = new Date('2026-11-23T03:00:00Z');
    expect(periodRange('semana', todayInSaoPaulo(mondayMidnight)).inicio).toBe('2026-11-23');
    // Mesmo para o mês: 02:59 UTC do dia 1º ainda é o último dia do mês anterior
    expect(periodRange('mes', todayInSaoPaulo(new Date('2026-12-01T02:59:00Z'))).inicio).toBe(
      '2026-11-01',
    );
    expect(periodRange('mes', todayInSaoPaulo(new Date('2026-12-01T03:00:00Z'))).inicio).toBe(
      '2026-12-01',
    );
  });
});

describe('percentual e métricas do período', () => {
  test('concluídas ÷ total vencido, arredondado para baixo', () => {
    expect(percentOf(2, 3)).toBe(66);
    expect(percentOf(199, 200)).toBe(99); // nunca mostra 100% sem estar tudo feito
    expect(percentOf(3, 3)).toBe(100);
    expect(percentOf(0, 4)).toBe(0);
    expect(percentOf(0, 0)).toBeNull();
  });

  test('conta concluídas, falhas e previstas que ficaram sem ocorrência', () => {
    const days = summarize({
      activities: [activity(1), activity(2)],
      occurrenceDays: [
        occ('2026-11-16', { done: [1, 2] }),
        occ('2026-11-17', { done: [1], failed: [2] }),
        occ('2026-11-18', { done: [1] }), // atividade 2 não gerou ocorrência: venceu
        occ('2026-11-19', { done: [1, 2] }),
      ],
    });
    expect(periodMetrics(days, periodRange('semana', TODAY))).toEqual({
      concluidas: 6,
      total: 8,
      diasConcluidos: 2,
    });
  });

  test('pendentes de hoje dentro do prazo não contam como falha', () => {
    const days = summarize({
      activities: [activity(1), activity(2), activity(3)],
      occurrenceDays: [occ(TODAY, { done: [1], pending: [2] })], // 3 ainda nem foi gerada
      open: [`2|${TODAY}`],
      start: TODAY,
    });
    expect(periodMetrics(days, periodRange('semana', TODAY))).toEqual({
      concluidas: 1,
      total: 1,
      diasConcluidos: 0,
    });
  });

  test('pendente vencida (o agendador ainda não marcou falha) conta como falha', () => {
    const days = summarize({
      activities: [activity(1)],
      occurrenceDays: [occ(TODAY, { pending: [1] })],
      start: TODAY,
    });
    expect(periodMetrics(days, periodRange('semana', TODAY))).toMatchObject({ total: 1 });
    // …mas o dia de hoje continua em andamento para a sequência
    expect(days[0].inProgress).toBe(true);
  });

  test('atividade das 23:30 de ontem ainda no prazo não conta como falha', () => {
    const days = summarize({
      activities: [activity(1, { startDate: '2026-11-18', weekdays: [3] })],
      occurrenceDays: [occ('2026-11-18', { pending: [1] })],
      open: ['1|2026-11-18'],
      start: '2026-11-18',
    });
    expect(periodMetrics(days, periodRange('semana', TODAY))).toMatchObject({ total: 0 });
  });

  test('só conta o período: semana passada e mês passado ficam de fora', () => {
    const days = summarize({
      activities: [activity(1, { startDate: '2026-10-30' })],
      occurrenceDays: [
        occ('2026-10-30', { failed: [1] }),
        occ('2026-10-31', { failed: [1] }),
        occ('2026-11-15', { failed: [1] }), // domingo da semana passada
        occ('2026-11-16', { done: [1] }),
        occ('2026-11-17', { done: [1] }),
        occ('2026-11-18', { done: [1] }),
        occ('2026-11-19', { done: [1] }),
      ],
      start: '2026-10-30',
    });
    expect(periodMetrics(days, periodRange('semana', TODAY))).toEqual({
      concluidas: 4,
      total: 4,
      diasConcluidos: 4,
    });
    const month = periodMetrics(days, periodRange('mes', TODAY));
    expect(month.concluidas).toBe(4);
    expect(month.total).toBe(19); // 1º a 19 de nov. (dias sem ocorrência venceram); outubro fora
  });

  test('atividade encerrada (endDate) deixa de contar depois do fim', () => {
    const days = summarize({
      activities: [activity(1, { endDate: '2026-11-17' })],
      occurrenceDays: [occ('2026-11-16', { done: [1] }), occ('2026-11-17', { done: [1] })],
    });
    expect(periodMetrics(days, periodRange('semana', TODAY))).toEqual({
      concluidas: 2,
      total: 2,
      diasConcluidos: 2,
    });
  });
});

describe('sequência', () => {
  test('dias vazios são ignorados; falha quebra; hoje em andamento não quebra', () => {
    const days = summarize({
      activities: [activity(1, { startDate: '2026-11-10', weekdays: [1, 2, 3, 4, 5] })],
      occurrenceDays: [
        occ('2026-11-10', { done: [1] }),
        occ('2026-11-11', { done: [1] }),
        occ('2026-11-12', { done: [1] }),
        occ('2026-11-13', { failed: [1] }),
        // 14 e 15: fim de semana, sem atividade
        occ('2026-11-16', { done: [1] }),
        occ('2026-11-17', { done: [1] }),
        occ('2026-11-18', { done: [1] }),
        occ(TODAY, { pending: [1] }),
      ],
      open: [`1|${TODAY}`],
      start: '2026-11-10',
    });
    expect(streaks(days)).toEqual({ atual: 3, melhor: 3 });
  });

  test('maior sequência guarda o recorde mesmo depois de uma falha', () => {
    const days = summarize({
      activities: [activity(1, { startDate: '2026-11-10' })],
      occurrenceDays: [
        ...['10', '11', '12', '13', '14'].map((d) => occ(`2026-11-${d}`, { done: [1] })),
        occ('2026-11-15', { failed: [1] }),
        occ('2026-11-16', { done: [1] }),
        occ('2026-11-17', { done: [1] }),
        occ('2026-11-18', { done: [1] }),
        occ(TODAY, { done: [1] }),
      ],
      start: '2026-11-10',
    });
    expect(streaks(days)).toEqual({ atual: 4, melhor: 5 });
  });

  test('sem nenhum dia → 0', () => {
    expect(streaks([])).toEqual({ atual: 0, melhor: 0 });
  });
});

describe('rankEntries', () => {
  test('ordena pelo percentual (fração exata, não arredondada)', () => {
    const result = rankEntries('semana', [
      entry('Ana', { concluidas: 2, total: 3 }), // 66,67%
      entry('Bia', { concluidas: 3, total: 3 }),
      entry('Caio', { concluidas: 199, total: 300 }), // 66,33% (também "66%")
    ]);
    expect(result.map((e) => [e.usuario.nome, e.posicao])).toEqual([
      ['Bia', 1],
      ['Ana', 2],
      ['Caio', 3],
    ]);
  });

  test('desempate por dias concluídos e depois por atividades concluídas', () => {
    const result = rankEntries('semana', [
      entry('Ana', { concluidas: 4, total: 4, diasConcluidos: 2 }),
      entry('Bia', { concluidas: 2, total: 2, diasConcluidos: 2 }),
      entry('Caio', { concluidas: 3, total: 3, diasConcluidos: 3 }),
    ]);
    expect(result.map((e) => e.usuario.nome)).toEqual(['Caio', 'Ana', 'Bia']);
    expect(result.map((e) => e.posicao)).toEqual([1, 2, 3]);
  });

  test('empates dividem a posição (1º, 1º, 3º) e você vem primeiro no empate', () => {
    const result = rankEntries('mes', [
      entry('Bia', { concluidas: 2, total: 2, diasConcluidos: 2 }),
      entry('Caio', { concluidas: 1, total: 2, diasConcluidos: 0 }),
      entry('Zeca', { concluidas: 2, total: 2, diasConcluidos: 2 }, true),
    ]);
    expect(result.map((e) => [e.usuario.nome, e.posicao])).toEqual([
      ['Zeca', 1],
      ['Bia', 1],
      ['Caio', 3],
    ]);
  });

  test('sem atividades vai para o fim, sem posição (não como 0%)', () => {
    const result = rankEntries('semana', [
      entry('Ana', { concluidas: 0, total: 0 }),
      entry('Bia', { concluidas: 0, total: 5 }),
    ]);
    expect(result.map((e) => [e.usuario.nome, e.posicao])).toEqual([
      ['Bia', 1],
      ['Ana', null],
    ]);
  });

  test('sequência: atual e desempate pela maior sequência; sem histórico no fim', () => {
    const result = rankEntries('sequencia', [
      entry('Ana', { sequencia: 3, melhorSequencia: 3 }),
      entry('Bia', { sequencia: 3, melhorSequencia: 10 }),
      entry('Caio', { sequencia: 5, melhorSequencia: 5 }),
      entry('Davi', { sequencia: 3, melhorSequencia: 3 }),
      entry('Edu', { temHistorico: false }),
    ]);
    expect(result.map((e) => [e.usuario.nome, e.posicao])).toEqual([
      ['Caio', 1],
      ['Bia', 2],
      ['Ana', 3],
      ['Davi', 3],
      ['Edu', null],
    ]);
  });
});
