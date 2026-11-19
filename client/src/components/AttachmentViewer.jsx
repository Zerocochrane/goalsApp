import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { attachmentUrl, isPhotoAttachment } from '../lib/attachments.js';
import t from '../i18n/pt-BR.js';

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/**
 * Visualizador do anexo em tela cheia, dentro do app: foto (zoom com pinça, roda do
 * mouse, toque duplo e botões) ou PDF (PDF.js, carregado só aqui — o Chrome do Android
 * não mostra PDF em <iframe>). "Baixar" fica sempre à mão. Esc ou "Fechar" fecham.
 */
export default function AttachmentViewer({ activityId, attachment, onClose }) {
  const ref = useRef(null);
  const closeRef = useRef(null);
  const titleId = useId();
  const photo = isPhotoAttachment(attachment);
  const src = attachmentUrl(activityId, attachment);

  useLayoutEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    closeRef.current?.focus();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className="viewer"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="viewer-bar">
        <h2 id={titleId} className="viewer-title" title={attachment.originalName}>
          {attachment.originalName}
        </h2>
        <a
          className="button button-ghost viewer-button"
          href={attachmentUrl(activityId, attachment, { download: true })}
          download={attachment.originalName}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="viewer-icon">
            <path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19h14" />
          </svg>
          <span>{t.attachment.viewerDownload}</span>
        </a>
        <button
          ref={closeRef}
          type="button"
          className="button button-ghost viewer-button"
          onClick={onClose}
          aria-label={t.attachment.viewerClose}
        >
          <span aria-hidden="true" className="viewer-close-x">
            ×
          </span>
        </button>
      </div>
      {photo ? <PhotoView src={src} alt={attachment.originalName} /> : <PdfView src={src} />}
    </dialog>
  );
}

function ZoomControls({ zoom, onZoom, onReset }) {
  return (
    <div className="viewer-zoom" role="group" aria-label="Zoom">
      <button
        type="button"
        className="button button-ghost viewer-button"
        onClick={() => onZoom(zoom / 1.5)}
        disabled={zoom <= MIN_ZOOM}
        aria-label={t.attachment.viewerZoomOut}
      >
        <span aria-hidden="true">−</span>
      </button>
      <button
        type="button"
        className="button button-ghost viewer-button viewer-zoom-value"
        onClick={onReset}
        aria-label={t.attachment.viewerReset}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        className="button button-ghost viewer-button"
        onClick={() => onZoom(zoom * 1.5)}
        disabled={zoom >= MAX_ZOOM}
        aria-label={t.attachment.viewerZoomIn}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------- Foto

function PhotoView({ src, alt }) {
  const stageRef = useRef(null);
  // Transformação: desloca (x, y) a partir do centro e aplica a escala
  const [view, setViewState] = useState({ scale: 1, x: 0, y: 0 });
  const [error, setError] = useState(false);
  // Cópia sempre atual da transformação (os gestos leem entre uma renderização e outra)
  const viewRef = useRef(view);
  const setView = (next) => {
    viewRef.current = next;
    setViewState(next);
  };
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  const lastTap = useRef(0);

  /** Ponto do evento relativo ao centro do palco. */
  function local(event) {
    const box = stageRef.current.getBoundingClientRect();
    return {
      x: event.clientX - box.left - box.width / 2,
      y: event.clientY - box.top - box.height / 2,
    };
  }

  /** Zoom mantendo o ponto `focus` (relativo ao centro) parado na tela. */
  function zoomAt(nextScale, focus = { x: 0, y: 0 }, from = viewRef.current) {
    const scale = clamp(nextScale, MIN_ZOOM, MAX_ZOOM);
    if (scale === MIN_ZOOM) return setView({ scale, x: 0, y: 0 });
    const k = scale / from.scale;
    setView({ scale, x: focus.x - k * (focus.x - from.x), y: focus.y - k * (focus.y - from.y) });
  }

  function startGesture() {
    const points = [...pointers.current.values()];
    const v = viewRef.current;
    if (points.length >= 2) {
      const [a, b] = points;
      gesture.current = {
        type: 'pinch',
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        view: v,
      };
    } else if (points.length === 1) {
      gesture.current = { type: 'pan', start: points[0], view: v };
    } else gesture.current = null;
  }

  function onPointerDown(event) {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, local(event));
    // Toque duplo (dedo): alterna entre 1× e 2,5×
    if (event.pointerType === 'touch' && pointers.current.size === 1) {
      const now = Date.now();
      if (now - lastTap.current < 300) {
        const v = viewRef.current;
        zoomAt(v.scale > 1 ? 1 : 2.5, local(event), v);
        lastTap.current = 0;
      } else lastTap.current = now;
    }
    startGesture();
  }

  function onPointerMove(event) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, local(event));
    const g = gesture.current;
    if (!g) return;
    const points = [...pointers.current.values()];
    if (g.type === 'pinch' && points.length >= 2) {
      const [a, b] = points;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const scale = clamp((g.view.scale * dist) / g.dist, MIN_ZOOM, MAX_ZOOM);
      const k = scale / g.view.scale;
      setView({
        scale,
        x: mid.x - k * (g.mid.x - g.view.x),
        y: mid.y - k * (g.mid.y - g.view.y),
      });
    } else if (g.type === 'pan' && g.view.scale > 1) {
      const p = points[0];
      setView({ ...g.view, x: g.view.x + p.x - g.start.x, y: g.view.y + p.y - g.start.y });
    }
  }

  function onPointerUp(event) {
    pointers.current.delete(event.pointerId);
    if (viewRef.current.scale <= 1.01) setView({ scale: 1, x: 0, y: 0 });
    startGesture();
  }

  // Roda do mouse / pinça do trackpad (precisa de listener não passivo para o preventDefault)
  useEffect(() => {
    const stage = stageRef.current;
    function onWheel(event) {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002));
      const box = stage.getBoundingClientRect();
      zoomAt(viewRef.current.scale * factor, {
        x: event.clientX - box.left - box.width / 2,
        y: event.clientY - box.top - box.height / 2,
      });
    }
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
    // zoomAt só usa refs e o setter do estado: registrar uma vez basta
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div
        ref={stageRef}
        className="viewer-stage viewer-photo-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(event) => {
          const v = viewRef.current;
          zoomAt(v.scale > 1 ? 1 : 2.5, local(event), v);
        }}
        data-zoomed={view.scale > 1}
      >
        {error ? (
          <p className="viewer-message" role="alert">
            {t.attachment.viewerPhotoError}
          </p>
        ) : (
          <img
            className="viewer-photo"
            src={src}
            alt={alt}
            draggable="false"
            onError={() => setError(true)}
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
          />
        )}
      </div>
      <div className="viewer-footer">
        <p className="viewer-hint">{t.attachment.viewerPhotoHint}</p>
        <ZoomControls
          zoom={view.scale}
          onZoom={(z) => zoomAt(z)}
          onReset={() => setView({ scale: 1, x: 0, y: 0 })}
        />
      </div>
    </>
  );
}

