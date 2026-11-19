// Responsividade (UX-08): todas as telas em 320, 375, 414, 768 e 1280px, claro e
// escuro, com dados longos (nomes de 80 caracteres, sequência de 3 dígitos).
// Falha se houver rolagem horizontal, controle menor que 44×44px no celular ou
// elemento saindo da tela. Capturas vão para test-results/ (artefato no Actions).
// Roda no job "responsivo" do workflow de deploy: o deploy só segue se passar.
import crypto from 'node:crypto';
import { test, expect } from '@playwright/test';
import { PASSWORD, prisma } from './helpers.js';
import { hashPassword } from '../server/src/auth/password.js';
import { addDays, todayInSaoPaulo, zonedDateTime } from '../server/src/activities/recurrence.js';

const WIDTHS = [320, 375, 414, 768, 1280];
const MOBILE_MAX = 414;
const MIN_TARGET = 44;
const STREAK_DAYS = 120; // sequência de 3 dígitos

// Exatamente 80 caracteres (o máximo aceito para nomes)
const LONG_USER_NAME =
  'Maria Aparecida dos Santos Albuquerque Figueiredo de Vasconcelos Cavalcanti Neto';
const LONG_ACTIVITY =
  'Caminhada matinal no parque municipal seguida de alongamento e meditação guiada!';

let user;
let validateToken;

async function openActivityDialog(page) {
  await page.locator('.week-grid').waitFor();
  // Editar a atividade de nome longo; sem dia futuro na semana, "Nova atividade"
  const edit = page.locator('.week-activity-button').filter({ visible: true });
  if ((await edit.count()) > 0) await edit.first().click();
  else await page.locator('[data-add-date]').filter({ visible: true }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

const SCREENS = [
  { name: 'login', path: '/login', ready: (p) => p.getByRole('heading', { name: 'Entrar' }) },
  { name: 'inicio', path: '/', ready: (p) => p.locator('.week-grid') },
  { name: 'atividade', path: '/', open: openActivityDialog, ready: (p) => p.getByRole('dialog') },
  // Visão mensal com o detalhe de hoje aberto (atividade de nome longo)
  {
    name: 'mes',
    path: () => `/?mes=${todayInSaoPaulo().slice(0, 7)}`,
    ready: (p) => p.locator('.month-detail .week-activity'),
  },
  { name: 'usuarios', path: '/usuarios', ready: (p) => p.locator('.user-item').first() },
  {
    name: 'whatsapp',
    path: '/whatsapp',
    ready: (p) => p.getByRole('heading', { name: 'WhatsApp' }),
  },
  { name: 'amigos', path: '/amigos', ready: (p) => p.locator('.friends-page .user-item') },
  { name: 'ranking', path: '/amigos/ranking', ready: (p) => p.locator('.ranking-row-you') },
  { name: 'perfil', path: '/perfil', ready: (p) => p.getByRole('heading', { name: 'Meu perfil' }) },
  {
    name: 'validar',
    path: () => `/validar/${validateToken}`,
    ready: (p) => p.locator('.validate-card .validate-activity'),
  },
];

test.beforeAll(async () => {
  expect(LONG_USER_NAME).toHaveLength(80);
  expect(LONG_ACTIVITY).toHaveLength(80);

  const today = todayInSaoPaulo();
  const start = addDays(today, -STREAK_DAYS);
  // Usuário master (vê todas as telas) com nome, usuário e telefone longos.
  // Marco da sequência já comemorado: sem diálogo de comemoração por cima das telas.
  user = await prisma.user.create({
    data: {
      username: `resp-${crypto.randomBytes(14).toString('hex')}`.slice(0, 32),
      name: LONG_USER_NAME,
      phone: '+5532999999999',
      isMaster: true,
      lastCelebratedStreak: STREAK_DAYS,
      passwordHash: await hashPassword(PASSWORD),
    },
  });
  const activity = await prisma.activity.create({
    data: {
      userId: user.id,
      name: LONG_ACTIVITY,
      hour: 23,
      minute: 59,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startDate: start,
    },
  });

  // Todos os dias passados concluídos → sequência de STREAK_DAYS dias
  const occurrences = [];
  for (let date = start; date < today; date = addDays(date, 1)) {
    const scheduledAt = zonedDateTime(date, 23, 59);
    occurrences.push({
      activityId: activity.id,
      userId: user.id,
      date,
      scheduledAt,
      status: 'concluida',
      token: crypto.randomBytes(16).toString('hex'),
      expiresAt: new Date(scheduledAt.getTime() + 60 * 60 * 1000),
      completedAt: scheduledAt,
    });
  }
  await prisma.taskOccurrence.createMany({ data: occurrences });

  // Amigos: um amigo, um pedido recebido e um enviado, todos com nome e usuário longos
  const others = [];
  for (const role of ['amigo', 'recebido', 'enviado']) {
    others.push(
      await prisma.user.create({
        data: {
          username: `${role}-${crypto.randomBytes(14).toString('hex')}`.slice(0, 32),
          name: LONG_USER_NAME,
          passwordHash: await hashPassword(PASSWORD),
        },
      }),
    );
  }
  const [friend, requester, addressee] = others;
  const pair = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  await prisma.friendship.createMany({
    data: [
      {
        requesterId: user.id,
        addresseeId: friend.id,
        pairKey: pair(user.id, friend.id),
        status: 'aceita',
        respondedAt: new Date(),
      },
      { requesterId: requester.id, addresseeId: user.id, pairKey: pair(requester.id, user.id) },
      { requesterId: user.id, addresseeId: addressee.id, pairKey: pair(user.id, addressee.id) },
    ],
  });

  // Ocorrência de hoje, válida: a tela de validação mostra o nome longo
  // (na 1ª visita conclui; nas outras, "já validada" — ambas com o nome)
  validateToken = crypto.randomBytes(16).toString('hex');
  const now = new Date();
  await prisma.taskOccurrence.create({
    data: {
      activityId: activity.id,
      userId: user.id,
      date: today,
      scheduledAt: now,
      token: validateToken,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    },
  });
});

/** Rolagem horizontal e elementos visíveis que saem da tela pelas laterais. */
function overflowReport(page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const describe = (el) =>
      `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}`;
    // Visível = tem caixa e não está recortado por um ancestral com overflow
    const clippedByAncestor = (el, rect) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox !== 'visible') {
          const pr = p.getBoundingClientRect();
          if (rect.right <= pr.right + 1 && rect.left >= pr.left - 1) return false;
          return true;
        }
      }
      return false;
    };
    const outside = [...document.querySelectorAll('body *')]
      .filter((el) => !el.closest('.sr-only, [hidden], [aria-hidden="true"]'))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        if (getComputedStyle(el).visibility === 'hidden') return false;
        return (r.right > width + 1 || r.left < -1) && !clippedByAncestor(el, r);
      })
      .slice(0, 8)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return `${describe(el)} [${Math.round(r.left)}→${Math.round(r.right)} de ${width}]`;
      });
    return {
      scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyScroll: document.body.scrollWidth - document.body.clientWidth,
      outside,
    };
  });
}

