import ELK from 'elkjs/lib/elk.bundled.js';
import { Lang, TreeView } from './models';
import { TreeGraph } from './tree-graph';
import { finishView, maleFirst, MARGIN } from './layout';

const elk = new ELK();
const EMPTY: TreeView = { nodes: [], wires: [], box: null, width: 0, height: 0, pos: {} };
const BOX = 130, COUPLE_W = 160 + BOX, L_OFF = BOX / 2, R_OFF = BOX / 2 + 160;

/**
 * ELK ('layered') computes positions; finishView then draws the same connectors/box as the custom engine.
 * Each marriage is merged into a single ELK node so partners stay together and parents connect to the couple
 * (not to individual spouses) - that's what keeps a couple's two parent-lines from crossing.
 */
export async function buildViewElk(graph: TreeGraph, pov: number, lang: Lang): Promise<TreeView> {
  const visible = graph.bloodAndSpouse(pov);
  const famSet = graph.immediateFamily(pov);
  const inV = (id: number) => visible.has(id);
  const vpeople = graph.data.people.filter(p => inV(p.id));
  if (!vpeople.length) return { ...EMPTY };

  // Greedily merge each marriage (whose partners aren't already taken) into one couple node.
  const nodeOf = new Map<number, string>();
  const coupleMembers = new Map<string, number[]>();
  let gid = 0;
  graph.data.marriages.forEach(m => {
    const a = m.partner1_id, b = m.partner2_id;
    if (!inV(a) || !inV(b) || nodeOf.has(a) || nodeOf.has(b)) return;
    const cid = 'c' + (gid++);
    nodeOf.set(a, cid); nodeOf.set(b, cid); coupleMembers.set(cid, [a, b]);
  });
  vpeople.forEach(p => { if (!nodeOf.has(p.id)) nodeOf.set(p.id, 'n' + p.id); });

  const nodeIds = [...new Set(nodeOf.values())];
  const children = nodeIds.map(id => ({ id, width: coupleMembers.has(id) ? COUPLE_W : BOX, height: BOX }));
  const seen = new Set<string>();
  const edges: { id: string; sources: string[]; targets: string[] }[] = [];
  graph.data.parentChild.forEach((r, i) => {
    if (!inV(r.parent_id) || !inV(r.child_id)) return;
    const s = nodeOf.get(r.parent_id)!, t = nodeOf.get(r.child_id)!, key = s + '>' + t;
    if (s !== t && !seen.has(key)) { seen.add(key); edges.push({ id: 'e' + i, sources: [s], targets: [t] }); }
  });

  let res;
  try {
    res = await elk.layout({
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered', 'elk.direction': 'DOWN',
        'elk.layered.spacing.nodeNodeBetweenLayers': '120', 'elk.spacing.nodeNode': '84',
        'elk.layered.spacing.edgeNodeBetweenLayers': '24', 'elk.spacing.edgeNode': '20',
        'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX', 'elk.layered.thoroughness': '40',
      },
      children, edges,
    });
  } catch { return { ...EMPTY }; }

  const nx: Record<string, number> = {}, ny: Record<string, number> = {}, nw: Record<string, number> = {};
  (res.children ?? []).forEach(c => { nx[c.id] = c.x ?? 0; ny[c.id] = c.y ?? 0; nw[c.id] = c.width ?? BOX; });
  const nodeCenter = (id: string) => nx[id] + nw[id] / 2;
  const parentAvgX = (id: number) => {
    const ps = graph.parents(id).filter(p => inV(p.id));
    return ps.length ? ps.reduce((a, p) => a + nodeCenter(nodeOf.get(p.id)!), 0) / ps.length : nodeCenter(nodeOf.get(id)!);
  };

  const pos: Record<number, { x: number; y: number }> = {};
  let maxX = 0, maxY = 0;
  nodeIds.forEach(id => {
    const members = coupleMembers.get(id), y = ny[id] + MARGIN;
    if (members) {
      const [a, b] = members;
      const byGender = maleFirst(graph, a, b);   // male on the left, female on the right; else each spouse toward their own parents
      const leftId = byGender ? byGender[0] : (parentAvgX(a) <= parentAvgX(b) ? a : b);
      const rightId = byGender ? byGender[1] : (leftId === a ? b : a);
      pos[leftId] = { x: nx[id] + L_OFF + MARGIN, y };
      pos[rightId] = { x: nx[id] + R_OFF + MARGIN, y };
    } else {
      pos[+id.slice(1)] = { x: nx[id] + nw[id] / 2 + MARGIN, y };
    }
    maxX = Math.max(maxX, nx[id] + nw[id]); maxY = Math.max(maxY, ny[id] + BOX);
  });
  const width = maxX + MARGIN * 2, height = maxY + MARGIN * 2 + 120;
  return finishView(graph, pov, lang, pos, famSet, width, height);
}
