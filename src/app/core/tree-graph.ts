import { Person, TreeData } from './models';

/** Derives all higher relationships from the 3 base tables. */
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
  /** All ancestors of a person (cycle-safe). Used to forbid a parent-child link that would loop. */
  ancestors(id: number): Set<number> {
    const out = new Set<number>();
    const up = (x: number) => this.parents(x).forEach(p => { if (!out.has(p.id)) { out.add(p.id); up(p.id); } });
    up(id);
    return out;
  }
  /** Blood relatives up to grandparents + their descendants, every blood relative's spouse, and the POV's spouse's parents. */
  bloodAndSpouse(povId: number): Set<number> {
    const anc = new Set<number>([povId]);
    const up = (id: number, depth: number) => {
      if (depth >= 2) return;   // cap the ancestor line at grandparents (no great-grandparents and their branches)
      this.parents(id).forEach(p => { if (!anc.has(p.id)) { anc.add(p.id); up(p.id, depth + 1); } });
    };
    up(povId, 0);
    const blood = new Set<number>();
    const down = (id: number) => { if (blood.has(id)) return; blood.add(id); this.children(id).forEach(c => down(c.id)); };
    anc.forEach(a => down(a));
    // every blood relative's spouse joins as extended family (sibling-in-law, uncle's wife, child's spouse, POV's own spouse, ...)
    [...blood].forEach(id => this.spouses(id).forEach(s => blood.add(s.id)));
    // plus the POV's spouse's parents (the in-laws)
    this.spouses(povId).forEach(s => this.parents(s.id).forEach(pp => blood.add(pp.id)));
    return blood;
  }
  /** IMMEDIATE family: married -> spouse(s)+children; unmarried -> parents+siblings. POV included. */
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