/** Controles visíveis menores que `min` px (largura ou altura). */
function smallTargets(page, min) {
  return page.evaluate((min) => {
    const selector = 'a[href], button, input, select, textarea, [role="button"], [tabindex="0"]';
    return [...document.querySelectorAll(selector)]
      .filter((el) => !el.closest('.sr-only') && el.getClientRects().length > 0)
      .map((el) => {
        // Checkbox dentro do rótulo: o toque no rótulo inteiro marca, então o alvo é o rótulo
        const target = el.matches('label > input[type="checkbox"]') ? el.parentElement : el;
        const { width, height } = target.getBoundingClientRect();
        const name = (el.getAttribute('aria-label') || el.textContent || el.name || '').trim();
        return { name: `${el.tagName.toLowerCase()} "${name.slice(0, 40)}"`, width, height };
      })
      .filter(({ width, height }) => width < min - 0.5 || height < min - 0.5)
      .map(({ name, width, height }) => `${name}: ${Math.round(width)}×${Math.round(height)}`);
  }, min);
}

for (const scheme of ['light', 'dark']) {
  for (const width of WIDTHS) {
    test.describe(`responsivo · ${scheme} · ${width}px`, () => {
      test.use({
        colorScheme: scheme,
        viewport: { width, height: width <= MOBILE_MAX ? 800 : 900 },
      });

      for (const screen of SCREENS) {
        test(screen.name, async ({ page }, testInfo) => {
          if (screen.name !== 'login') {
            const res = await page.request.post('/api/auth/login', {
              data: { username: user.username, password: PASSWORD },
            });
            expect(res.ok()).toBe(true);
          }
          await page.goto(typeof screen.path === 'function' ? screen.path() : screen.path);
          await screen.open?.(page);
          await expect(screen.ready(page).first()).toBeVisible();
          await page.waitForLoadState('networkidle');
          await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);

          // Dados longos de fato na tela
          if (screen.name !== 'login') {
            // (a tela "validar" conclui a atividade de hoje: a sequência sobe 1)
            await expect(page.locator('.streak-badge')).toContainText(/\d{3} dias/);
          }

          await page.screenshot({
            path: testInfo.outputPath(`${screen.name}-${width}-${scheme}.png`),
            fullPage: true,
          });

          const overflow = await overflowReport(page);
          expect(overflow.outside, 'elementos saindo da tela').toEqual([]);
          expect(overflow.scroll, 'rolagem horizontal no documento').toBeLessThanOrEqual(0);
          expect(overflow.bodyScroll, 'rolagem horizontal no body').toBeLessThanOrEqual(0);

          if (width <= MOBILE_MAX) {
            expect(await smallTargets(page, MIN_TARGET), 'controles menores que 44×44px').toEqual(
              [],
            );
          }
        });
      }
    });
  }
}
