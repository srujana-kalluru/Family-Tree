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
  /** MAIN family (POV-relative) = POV's spouse(s) + children. */
  isMain(personId: number, povId: number): boolean {
    return this.spouses(povId).some(s => s.id === personId) || this.children(povId).some(c => c.id === personId);
  }
  /** Blood relatives (ancestors + their descendants) + POV's spouse(s), spouse's parents and children's spouses. */
  bloodAndSpouse(povId: number): Set<number> {
    const anc = new Set<number>([povId]);
    const up = (id: number) => { this.parents(id).forEach(p => { if (!anc.has(p.id)) { anc.add(p.id); up(p.id); } }); };
    up(povId);
    const blood = new Set<number>();
    const down = (id: number) => { if (blood.has(id)) return; blood.add(id); this.children(id).forEach(c => down(c.id)); };
    anc.forEach(a => down(a));
    this.spouses(povId).forEach(s => { blood.add(s.id); this.parents(s.id).forEach(pp => blood.add(pp.id)); });
    this.children(povId).forEach(c => this.spouses(c.id).forEach(s => blood.add(s.id)));
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
