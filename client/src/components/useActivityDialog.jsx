import { useEffect, useRef, useState } from 'react';
import ActivityDialog from './ActivityDialog.jsx';
import { completeActivity } from '../lib/completeActivity.js';

/**
 * Modal de criar/editar atividade do calendário, com aviso de sucesso e foco.
 *
 * - `open(event, { date })` cria; `open(event, { date, activityId, item })` edita (com
 *   `item` do calendário de hoje, o modal também mostra "Concluir atividade")
 * - `complete(event, item, date)`: atalho ✓ da linha — conclui sem abrir o modal
 * - depois de salvar/excluir chama `reload()` e, quando a recarga termina
 *   (`refreshing` false), devolve o foco a quem abriu o modal; se ele sumiu, ao
 *   botão "Adicionar" do dia ou, por fim, a `fallbackRef` (título do calendário)
 * - `dialog`: elemento a renderizar (null com o modal fechado)
 */
export default function useActivityDialog({ reload, refreshing, fallbackRef }) {
  // Modal aberto: { date } para criar, { date, activityId } para editar
  const [state, setState] = useState(null);
  const [notice, setNotice] = useState('');
  // Elemento que abriu o modal (recebe o foco de volta ao fechar)
  const openerRef = useRef(null);
  // Depois de salvar/excluir: dia cujo foco deve ser restaurado quando a recarga chegar
  const pendingFocusRef = useRef(null);

  function restoreFocus(date) {
    const opener = openerRef.current;
    const target =
      opener?.isConnected && !opener.disabled
        ? opener
        : (document.querySelector(`[data-add-date="${date}"]`) ?? fallbackRef.current);
    target?.focus();
  }

  useEffect(() => {
    if (pendingFocusRef.current === null || refreshing) return;
    const date = pendingFocusRef.current;
    pendingFocusRef.current = null;
    restoreFocus(date);
  });

  function open(event, next) {
    openerRef.current = event.currentTarget;
    setNotice('');
    setState(next);
  }

  function close() {
    const { date } = state;
    setState(null);
    requestAnimationFrame(() => restoreFocus(date));
  }

  function done(message) {
    setNoticeIsError(false);
    // O foco volta só depois da recarga, quando a lista já reflete a alteração
    pendingFocusRef.current = state.date;
    setState(null);
    setNotice(message);
    reload();
  }

  // Atalho ✓ da linha: conclui direto; o foco volta para a linha (que continua na tela)
  const [completingId, setCompletingId] = useState(null);
  const [noticeIsError, setNoticeIsError] = useState(false);
  async function complete(event, item, date) {
    if (completingId !== null) return;
    const row = event.currentTarget.closest('li')?.querySelector('.week-activity-button');
    openerRef.current = row ?? event.currentTarget;
    setNotice('');
    setCompletingId(item.activityId);
    const { ok, message } = await completeActivity(item.activityId);
    setCompletingId(null);
    // Sucesso ou recusa (antes do horário, prazo encerrado…): a lista reflete o servidor
    pendingFocusRef.current = date;
    setNoticeIsError(!ok);
    setNotice(message);
    reload();
  }

  const dialog = state && (
    <ActivityDialog
      key={`${state.date}|${state.activityId ?? 'nova'}`}
      date={state.date}
      activityId={state.activityId ?? null}
      item={state.item ?? null}
      onChanged={reload}
      onClose={close}
      onDone={done}
    />
  );

  return { open, complete, completingId, notice, noticeIsError, setNotice, dialog };
}
