// Vault graph: a hand-rolled force layout on a 2D canvas.
import { get } from './api';
import { md, esc } from './md';
import type { State } from './types';

interface N { id: string; title: string; folder: string; reads: string[]; writes: string[]; x: number; y: number; vx: number; vy: number; deg: number }
interface L { source: string; target: string }

const PALETTE = ['#ffb224', '#3ee6c8', '#ff7ab8', '#a3e635', '#4cc3ff', '#ff8a3d', '#e8d8b8', '#ffd84d'];

export async function openGraph(root: HTMLElement, st: State, openNote: (id: string) => void) {
  const g = await get<{ nodes: Omit<N, 'x' | 'y' | 'vx' | 'vy' | 'deg'>[]; links: L[] }>('/api/vault');
  root.innerHTML = `<div class="sheet-head"><h2>Knowledge Vault</h2><span class="muted">${g.nodes.length} notes · ${g.links.length} links · drag to pan, scroll to zoom</span></div>
    <div class="graph-wrap"><canvas></canvas><aside class="note-card hidden"></aside></div>`;
  const canvas = root.querySelector('canvas')!;
  const card = root.querySelector('.note-card') as HTMLElement;
  const ctx = canvas.getContext('2d')!;
  const folders = [...new Set(g.nodes.map(n => n.folder))];
  const color = (f: string) => PALETTE[folders.indexOf(f) % PALETTE.length];
  const nodes: N[] = g.nodes.map((n, i) => ({ ...n, x: Math.cos(i * 2.4) * (60 + i * 6), y: Math.sin(i * 2.4) * (60 + i * 6), vx: 0, vy: 0, deg: 0 }));
  const byId = new Map(nodes.map(n => [n.id, n]));
  const links = g.links.filter(l => byId.has(l.source) && byId.has(l.target));
  links.forEach(l => { byId.get(l.source)!.deg++; byId.get(l.target)!.deg++; });
  const radius = (n: N) => 4 + Math.sqrt(n.deg) * 2.6;
  let view = { x: 0, y: 0, k: 1.35 }, hover: N | null = null, selected: N | null = null, alive = true, heat = 1;

  const legend = document.createElement('div');
  legend.className = 'legend';
  legend.innerHTML = folders.map(f => `<span><i style="background:${color(f)}"></i>${esc(f)}</span>`).join('');
  root.querySelector('.graph-wrap')!.appendChild(legend);

  function step() {
    if (heat < 0.002) return;
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      let dx = b.x - a.x, dy = b.y - a.y; const d2 = Math.max(30, dx * dx + dy * dy);
      const f = 7000 / d2; const d = Math.sqrt(d2); dx /= d; dy /= d;
      a.vx -= dx * f; a.vy -= dy * f; b.vx += dx * f; b.vy += dy * f;
    }
    for (const l of links) {
      const a = byId.get(l.source)!, b = byId.get(l.target)!;
      const dx = b.x - a.x, dy = b.y - a.y; const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - 95) * 0.015;
      a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
    }
    for (const n of nodes) { n.vx -= n.x * 0.0025; n.vy -= n.y * 0.0025; n.x += n.vx * heat; n.y += n.vy * heat; n.vx *= 0.6; n.vy *= 0.6; }
    heat *= 0.992;
  }

  function draw() {
    if (!alive || !canvas.isConnected) return;
    const w = canvas.clientWidth, h = canvas.clientHeight, dpr = devicePixelRatio;
    if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
    step();
    const css = getComputedStyle(document.body);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.translate(w / 2 + view.x, h / 2 + view.y); ctx.scale(view.k, view.k);
    const focus = hover || selected;
    const near = new Set<string>();
    if (focus) { near.add(focus.id); links.forEach(l => { if (l.source === focus.id) near.add(l.target); if (l.target === focus.id) near.add(l.source); }); }
    ctx.lineWidth = 1 / view.k;
    for (const l of links) {
      const a = byId.get(l.source)!, b = byId.get(l.target)!;
      const on = focus && (l.source === focus.id || l.target === focus.id);
      ctx.strokeStyle = on ? '#ffb224' : css.getPropertyValue('--line-strong');
      ctx.globalAlpha = focus && !on ? 0.25 : 0.9;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (const n of nodes) {
      const r = radius(n);
      ctx.globalAlpha = focus && !near.has(n.id) ? 0.25 : 1;
      ctx.fillStyle = color(n.folder); ctx.shadowColor = color(n.folder); ctx.shadowBlur = near.has(n.id) ? 22 : 10;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) { const a = Math.PI / 3 * k; ctx.lineTo(n.x + Math.cos(a) * r, n.y + Math.sin(a) * r); }
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      if (n.writes.length) { ctx.strokeStyle = '#ffb224'; ctx.lineWidth = 2 / view.k; ctx.stroke(); }
      if (n.reads.length) { ctx.fillStyle = '#5eead4'; ctx.beginPath(); ctx.arc(n.x + r, n.y - r, 2.2, 0, 7); ctx.fill(); }
      if (view.k > 0.7 || near.has(n.id)) {
        ctx.fillStyle = css.getPropertyValue('--text'); ctx.font = `500 ${11.5 / Math.max(0.8, view.k)}px Inter, system-ui, sans-serif`;
        ctx.fillText(n.title.slice(0, 32), n.x + r + 3, n.y + 3);
      }
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
  }

  const toWorld = (e: MouseEvent) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left - r.width / 2 - view.x) / view.k, y: (e.clientY - r.top - r.height / 2 - view.y) / view.k }; };
  const pick = (e: MouseEvent) => { const p = toWorld(e); return nodes.find(n => (n.x - p.x) ** 2 + (n.y - p.y) ** 2 < (radius(n) + 4) ** 2) || null; };
  let drag: { x: number; y: number } | null = null, moved = false;
  canvas.addEventListener('mousedown', e => { drag = { x: e.clientX, y: e.clientY }; moved = false; });
  addEventListener('mouseup', () => (drag = null));
  canvas.addEventListener('mousemove', e => {
    if (drag) { view.x += e.clientX - drag.x; view.y += e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY }; moved = true; return; }
    hover = pick(e); canvas.style.cursor = hover ? 'pointer' : 'grab';
  });
  canvas.addEventListener('wheel', e => { e.preventDefault(); view.k = Math.max(0.3, Math.min(3, view.k * (e.deltaY < 0 ? 1.1 : 0.9))); }, { passive: false });
  canvas.addEventListener('click', async e => {
    if (moved) return;
    selected = pick(e);
    if (!selected) { card.classList.add('hidden'); return; }
    const n = await get<{ id: string; title: string; body: string; links: string[]; backlinks: string[]; reads: string[]; writes: string[] }>(`/api/note?id=${encodeURIComponent(selected.id)}`);
    const nm = (ids: string[]) => ids.map(id => st.workers.find(w => w.id === id)?.name || id).join(', ') || '—';
    card.classList.remove('hidden');
    card.innerHTML = `<div class="path">${esc(n.id)}.md</div><div class="who"><span>read by <b>${esc(nm(n.reads))}</b></span><span>written by <b>${esc(nm(n.writes))}</b></span></div>
      <div class="md">${md(n.body)}</div><div class="muted small">← ${n.backlinks.length} backlinks · → ${n.links.length} links</div>`;
    card.querySelectorAll<HTMLElement>('a.wl').forEach(a => a.addEventListener('click', () => openNote(a.dataset.note!)));
  });
  draw();
  return () => { alive = false; };
}
