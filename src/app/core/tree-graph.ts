import { Person, TreeData } from './models';

export class TreeGraph {
  private pById = new Map<number, Person>();
  constructor(public data: TreeData) { data.people.forEach(p => this.pById.set(p.id, p)); }

  byId(id: number): Person | undefined { return this.pById.get(id); }

  parents(id: number): Person[] {
    return this.data.parentChild.filter(r => r.child_id === id).map(r => this.byId(r.parent_id)).filter((p): p is Person => !!p);
  }
  children(id: number): Person[] {
    return this.data.parentChild.filter(r => r.parent_id === id).map(r => this.byId(r.child_id)).filter((p): p is Person => !!p);
  }
  spouses(id: number): Person[] {
    return this.data.marriages.filter(m => m.partner1_id === id || m.partner2_id === id)
      .map(m => this.byId(m.partner1_id === id ? m.partner2_id : m.partner1_id)).filter((p): p is Person => !!p);
  }
  siblings(id: number): { person: Person; full: boolean }[] {
    const mine = new Set(this.data.parentChild.filter(r => r.child_id === id).map(r => r.parent_id));
    if (!mine.size) return [];
    const out: { person: Person; full: boolean }[] = [];
    for (const p of this.data.people) {
      if (p.id === id) continue;
      const theirs = this.data.parentChild.filter(r => r.child_id === p.id).map(r => r.parent_id);
      const shared = theirs.filter(x => mine.has(x)).length;
      if (shared > 0) out.push({ person: p, full: shared >= 2 });
    }
    return out;
  }
  connectionPaths(aId: number, bId: number): number[][] {
    if (aId === bId) return [[aId]];
    const neighbors = (id: number): number[] => {
      const out: number[] = [];
      this.parents(id).forEach(p => out.push(p.id));
      this.children(id).forEach(c => out.push(c.id));
      this.spouses(id).forEach(s => out.push(s.id));
      return out;
    };
    const dist = new Map<number, number>([[aId, 0]]);
    const preds = new Map<number, number[]>();
    const q: number[] = [aId];
    while (q.length) {
      const u = q.shift()!; const du = dist.get(u)!;
      for (const v of neighbors(u)) {
        if (!dist.has(v)) { dist.set(v, du + 1); preds.set(v, [u]); q.push(v); }
        else if (dist.get(v) === du + 1) { preds.get(v)!.push(u); }
      }
    }
    if (!dist.has(bId)) return [];
    const paths: number[][] = [];
    const build = (node: number, acc: number[]) => {
      if (paths.length >= 12) return;
      if (node === aId) { paths.push([aId, ...acc]); return; }
      (preds.get(node) ?? []).forEach(p => build(p, [node, ...acc]));
    };
    build(bId, []);
    return paths;
  }
  ancestors(id: number): Set<number> {
    const out = new Set<number>();
    const up = (x: number) => this.parents(x).forEach(p => { if (!out.has(p.id)) { out.add(p.id); up(p.id); } });
    up(id);
    return out;
  }
  descendants(id: number): Set<number> {
    const out = new Set<number>();
    const down = (x: number) => this.children(x).forEach(c => { if (!out.has(c.id)) { out.add(c.id); down(c.id); } });
    down(id);
    return out;
  }
  bloodAndSpouse(povId: number): Set<number> {
    const anc = new Set<number>([povId]);
    const up = (id: number, depth: number) => {
      if (depth >= 4) return;
      this.parents(id).forEach(p => { if (!anc.has(p.id)) { anc.add(p.id); up(p.id, depth + 1); } });
    };
    up(povId, 0);
    const blood = new Set<number>();
    const down = (id: number) => { if (blood.has(id)) return; blood.add(id); this.children(id).forEach(c => down(c.id)); };
    anc.forEach(a => down(a));
    [...blood].forEach(id => this.spouses(id).forEach(s => blood.add(s.id)));
    this.spouses(povId).forEach(s => this.parents(s.id).forEach(pp => blood.add(pp.id)));
    return blood;
  }
  immediateFamily(id: number): Set<number> {
    const set = new Set<number>([id]);
    if (this.spouses(id).length) {
      this.spouses(id).forEach(s => set.add(s.id));
      this.children(id).forEach(c => set.add(c.id));
    } else {
      this.parents(id).forEach(p => set.add(p.id));
      this.siblings(id).forEach(s => set.add(s.person.id));
    }
    return set;
  }
}
