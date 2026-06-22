import { Lang, PositionedNode, Wire, BoxRect, TreeView, NodeClass } from './models';
import { TreeGraph } from './tree-graph';
import { dispName, initialsOf } from './translit';

export const NODE_W = 110, AV = 78, S_EXT = 78, S_MAIN = 94, S_POV = 94, FAM_GAP = 66, COL = 160, ROW = 220, MARGIN = 110, IN_LAW_GAP = 110;

interface Anchor { cx: number; top: number; bottom: number; cy: number; left: number; right: number; }

/** Order a married pair male-on-left, female-on-right. Returns null when gender doesn't decide it. */
export function maleFirst(graph: TreeGraph, a: number, b: number): [number, number] | null {
  const ga = graph.byId(a)?.gender, gb = graph.byId(b)?.gender;
  if (ga === 'male' && gb === 'female') return [a, b];
  if (ga === 'female' && gb === 'male') return [b, a];
  return null;
}

/**
 * Gender-pedigree order key in [0,1] for every visible person: each person's father-lineage is placed to the
 * LEFT and mother-lineage to the RIGHT, applied recursively from the POV couple (male partner on the left).
 * People who aren't blood ancestors (descendants, siblings, in-laws) settle to the mean of their relatives.
 * This only decides left-to-right ORDER; exact spacing still comes from the barycentre sweep.
 */
function genderOrder(graph: TreeGraph, pov: number, inV: (id: number) => boolean): Record<number, number> {
  const ord: Record<number, number> = {};
  const fixed = new Set<number>();
  const parentsOf = (id: number) => graph.parents(id).filter(p => inV(p.id));
  const assignUp = (id: number, lo: number, hi: number) => {
    if (fixed.has(id)) return;
    fixed.add(id); ord[id] = (lo + hi) / 2;
    const ps = parentsOf(id);
    let fa = ps.find(p => graph.byId(p.id)?.gender === 'male') ?? null;
    let mo = ps.find(p => graph.byId(p.id)?.gender === 'female') ?? null;
    if (!fa && !mo) { fa = ps[0] ?? null; mo = ps[1] ?? null; }                  // genders unknown: deterministic by order
    else if (fa && !mo) mo = ps.find(p => p.id !== fa!.id) ?? null;             // pair a known father with the other parent
    else if (mo && !fa) fa = ps.find(p => p.id !== mo!.id) ?? null;
    const m = (lo + hi) / 2;
    if (fa && mo) { assignUp(fa.id, lo, m); assignUp(mo.id, m, hi); }           // father lineage left, mother lineage right
    else if (fa) assignUp(fa.id, lo, hi);
    else if (mo) assignUp(mo.id, lo, hi);
  };
  const sps = graph.spouses(pov).filter(s => inV(s.id));
  if (sps.length === 1) {
    const pair = maleFirst(graph, pov, sps[0].id) ?? [pov, sps[0].id];          // male partner takes the left half
    assignUp(pair[0], 0, 0.5); assignUp(pair[1], 0.5, 1);
  } else {
    assignUp(pov, 0, 1);
  }
  const others = graph.data.people.filter(p => inV(p.id) && !fixed.has(p.id)).map(p => p.id);
  others.forEach(id => { ord[id] = 0.5; });
  for (let it = 0; it < 40; it++) {                                            // pull non-ancestors to the mean of their assigned relatives
    others.forEach(id => {
      const nb: number[] = [];
      graph.parents(id).forEach(p => { if (inV(p.id)) nb.push(ord[p.id]); });
      graph.children(id).forEach(c => { if (inV(c.id)) nb.push(ord[c.id]); });
      graph.spouses(id).forEach(s => { if (inV(s.id)) nb.push(ord[s.id]); });
      if (nb.length) ord[id] = nb.reduce((a, b) => a + b, 0) / nb.length;
    });
  }
  return ord;
}

