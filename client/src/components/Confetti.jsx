import { useEffect, useRef } from 'react';

const DURATION_MS = 2500;
const FADE_MS = 600;
// Cores do tema: verde de concluído, azul principal e amarelo da sequência
const COLOR_VARS = ['--color-success', '--color-primary', '--color-warning'];
const FALLBACK_COLORS = ['#15803d', '#2563eb', '#b45309'];

function themeColors() {
  const style = getComputedStyle(document.documentElement);
  return COLOR_VARS.map((name, i) => style.getPropertyValue(name).trim() || FALLBACK_COLORS[i]);
}

function createParticles(width, height, colors) {
  // Menos partículas em telas pequenas: leve no celular
  const count = Math.round(Math.min(180, Math.max(70, width / 6)));
  return Array.from({ length: count }, (_, i) => ({
    x: Math.random() * width,
    y: -20 - Math.random() * height * 0.5,
    vx: (Math.random() - 0.5) * 120, // px/s
    vy: 120 + Math.random() * 220,
    rotation: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 10, // rad/s
    sway: Math.random() * Math.PI * 2,
    w: 6 + Math.random() * 6,
    h: 4 + Math.random() * 6,
    color: colors[i % colors.length],
  }));
}

/**
 * Confete caindo do topo sobre a tela inteira por ~2,5s, sem bloquear cliques.
 * Um <canvas> com requestAnimationFrame; chama `onDone` ao terminar (o pai o remove).
 */
export default function Confetti({ onDone, duration = DURATION_MS }) {
  const canvasRef = useRef(null);
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) {
      onDoneRef.current?.();
      return undefined;
    }

    let width = 0;
    let height = 0;
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    const particles = createParticles(width, height, themeColors());
    let frame = 0;
    let start = null;
    let last = null;

    function tick(time) {
      start ??= time;
      const dt = Math.min((time - (last ?? time)) / 1000, 0.05);
      last = time;
      const elapsed = time - start;
      if (elapsed >= duration) {
        ctx.clearRect(0, 0, width, height);
        onDoneRef.current?.();
        return;
      }

      ctx.clearRect(0, 0, width, height);
      ctx.globalAlpha = Math.min(1, (duration - elapsed) / FADE_MS);
      for (const p of particles) {
        p.vy += 300 * dt; // gravidade
        p.x += (p.vx + Math.sin(p.sway + elapsed / 300) * 40) * dt;
        p.y += p.vy * dt;
        p.rotation += p.spin * dt;
        if (p.y > height + 20) continue;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        // "Achata" o retângulo com o giro, imitando papel virando no ar
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.rotation)));
        ctx.restore();
      }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
    };
  }, [duration]);

  return <canvas ref={canvasRef} className="confetti-canvas" aria-hidden="true" />;
}
