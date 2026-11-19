// Lista de amigos (issue #28): dois usuários viram amigos pela interface, o contador da
// aba mostra o pedido pendente e nenhum dado privado (atividades, telefone) aparece.
import { test, expect } from '@playwright/test';
import { createUser, loginWithForm, prisma, tomorrow } from './helpers.js';

test('pedido, aceite, contador da aba e remoção com confirmação', async ({ browser }) => {
  const ana = await createUser('ana');
  const bia = await createUser('bia');
  await prisma.user.update({ where: { id: bia.id }, data: { phone: '+5532988776655' } });
  await prisma.activity.create({
    data: {
      userId: bia.id,
      name: 'Atividade privada da Bia',
      hour: 6,
      minute: 0,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startDate: tomorrow(),
    },
  });

  const anaPage = await (await browser.newContext()).newPage();
  const biaPage = await (await browser.newContext()).newPage();

  // Ana envia o pedido pelo @usuário
  await anaPage.goto('/amigos');
  await loginWithForm(anaPage, ana.username);
  await expect(anaPage.getByRole('heading', { name: 'Amigos', exact: true })).toBeVisible();
  await expect(anaPage.getByText(/Você ainda não tem amigos/)).toBeVisible();

  const field = anaPage.getByLabel('@usuário do amigo');
  await field.fill('nao-existe-ninguem');
  await anaPage.getByRole('button', { name: 'Enviar pedido' }).click();
  await expect(anaPage.getByText('Usuário não encontrado')).toBeVisible();

  await field.fill(ana.username);
  await anaPage.getByRole('button', { name: 'Enviar pedido' }).click();
  await expect(anaPage.getByText('Você não pode adicionar a si mesmo')).toBeVisible();

  await field.fill(`@${bia.username}`);
  await anaPage.getByRole('button', { name: 'Enviar pedido' }).click();
  await expect(anaPage.getByRole('status').filter({ hasText: 'Pedido enviado' })).toBeVisible();
  const sent = anaPage.getByRole('region', { name: 'Pedidos enviados' });
  await expect(sent.getByText(`@${bia.username}`)).toBeVisible();

  await field.fill(bia.username);
  await anaPage.getByRole('button', { name: 'Enviar pedido' }).click();
  await expect(anaPage.getByText(`Você já enviou um pedido para @${bia.username}`)).toBeVisible();

  // Bia vê o contador na aba e aceita
  await biaPage.goto('/');
  await loginWithForm(biaPage, bia.username);
  const nav = biaPage.getByRole('navigation', { name: 'Navegação principal' });
  const tab = nav.getByRole('link', { name: /Amigos/ });
  await expect(tab).toContainText('1');
  await expect(tab).toHaveAccessibleName(/1 pedido de amizade pendente/);
  await tab.click();
  const received = biaPage.getByRole('region', { name: /Pedidos recebidos/ });
  await expect(received.getByText(`@${ana.username}`)).toBeVisible();
  await received.getByRole('button', { name: `Aceitar pedido de ${ana.name}` }).click();
  await expect(biaPage.getByText(`Agora você e ${ana.name} são amigos.`)).toBeVisible();
  await expect(tab.locator('.app-nav-count')).toHaveCount(0);

  const biaFriends = biaPage.getByRole('region', { name: /Seus amigos/ });
  await expect(biaFriends.getByText(`@${ana.username}`)).toBeVisible();

  // Ana vê Bia como amiga, com a sequência, mas sem atividades nem telefone
  await anaPage.reload();
  const anaFriends = anaPage.getByRole('region', { name: /Seus amigos/ });
  await expect(anaFriends.getByText(`@${bia.username}`)).toBeVisible();
  await expect(anaFriends.getByText('0 dias seguidos')).toBeVisible();
  await expect(anaPage.getByRole('region', { name: 'Pedidos enviados' })).toHaveCount(0);
  const text = await anaPage.locator('main').innerText();
  expect(text).not.toContain('Atividade privada da Bia');
  expect(text).not.toMatch(/98877-?6655|5532988776655/);

  // Remover pede confirmação; cancelar mantém, confirmar remove dos dois lados
  await anaFriends.getByRole('button', { name: `Remover ${bia.name} dos amigos` }).click();
  const dialog = anaPage.getByRole('dialog', { name: 'Desfazer amizade?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialog).toBeHidden();
  await expect(anaFriends.getByText(`@${bia.username}`)).toBeVisible();

  await anaFriends.getByRole('button', { name: `Remover ${bia.name} dos amigos` }).click();
  await dialog.getByRole('button', { name: 'Remover' }).click();
  await expect(dialog).toBeHidden();
  await expect(anaPage.getByText(/Você ainda não tem amigos/)).toBeVisible();

  await biaPage.reload();
  await expect(biaPage.getByText(/Você ainda não tem amigos/)).toBeVisible();
});

test('recusar e cancelar pedidos', async ({ page, browser }) => {
  const caio = await createUser('caio');
  const dani = await createUser('dani');
  const eva = await createUser('eva');
  // Dani já pediu Caio; Caio pede Eva pela tela e depois cancela
  await prisma.friendship.create({
    data: {
      requesterId: dani.id,
      addresseeId: caio.id,
      pairKey: dani.id < caio.id ? `${dani.id}:${caio.id}` : `${caio.id}:${dani.id}`,
    },
  });

  await page.goto('/amigos');
  await loginWithForm(page, caio.username);
  const received = page.getByRole('region', { name: /Pedidos recebidos/ });
  await received.getByRole('button', { name: `Recusar pedido de ${dani.name}` }).click();
  await expect(page.getByText(`Pedido de ${dani.name} recusado.`)).toBeVisible();
  await expect(received).toHaveCount(0);

  await page.getByLabel('@usuário do amigo').fill(eva.username);
  await page.getByRole('button', { name: 'Enviar pedido' }).click();
  const sent = page.getByRole('region', { name: 'Pedidos enviados' });
  await sent.getByRole('button', { name: `Cancelar pedido para ${eva.name}` }).click();
  await expect(page.getByText(`Pedido para ${eva.name} cancelado.`)).toBeVisible();
  await expect(sent).toHaveCount(0);

  // Eva não ficou com pedido nenhum
  const evaPage = await (await browser.newContext()).newPage();
  await evaPage.goto('/amigos');
  await loginWithForm(evaPage, eva.username);
  await expect(evaPage.getByText(/Você ainda não tem amigos/)).toBeVisible();
  await expect(evaPage.getByRole('region', { name: /Pedidos recebidos/ })).toHaveCount(0);
});