/** Pure layout: turns the graph + viewpoint into positioned nodes, connector wires and the immediate-family box. */
export function buildView(graph: TreeGraph, pov: number, lang: Lang): TreeView {
  const people = graph.data.people;
  const visible = graph.bloodAndSpouse(pov);
  const famSet = graph.immediateFamily(pov);
  const inV = (id: number) => visible.has(id);
  const P = (id: number) => graph.parents(id).filter(p => inV(p.id));
  const C = (id: number) => graph.children(id).filter(c => inV(c.id));
  const S = (id: number) => graph.spouses(id).filter(s => inV(s.id));
  const vpeople = people.filter(p => inV(p.id));
  const ord = genderOrder(graph, pov, inV);   // male lineages sort left, female lineages right (recursive)

  const lvl: Record<number, number> = {}; const seen = new Set<number>();
  const bfs = (start: number) => {
    const q = [start]; seen.add(start); lvl[start] = 0;
    while (q.length) {
      const id = q.shift()!;
      S(id).forEach(s => { if (!seen.has(s.id)) { seen.add(s.id); lvl[s.id] = lvl[id]; q.push(s.id); } });
      P(id).forEach(p => { if (!seen.has(p.id)) { seen.add(p.id); lvl[p.id] = lvl[id] - 1; q.push(p.id); } });
      C(id).forEach(c => { if (!seen.has(c.id)) { seen.add(c.id); lvl[c.id] = lvl[id] + 1; q.push(c.id); } });
    }
  };
  vpeople.forEach(p => { if (!seen.has(p.id)) bfs(p.id); });

  const vals = Object.values(lvl); const minL = vals.length ? Math.min(...vals) : 0;
  Object.keys(lvl).forEach(k => lvl[+k] -= minL);
  const maxL = vals.length ? Math.max(...Object.values(lvl)) : 0;

  const rows: number[][] = []; for (let i = 0; i <= maxL; i++) rows[i] = [];
  vpeople.forEach(p => { if (lvl[p.id] != null) rows[lvl[p.id]].push(p.id); });

  const x: Record<number, number> = {};
  rows.forEach(row => row.forEach((id, i) => x[id] = i * COL));

  const placeRow = (ri: number) => {
    const row = rows[ri]; if (!row.length) return;
    const dx: Record<number, number> = {}; const pax: Record<number, number | null> = {};
    row.forEach(id => {
      const n: number[] = [];
      P(id).forEach(p => { if (x[p.id] != null) n.push(x[p.id]); });
      C(id).forEach(c => { if (x[c.id] != null) n.push(x[c.id]); });
      S(id).forEach(s => { if (x[s.id] != null && lvl[s.id] === ri) n.push(x[s.id]); });
      dx[id] = n.length ? n.reduce((a, b) => a + b, 0) / n.length : x[id];
      const pv = P(id).map(p => x[p.id]).filter(v => v != null);
      pax[id] = pv.length ? pv.reduce((a, b) => a + b, 0) / pv.length : null;
    });
    const used = new Set<number>(); const units: { m: number[]; d: number; ord: number }[] = [];
    row.forEach(id => {
      if (used.has(id)) return;
      const sps = S(id).filter(s => lvl[s.id] === ri && !used.has(s.id));
      used.add(id);
      let m: number[];
      if (!sps.length) m = [id];
      else if (sps.length === 1) {
        const sp = sps[0].id; used.add(sp);
        const byGender = maleFirst(graph, id, sp);
        if (byGender) m = byGender;   // male on the left, female on the right
        else {
          const idFam = famSet.has(id), spFam = famSet.has(sp);
          if (idFam !== spFam) {   // a nuclear child paired with their in-law: keep the child toward its parents, push the in-law to the outer edge
            const kid = idFam ? id : sp, inlaw = idFam ? sp : id;
            const c = pax[kid] != null ? pax[kid]! : dx[kid];
            m = c >= (dx[id] + dx[sp]) / 2 ? [inlaw, kid] : [kid, inlaw];
          } else {
            m = dx[id] <= dx[sp] ? [id, sp] : [sp, id];
          }
        }
      }
      else {
        sps.forEach(s => used.add(s.id));
        const sorted = sps.map(s => s.id).sort((a, b) => dx[a] - dx[b]);
        const mid = Math.ceil(sorted.length / 2);
        m = [...sorted.slice(0, mid), id, ...sorted.slice(mid)];   // hub centered among its spouses
      }
      const dv = m.map(x => dx[x]); const ov = m.map(id => ord[id] ?? 0.5);
      units.push({ m, d: dv.reduce((a, b) => a + b, 0) / dv.length, ord: ov.reduce((a, b) => a + b, 0) / ov.length });
    });
    units.sort((a, b) => (a.ord - b.ord) || (a.d - b.d));   // gender pedigree decides order (male lineages left, female right); barycentre only fine-tunes spacing
    let cursor = -Infinity; let prevFam: boolean | null = null; const placed: [number, number][] = [];
    units.forEach(u => {
      const uFam = u.m.some(id => famSet.has(id));
      const gap = (prevFam !== null && uFam !== prevFam) ? COL + FAM_GAP : COL;
      const off: number[] = [0];
      for (let i = 1; i < u.m.length; i++) {
        const wide = famSet.has(u.m[i - 1]) !== famSet.has(u.m[i]);   // nuclear member meets an in-law: widen so the in-law clears the box
        off.push(off[i - 1] + (wide ? COL + IN_LAW_GAP : COL));
      }
      const w = off[off.length - 1];
      let start = u.d - w / 2;
      if (start < cursor + gap) start = cursor + gap;
      u.m.forEach((id, i) => placed.push([id, start + off[i]]));
      cursor = start + w; prevFam = uFam;
    });
    const meanD = units.reduce((a, u) => a + u.d * u.m.length, 0) / row.length;
    const meanP = placed.reduce((a, p) => a + p[1], 0) / placed.length;
    const shift = meanD - meanP;
    placed.forEach(([id, px]) => x[id] = px + shift);
  };
  for (let sweep = 0; sweep < 18; sweep++) {
    const idxs = [...rows.keys()]; if (sweep % 2) idxs.reverse();
    for (const ri of idxs) placeRow(ri);
  }
  for (let ri = 0; ri < rows.length; ri++) placeRow(ri);   // final top-down pass: children settle under their parents' midpoint (straight drops)

  let minX = Infinity, maxX = -Infinity;
  vpeople.forEach(p => { if (lvl[p.id] == null) return; minX = Math.min(minX, x[p.id]); maxX = Math.max(maxX, x[p.id]); });
  if (!isFinite(minX)) { minX = 0; maxX = 0; }
  const pos: Record<number, { x: number; y: number }> = {};
  vpeople.forEach(p => { if (lvl[p.id] == null) return; pos[p.id] = { x: x[p.id] - minX + MARGIN, y: lvl[p.id] * ROW + MARGIN }; });
  const width = (maxX - minX) + MARGIN * 2 + NODE_W, height = maxL * ROW + MARGIN * 2 + 120;

  return finishView(graph, pov, lang, pos, famSet, width, height);
}