// ----------------------------------------------------------------------------- PDF

let pdfjsPromise = null;

/** PDF.js sob demanda (não entra no pacote principal do app). */
function loadPdfJs() {
  pdfjsPromise ??= Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ])
    .then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    })
    .catch((err) => {
      pdfjsPromise = null;
      throw err;
    });
  return pdfjsPromise;
}

// Limite de pixels por página (o Safari do iPhone recusa canvas muito grandes)
const MAX_CANVAS_PIXELS = 16_000_000;

function PdfView({ src }) {
  const stageRef = useRef(null);
  const [doc, setDoc] = useState(null);
  const [state, setState] = useState('loading');
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let loaded = null;
    (async () => {
      try {
        const [pdfjs, data] = await Promise.all([
          loadPdfJs(),
          fetch(src, { credentials: 'same-origin' }).then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.arrayBuffer();
          }),
        ]);
        loaded = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
        if (cancelled) return loaded.destroy();
        setDoc(loaded);
        setState('ready');
      } catch (err) {
        console.error('[pdf]', err);
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
      loaded?.destroy();
    };
  }, [src]);

  // Largura disponível (as páginas ocupam a largura do visualizador no zoom 100%)
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const observer = new ResizeObserver(() => setWidth(stage.clientWidth));
    observer.observe(stage);
    setWidth(stage.clientWidth);
    return () => observer.disconnect();
  }, []);

  const pages = doc ? Array.from({ length: doc.numPages }, (_, i) => i + 1) : [];

  return (
    <>
      <div ref={stageRef} className="viewer-stage viewer-pdf-stage" aria-busy={state === 'loading'}>
        {state === 'loading' && (
          <div className="inline-loading viewer-message" role="status">
            <span className="spinner" aria-hidden="true" />
            <span>{t.attachment.viewerLoadingPdf}</span>
          </div>
        )}
        {state === 'error' && (
          <p className="viewer-message" role="alert">
            {t.attachment.viewerPdfError}
          </p>
        )}
        {doc &&
          width > 0 &&
          pages.map((n) => (
            <PdfPage
              key={n}
              doc={doc}
              number={n}
              total={doc.numPages}
              width={Math.max(200, width - 16) * zoom}
            />
          ))}
      </div>
      {state === 'ready' && (
        <div className="viewer-footer">
          <p className="viewer-hint">{t.attachment.viewerPages(doc.numPages)}</p>
          <ZoomControls
            zoom={zoom}
            onZoom={(z) => setZoom(clamp(z, 1, 4))}
            onReset={() => setZoom(1)}
          />
        </div>
      )}
    </>
  );
}

/** Uma página do PDF, desenhada quando chega perto da área visível. */
function PdfPage({ doc, number, total, width }) {
  const canvasRef = useRef(null);
  const [visible, setVisible] = useState(number <= 2);
  const [size, setSize] = useState(null);

  // Proporção da página (para reservar o espaço antes de desenhar)
  useEffect(() => {
    let cancelled = false;
    doc.getPage(number).then((page) => {
      if (cancelled) return;
      const vp = page.getViewport({ scale: 1 });
      setSize({ w: vp.width, h: vp.height });
    });
    return () => {
      cancelled = true;
    };
  }, [doc, number]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (visible || !canvas) return undefined;
    const observer = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && setVisible(true),
      { rootMargin: '600px 0px' },
    );
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [visible, size]);

  useEffect(() => {
    if (!visible || !size) return undefined;
    let task = null;
    let cancelled = false;
    doc.getPage(number).then((page) => {
      if (cancelled) return;
      const cssScale = width / size.w;
      const dpr = window.devicePixelRatio || 1;
      let scale = cssScale * dpr;
      const pixels = size.w * size.h * scale * scale;
      if (pixels > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      task = page.render({ canvas, viewport });
      task.promise.catch(() => {}); // cancelado ao mudar o zoom
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, number, visible, size, width]);

  const height = size ? (width * size.h) / size.w : width * 1.414;
  return (
    <canvas
      ref={canvasRef}
      className="viewer-pdf-page"
      style={{ width: `${width}px`, height: `${height}px` }}
      role="img"
      aria-label={t.attachment.viewerPage(number, total)}
    />
  );
}
