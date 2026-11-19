// Link de vídeo da atividade: validação (https://) e player incorporado para
// YouTube (youtube-nocookie.com) e Vimeo (dnt=1). Outros links abrem em nova aba.

/** URL https:// válida (mesma regra do servidor), ou null. */
export function parseHttpsUrl(value) {
  const text = String(value ?? '').trim();
  if (!text || text.length > 500 || /\s/.test(text)) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || !url.hostname.includes('.') || url.username || url.password)
      return null;
    return url;
  } catch {
    return null;
  }
}

const YT_ID = /^[\w-]{11}$/;

/** Segundos de "t=1m30s", "t=90" ou "start=90". */
function startSeconds(url) {
  const raw = url.searchParams.get('t') ?? url.searchParams.get('start');
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) return Number(raw);
  const m = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
}

function youtubeId(url) {
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  if (host === 'youtu.be') return url.pathname.split('/')[1];
  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null;
  if (url.pathname === '/watch') return url.searchParams.get('v');
  const m = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/]+)/);
  return m?.[1] ?? null;
}

function vimeo(url) {
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'player.vimeo.com') {
    const m = url.pathname.match(/^\/video\/(\d+)/);
    return m && { id: m[1], hash: url.searchParams.get('h') };
  }
  if (host !== 'vimeo.com') return null;
  // vimeo.com/123456, vimeo.com/123456/abcdef (não listado), vimeo.com/channels/x/123456
  const m = url.pathname.match(/(?:^|\/)(\d{5,})(?:\/([\da-f]{6,}))?\/?$/);
  return m && { id: m[1], hash: m[2] ?? url.searchParams.get('h') };
}

/**
 * Player incorporado do link: { provider, src } (YouTube/Vimeo) ou null (outros sites,
 * que viram o botão "Abrir vídeo").
 */
export function videoEmbed(value) {
  const url = parseHttpsUrl(value);
  if (!url) return null;
  const yt = youtubeId(url);
  if (yt && YT_ID.test(yt)) {
    const start = startSeconds(url);
    return {
      provider: 'YouTube',
      src: `https://www.youtube-nocookie.com/embed/${yt}?rel=0${start ? `&start=${start}` : ''}`,
    };
  }
  const vm = vimeo(url);
  if (vm) {
    const hash = vm.hash && /^[\da-f]+$/.test(vm.hash) ? `&h=${vm.hash}` : '';
    return { provider: 'Vimeo', src: `https://player.vimeo.com/video/${vm.id}?dnt=1${hash}` };
  }
  return null;
}