/** Build nodes, connector wires and the immediate-family box from final positions. Shared by the custom and ELK layouts. */
export function finishView(graph: TreeGraph, pov: number, lang: Lang, pos: Record<number, { x: number; y: number }>, famSet: Set<number>, width: number, height: number): TreeView {
  const avSize = (id: number) => id === pov ? S_POV : (famSet.has(id) ? S_MAIN : S_EXT);
  const anchor = (id: number): Anchor | null => {
    const p = pos[id]; if (!p) return null;
    const s = avSize(id), cy = p.y + AV / 2;
    return { cx: p.x, top: cy - s / 2, bottom: cy + s / 2, cy, left: p.x - s / 2, right: p.x + s / 2 };
  };

  const nodes: PositionedNode[] = [];
  graph.data.people.forEach(p => {
    const ps = pos[p.id]; if (!ps) return;
    const cls: NodeClass = p.id === pov ? 'pov' : (famSet.has(p.id) ? 'main' : 'ext');
    const first = dispName(p.first_name, lang);
    const full = p.last_name ? `${first} ${dispName(p.last_name, lang)}` : first;
    nodes.push({ id: p.id, x: ps.x, y: ps.y, size: avSize(p.id), cls, label: first, initials: initialsOf(full), photo: p.photo_url ?? null });
  });

  const wires: Wire[] = [];
  graph.data.marriages.forEach(m => {
    const A = anchor(m.partner1_id), B = anchor(m.partner2_id); if (!A || !B) return;
    const L = A.cx <= B.cx ? A : B, R = A.cx <= B.cx ? B : A;
    const main = (m.partner1_id === pov || m.partner2_id === pov);
    const mids = [m.partner1_id, m.partner2_id];
    if (Math.abs(L.cy - R.cy) < 1) {
      wires.push({ x1: L.right, y1: L.cy, x2: R.left, y2: R.cy, main, ids: mids });   // same generation: straight horizontal
    } else {
      const midX = (L.right + R.left) / 2;                                 // partners on different generations: orthogonal elbow, never a diagonal
      wires.push({ x1: L.right, y1: L.cy, x2: midX, y2: L.cy, main, ids: mids });
      wires.push({ x1: midX, y1: L.cy, x2: midX, y2: R.cy, main, ids: mids });
      wires.push({ x1: midX, y1: R.cy, x2: R.left, y2: R.cy, main, ids: mids });
    }
  });

  const kidPar: Record<number, number[]> = {};
  graph.data.parentChild.forEach(r => { if (pos[r.parent_id] && pos[r.child_id]) (kidPar[r.child_id] = kidPar[r.child_id] || []).push(r.parent_id); });
  const fams: Record<string, { pars: number[]; kids: number[] }> = {};
  Object.entries(kidPar).forEach(([ch, pars]) => { const key = [...pars].sort((a, b) => a - b).join('+'); (fams[key] = fams[key] || { pars, kids: [] }).kids.push(+ch); });
  interface Fam { pars: number[]; kids: number[]; px: number; py: number; kidTop: number; busY: number; dropTop: number; }
  const famArr: Fam[] = [];
  Object.values(fams).forEach(f => {
    const pa = f.pars.map(anchor).filter((a): a is Anchor => !!a);
    const ka = f.kids.map(anchor).filter((a): a is Anchor => !!a);
    if (!pa.length || !ka.length) return;
    const px = pa.reduce((a, c) => a + c.cx, 0) / pa.length;
    const py = Math.max(...pa.map(c => c.bottom));
    const kidTop = Math.min(...ka.map(c => c.top));
    const dropTop = pa.length >= 2 ? Math.min(...pa.map(c => c.cy)) : py;   // couples drop from the marriage line; a lone parent from its base
    famArr.push({ pars: f.pars, kids: f.kids, px, py, kidTop, busY: (py + kidTop) / 2, dropTop });
  });
  const bands: Record<string, Fam[]> = {};
  famArr.forEach(f => { const k = Math.round(f.py / 8) + '|' + Math.round(f.kidTop / 8); (bands[k] = bands[k] || []).push(f); });
  Object.values(bands).forEach(g => {
    if (g.length < 2) return;
    g.sort((a, b) => a.px - b.px);
    const top = Math.max(...g.map(f => f.py)), bot = Math.min(...g.map(f => f.kidTop));
    const mid = (top + bot) / 2, n = g.length;
    const step = Math.min(34, Math.max(0, (bot - top - 20)) / (n - 1));
    g.forEach((f, i) => f.busY = mid + (i - (n - 1) / 2) * step);
  });
  famArr.forEach(f => {
    const main = f.pars.includes(pov);
    wires.push({ x1: f.px, y1: f.dropTop, x2: f.px, y2: f.busY, main, ids: f.pars });   // drop from the couple down to the bus
    // Emit the horizontal bus as one stub per child (parents' centre -> child). The stubs overlap into the same
    // bus visually, but tagging each with its own child lets the branch-highlight trace only the children that
    // are ON the branch - the non-branch siblings' stubs stay dim, so no tail branches hang off the trace.
    f.kids.forEach(id => {
      const a = anchor(id)!;
      wires.push({ x1: f.px, y1: f.busY, x2: a.cx, y2: f.busY, main, ids: [...f.pars, id] });   // bus stub to this child
      wires.push({ x1: a.cx, y1: f.busY, x2: a.cx, y2: a.top, main, ids: [id] });                // child vertical
    });
  });

  let box: BoxRect | null = null;
  const fids = [...famSet].filter(id => pos[id]);
  if (fids.length >= 2) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    fids.forEach(id => { const a = anchor(id)!; x1 = Math.min(x1, a.left); x2 = Math.max(x2, a.right); y1 = Math.min(y1, a.top); y2 = Math.max(y2, a.bottom); });
    // anchor() bounds the avatar only; each node renders its name in an 8px-gap band below it
    // (up to two lines), so the bottom pad must clear that band - hence padBot >> padTop.
    const padX = 28, padTop = 22, padBot = 46;
    box = { x: x1 - padX, y: y1 - padTop, w: (x2 - x1) + padX * 2, h: (y2 - y1) + padTop + padBot };
  }

  return { nodes, wires, box, width, height, pos };
}
