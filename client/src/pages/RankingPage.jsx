import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import FriendsTabs from '../components/FriendsTabs.jsx';
import { api } from '../lib/api.js';
import {
  addDays,
  formatMonthYear,
  formatWeekRange,
  monthOf,
  startOfWeek,
  todayInSaoPaulo,
} from '../lib/dates.js';
import { apiErrorMessage } from '../lib/errors.js';
import { onFriendsChanged } from '../lib/friends.js';
import t from '../i18n/pt-BR.js';

const PERIODS = ['semana', 'mes', 'sequencia'];
const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };

/** Texto do período exibido. Ex.: "16 a 22 de nov. de 2026", "Novembro de 2026". */
function periodText(periodo) {
  const today = todayInSaoPaulo();
  if (periodo === 'semana') {
    const start = startOfWeek(today);
    return formatWeekRange(start, addDays(start, 6));
  }
  if (periodo === 'mes') return formatMonthYear(monthOf(today));
  return t.ranking.streakPeriod;
}

function Position({ posicao }) {
  if (posicao === null) {
    return (
      <span className="ranking-position ranking-position-none" aria-hidden="true">
        –
      </span>
    );
  }
  return (
    <span className={`ranking-position${MEDALS[posicao] ? ' ranking-position-medal' : ''}`}>
      <span aria-hidden="true">{MEDALS[posicao] ?? `${posicao}º`}</span>
      <span className="sr-only">{t.ranking.positionAria(posicao)}</span>
    </span>
  );
}

function Row({ entry, periodo }) {
  const { usuario, voce, posicao } = entry;
  const empty = posicao === null;
  const isStreak = periodo === 'sequencia';

  return (
    <li className={`card ranking-row${voce ? ' ranking-row-you' : ''}`}>
      <Position posicao={posicao} />
      <div className="ranking-info">
        <p className="ranking-name">
          <span className="ranking-name-text">{usuario.nome}</span>
          {voce && <span className="badge ranking-you">{t.ranking.you}</span>}
        </p>
        <p className="muted ranking-username">@{usuario.username}</p>
        {!empty && !isStreak && (
          <>
            <div
              className="ranking-bar"
              role="progressbar"
              aria-label={t.ranking.barAria(usuario.nome)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={entry.percentual}
            >
              <span style={{ width: `${entry.percentual}%` }} />
            </div>
            <p className="muted ranking-detail">
              {t.ranking.activities(entry.concluidas, entry.total)}
              {' · '}
              {t.ranking.days(entry.diasConcluidos)}
            </p>
          </>
        )}
        {!empty && isStreak && (
          <p className="muted ranking-detail">{t.ranking.best(entry.melhorSequencia)}</p>
        )}
      </div>
      <p className={`ranking-value${empty ? ' ranking-value-empty' : ''}`}>
        {empty ? (
          t.ranking.noActivities
        ) : isStreak ? (
          <>
            <span aria-hidden="true">🔥 </span>
            <span className="sr-only">{t.ranking.streakAria(entry.sequencia)}</span>
            <span aria-hidden="true">{entry.sequencia}</span>
          </>
        ) : (
          `${entry.percentual}%`
        )}
      </p>
    </li>
  );
}

export default function RankingPage() {
  const [periodo, setPeriodo] = useState('semana');
  const [data, setData] = useState(null); // { periodo, entries }
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api(`/leaderboard?periodo=${periodo}`)
      .then((entries) => {
        if (cancelled) return;
        setData({ periodo, entries });
        setError('');
      })
      .catch((err) => !cancelled && setError(apiErrorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [periodo, reloadKey]);

  // Atualiza ao voltar para a aba/janela e quando as amizades mudam
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') setReloadKey((k) => k + 1);
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    const off = onFriendsChanged(refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      off();
    };
  }, []);

  const current = data?.periodo === periodo ? data.entries : null;
  const hasFriends = current ? current.some((e) => !e.voce) : null;

  return (
    <section className="ranking-page">
      <FriendsTabs />
      <div className="page-header">
        <div>
          <h1>{t.ranking.title}</h1>
          <p className="muted">{t.ranking.subtitle}</p>
        </div>
      </div>

      <div className="segmented ranking-periods" role="group" aria-label={t.ranking.periodLabel}>
        {PERIODS.map((value) => (
          <button
            key={value}
            type="button"
            className="segmented-option"
            aria-pressed={periodo === value}
            onClick={() => setPeriodo(value)}
          >
            <span className="ranking-period-long">{t.ranking.periods[value]}</span>
            <span className="ranking-period-short">{t.ranking.periodsShort[value]}</span>
          </button>
        ))}
      </div>
      <p className="muted ranking-range" data-testid="ranking-range">
        {periodText(periodo)}
      </p>

      {error ? (
        <div className="form-error" role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="button button-ghost"
            onClick={() => {
              setError('');
              setData(null);
              setReloadKey((k) => k + 1);
            }}
          >
            {t.friends.retry}
          </button>
        </div>
      ) : current === null ? (
        <div className="inline-loading" role="status">
          <span className="spinner" aria-hidden="true" />
          <span>{t.app.loading}</span>
        </div>
      ) : !hasFriends ? (
        <div className="card ranking-empty">
          <p>{t.ranking.empty}</p>
          <Link to="/amigos" className="button button-primary">
            {t.ranking.emptyLink}
          </Link>
        </div>
      ) : (
        <ol className="ranking-list" aria-label={t.ranking.listLabel(t.ranking.periods[periodo])}>
          {current.map((entry) => (
            <Row key={entry.usuario.id} entry={entry} periodo={periodo} />
          ))}
        </ol>
      )}
    </section>
  );
}
