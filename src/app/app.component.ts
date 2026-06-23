import {
  AfterViewInit, Component, ElementRef, HostListener, OnInit, ViewChild,
  ViewEncapsulation, computed, effect, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from './data/data.service';
import { TreeGraph } from './core/tree-graph';
import { buildView, connectionSegment, AV, NODE_W } from './core/layout';
import { buildViewElk } from './core/layout-elk';
import { Lang, Person, TreeView, Wire } from './core/models';
import { dispName } from './core/translit';
import { tr } from './core/i18n';

type Relation = 'spouse' | 'child';
type FormMode =
  | { type: 'add'; relation: Relation; anchor: number }
  | { type: 'addRoot' }
  | { type: 'edit'; id: number }
  | null;

const USE_ELK = false;   // flip to true to use the elkjs layout engine
const EMPTY_VIEW: TreeView = { nodes: [], wires: [], box: null, width: 0, height: 0, pos: {} };

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  encapsulation: ViewEncapsulation.None,
})
export class AppComponent implements OnInit, AfterViewInit {
  @ViewChild('stage') stageRef!: ElementRef<HTMLDivElement>;

  readonly AV = AV; readonly NODE_W = NODE_W;
  private nameCtx = (typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null);
  /** Exact rendered width of a name capsule, so the layout spaces nodes by their real size (not a fixed guess). */
  private measureName = (label: string): number => {
    const ctx = this.nameCtx;
    if (!ctx) return label.length * 8 + 26;
    ctx.font = '500 13.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans Telugu", sans-serif';
    return ctx.measureText(label).width + 24;   // + capsule horizontal padding
  };
  lang = signal<Lang>('en');
  pov = signal<number>(1);
  scale = signal(1); panX = signal(0); panY = signal(0);

  formOpen = signal(false);
  formMode = signal<FormMode>(null);
  fFirst = signal('');
  fLast = signal('');
  addExisting = signal(false);
  linkQuery = signal('');
  coParent = signal<number | null>(null);
  fPhoto = signal<string | null>(null);
  fGender = signal<'male' | 'female' | null>(null);
  delArmed = signal(false);
  povOpen = signal(false);
  povQuery = signal('');
  connOpen = signal(false);
  connA = signal<number | null>(null);
  connB = signal<number | null>(null);
  connPick = signal<'a' | 'b' | null>(null);
  connQuery = signal('');
  highlight = signal<number | null>(null);

  graph = computed(() => new TreeGraph(this.svc.data()));
  view = signal<TreeView>(EMPTY_VIEW);
  transform = computed(() => `translate(${this.panX()}px, ${this.panY()}px) scale(${this.scale()})`);
  isAdd = computed(() => this.formMode()?.type === 'add');
  isRoot = computed(() => this.formMode()?.type === 'addRoot');
  isEdit = computed(() => this.formMode()?.type === 'edit');
  editId = computed(() => { const m = this.formMode(); return m && m.type === 'edit' ? m.id : -1; });
  addRelation = computed<Relation>(() => { const m = this.formMode(); return m && m.type === 'add' ? m.relation : 'child'; });
  addAnchor = computed(() => { const m = this.formMode(); return m && m.type === 'add' ? m.anchor : -1; });
  povList = computed(() => this.matchSort(this.svc.data().people, this.povQuery().toLowerCase()));
  // People eligible to link into the current add slot. Spouse: anyone but self/existing spouses (loops ok).
  // Child: exclude self + the anchor's ancestors, so a parent-child link can never form a cycle.
  linkCandidates = computed(() => {
    const m = this.formMode(); if (!m || m.type !== 'add') return [];
    const g = this.graph(); const exclude = new Set<number>([m.anchor]);
    if (m.relation === 'spouse') g.spouses(m.anchor).forEach(s => exclude.add(s.id));
    else { g.ancestors(m.anchor).forEach(a => exclude.add(a)); g.children(m.anchor).forEach(c => exclude.add(c.id)); }
    return this.matchSort(this.svc.data().people.filter(p => !exclude.has(p.id)), this.linkQuery().toLowerCase());
  });
  // The anchor's spouses, offered as the optional second parent when adding a child.
  anchorSpouses = computed(() => {
    const m = this.formMode();
    return m && m.type === 'add' && m.relation === 'child' ? this.graph().spouses(m.anchor) : [];
  });
  connCandidates = computed(() => this.connPick() ? this.matchSort(this.svc.data().people, this.connQuery().toLowerCase()) : []);
  connPaths = computed(() => {
    const a = this.connA(), b = this.connB();
    return a != null && b != null ? this.graph().connectionPaths(a, b) : [];
  });
  /** The connecting people laid out as a small tree segment for the connection panel. */
  connSeg = computed(() => connectionSegment(this.graph(), this.connPaths()));
  /** The hovered person's whole branch: their ancestors, descendants, self and spouse(s). */
  branchSet = computed(() => {
    const h = this.highlight();
    if (h == null) return new Set<number>();
    const g = this.graph();
    const s = new Set<number>([h, ...g.ancestors(h), ...g.descendants(h)]);
    g.spouses(h).forEach(sp => s.add(sp.id));
    return s;
  });
  /** Whether a connector is on the bloodline trace. A child link (drop/bus/vertical) lights only when the child
   *  AND one of its parents are in the branch - so an in-law co-parent (or the POV's spouse's own parents) never
   *  leaves a floating, disconnected line. A marriage lights when both partners are in the branch, or one is and
   *  the couple has a branch child (needed to reach a grandchild). */
  wireHi(w: Wire): boolean {
    if (this.highlight() == null) return false;
    const B = this.branchSet();
    if (w.kind === 'mar') {
      const a = w.ids![0], b = w.ids![1];
      return (B.has(a) || B.has(b)) && ((B.has(a) && B.has(b)) || this.coupleHasBranchChild(a, b, B));
    }
    if (w.kind === 'drop') return (w.kids ?? []).some(k => B.has(k)) && (w.pars ?? []).some(p => B.has(p));
    if (w.kind === 'bus' || w.kind === 'kid') return w.kid != null && B.has(w.kid) && (w.pars ?? []).some(p => B.has(p));
    return false;
  }
  private coupleHasBranchChild(a: number, b: number, B: Set<number>): boolean {
    const g = this.graph();
    return g.children(a).some(c => B.has(c.id) && g.parents(c.id).some(p => p.id === b));
  }
  /** Case-insensitive name search + first-name sort, shared by the viewpoint and link pickers. */
  private matchSort(people: Person[], q: string): Person[] {
    return people
      .filter(p => `${p.first_name} ${p.last_name ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => dispName(a.first_name, this.lang()).localeCompare(dispName(b.first_name, this.lang())));
  }

  private dragging = false; private sx = 0; private sy = 0; private opx = 0; private opy = 0; private pinch = 0;
  private clickTimer: ReturnType<typeof setTimeout> | null = null;
  private palettes = [
    ['#5e9eff', '#3d82f0'], ['#34c759', '#28a64a'], ['#ff9f0a', '#f08800'], ['#ff476f', '#e82f59'],
    ['#af52de', '#9a3fc8'], ['#30bcd6', '#1fa7c0'], ['#ff7a5a', '#f25c3a'], ['#7d8a9c', '#69768a'],
  ];

  constructor(public svc: DataService) {
    effect(() => {
      const g = this.graph(), p = this.pov(), l = this.lang();
      const apply = (v: TreeView) => { this.view.set(v); this.maybeInitialFit(); };
      if (USE_ELK) buildViewElk(g, p, l).then(apply).catch(() => apply(buildView(g, p, l, this.measureName)));
      else apply(buildView(g, p, l, this.measureName));
    });
  }
  private fitted = false;
  private maybeInitialFit(): void {
    if (this.fitted || !this.stageRef || !this.view().nodes.length) return;
    this.fitted = true;
    setTimeout(() => this.fitView(1.95), 0);   // initial load starts ~95% more zoomed-in than fit-to-screen (1.3 x 1.5)
  }

  async ngOnInit(): Promise<void> {
    document.body.classList.toggle('te', this.lang() === 'te');
    await this.svc.load();
    const people = this.svc.data().people;
    const valid = (id: number | null) => id != null && people.some(p => p.id === id);
    let saved: number | null = null;
    try { const s = localStorage.getItem('ft_pov'); saved = s != null ? +s : null; } catch { saved = null; }
    const def = this.svc.defaultPovId();
    if (valid(saved)) this.pov.set(saved!);            // keep the viewpoint the user last selected
    else if (valid(def)) this.pov.set(def!);           // else the starred default
    else if (people.length && !valid(this.pov())) this.pov.set(people[0].id);
  }
  ngAfterViewInit(): void {
    const el = this.stageRef.nativeElement;
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('touchmove', this.onTouchMove, { passive: false });
    setTimeout(() => this.fitView(1.95), 0);   // initial load starts ~95% more zoomed-in than fit-to-screen (1.3 x 1.5)
  }

  t(k: string): string { return tr(k, this.lang()); }
  byId(id: number): Person | undefined { return this.graph().byId(id); }
  nameOf(id: number): string { const p = this.byId(id); return p ? dispName(p.first_name, this.lang()) : ''; }
  lastNameOf(id: number): string { const p = this.byId(id); return p?.last_name ? dispName(p.last_name, this.lang()) : ''; }
  photoOf(id: number): string | null { return this.byId(id)?.photo_url ?? null; }
  round(n: number): number { return Math.round(n); }
  grad(id: number): string {
    let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const [a, b] = this.palettes[h % this.palettes.length];
    return `linear-gradient(135deg,${a},${b})`;
  }
  /** Canvas avatar colour by role: POV dark silver, family lighter blue, extended neutral. */
  avatarBg(cls: string): string {
    if (cls === 'pov') return 'linear-gradient(150deg,#5f6675 0%,#41454f 55%,#2c2f37 100%)';
    if (cls === 'main') return 'linear-gradient(160deg,#2b7de4,#1657b8)';
    return 'linear-gradient(160deg,#737c8f,#565d6e)';
  }
  parentsOf(id: number) { return this.graph().parents(id); }
  spousesOf(id: number) { return this.graph().spouses(id); }
  childrenOf(id: number) { return this.graph().children(id); }
  relWord(rel: Relation): string { return this.t(rel === 'spouse' ? 'spouseLabel' : 'childLabel'); }

  setPov(id: number): void { this.pov.set(id); try { localStorage.setItem('ft_pov', String(id)); } catch { /* storage unavailable */ } setTimeout(() => this.centerOn(id), 0); }
  onNodeClick(id: number): void { if (this.clickTimer) clearTimeout(this.clickTimer); this.clickTimer = setTimeout(() => this.setPov(id), 220); }
  onNodeDbl(id: number): void { if (this.clickTimer) clearTimeout(this.clickTimer); if (this.svc.canEdit()) this.openEdit(id); }

  onStageMouseDown(e: MouseEvent): void {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.node')) return;
    this.dragging = true; this.sx = e.clientX; this.sy = e.clientY; this.opx = this.panX(); this.opy = this.panY();
    this.stageRef.nativeElement.classList.add('grabbing');
  }
  @HostListener('window:mousemove', ['$event']) onMove(e: MouseEvent): void {
    if (!this.dragging) return;
    this.panX.set(this.opx + (e.clientX - this.sx)); this.panY.set(this.opy + (e.clientY - this.sy));
  }
  @HostListener('window:mouseup') onUp(): void { this.dragging = false; this.stageRef?.nativeElement.classList.remove('grabbing'); }
  @HostListener('window:keydown.escape') onEsc(): void { this.formOpen.set(false); this.povOpen.set(false); this.closeConn(); }

  onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (e.ctrlKey) this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));   // pinch (fingers toward/away) -> zoom at the cursor
    else { this.panX.update(x => x - e.deltaX); this.panY.update(y => y - e.deltaY); }   // two-finger swipe -> pan
  };
  onTouchStart(e: TouchEvent): void {
    if ((e.target as HTMLElement).closest('.node')) return;
    if (e.touches.length === 1) { this.dragging = true; this.sx = e.touches[0].clientX; this.sy = e.touches[0].clientY; this.opx = this.panX(); this.opy = this.panY(); }
    else if (e.touches.length === 2) { this.dragging = false; this.pinch = this.dist(e); }
  }
  onTouchMove = (e: TouchEvent): void => {
    if (e.touches.length === 1 && this.dragging) { this.panX.set(this.opx + (e.touches[0].clientX - this.sx)); this.panY.set(this.opy + (e.touches[0].clientY - this.sy)); e.preventDefault(); }
    else if (e.touches.length === 2) { const d = this.dist(e); const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2, my = (e.touches[0].clientY + e.touches[1].clientY) / 2; if (this.pinch) this.zoomAt(mx, my, d / this.pinch); this.pinch = d; e.preventDefault(); }
  };
  onTouchEnd(): void { this.dragging = false; }
  private dist(e: TouchEvent): number { return Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); }

  zoomAt(clientX: number, clientY: number, factor: number): void {
    const st = this.stageRef.nativeElement.getBoundingClientRect();
    const mx = clientX - st.left, my = clientY - st.top;
    const old = this.scale();
    const ns = Math.max(0.25, Math.min(old * factor, 2.6));
    this.panX.set(mx - (mx - this.panX()) * (ns / old));
    this.panY.set(my - (my - this.panY()) * (ns / old));
    this.scale.set(ns);
  }
  zoomBtn(f: number): void { const st = this.stageRef.nativeElement.getBoundingClientRect(); this.zoomAt(st.left + st.width / 2, st.top + st.height / 2, f); }
  fitView(zoom = 1): void {
    const st = this.stageRef?.nativeElement; if (!st) return;
    const v = this.view(); if (!v.width || !v.height) return;
    const fit = Math.min(st.clientWidth / v.width, st.clientHeight / v.height) * 0.92;
    const s = Math.max(0.25, Math.min(fit, 1.1) * zoom);   // zoom=1 fits to screen; initial load passes 1.3 to start 30% closer
    this.scale.set(s);
    this.panX.set((st.clientWidth - v.width * s) / 2);
    this.panY.set((st.clientHeight - v.height * s) / 2);
  }
  centerOn(id: number): void {
    const st = this.stageRef?.nativeElement; if (!st) return;
    const p = this.view().pos[id]; if (!p) return;
    const sc = this.scale();
    this.panX.set(st.clientWidth / 2 - p.x * sc);
    this.panY.set(st.clientHeight / 2 - (p.y + AV / 2) * sc);
  }

  addPersonBtn(): void { this.openAddRoot(); }
  openAddRoot(): void { if (!this.svc.canEdit()) return; this.formMode.set({ type: 'addRoot' }); this.fFirst.set(''); this.fLast.set(''); this.fPhoto.set(null); this.fGender.set(null); this.delArmed.set(false); this.formOpen.set(true); }
  openAdd(relation: Relation, anchorId: number): void {
    if (!this.svc.canEdit()) return;
    this.formMode.set({ type: 'add', relation, anchor: anchorId });
    this.fFirst.set(''); this.fLast.set(''); this.fPhoto.set(null); this.fGender.set(null); this.addExisting.set(false); this.linkQuery.set('');
    const sp = relation === 'child' ? this.graph().spouses(anchorId) : [];
    this.coParent.set(sp.length === 1 ? sp[0].id : null);   // default to the sole spouse, but editable
    this.delArmed.set(false); this.formOpen.set(true);
  }
  openEdit(id: number): void { this.formMode.set({ type: 'edit', id }); const p = this.byId(id); this.fFirst.set(p?.first_name ?? ''); this.fLast.set(p?.last_name ?? ''); this.fPhoto.set(p?.photo_url ?? null); this.fGender.set(p?.gender ?? null); this.delArmed.set(false); this.formOpen.set(true); }
  closeForm(): void { this.formOpen.set(false); this.formMode.set(null); }
  onScrim(e: MouseEvent, which: 'form' | 'pov' | 'conn'): void {
    if (e.target !== e.currentTarget) return;
    if (which === 'form') this.closeForm();
    else if (which === 'pov') this.povOpen.set(false);
    else this.closeConn();
  }

  async save(): Promise<void> {
    const first = this.fFirst().trim(); if (!first || !this.fGender()) return;
    const last = this.fLast().trim() || null;
    const m = this.formMode(); if (!m) return;
    if (m.type === 'edit') { await this.svc.rename(m.id, first, last, this.fPhoto(), this.fGender()); this.closeForm(); return; }
    if (m.type === 'addRoot') { this.closeForm(); const id = await this.svc.addPerson(first, last, this.fGender()); if (id > 0) this.setPov(id); return; }
    await this.svc.addRelative(m.relation, m.anchor, first, last, this.coParent(), this.fGender());
    this.closeForm();
  }
  async confirmDelete(): Promise<void> {
    const m = this.formMode(); if (!m || m.type !== 'edit') return;
    if (!this.delArmed()) { this.delArmed.set(true); setTimeout(() => this.delArmed.set(false), 3000); return; }
    const id = m.id; this.closeForm(); await this.svc.deletePerson(id);
    if (this.pov() === id) this.pov.set(this.svc.data().people[0]?.id ?? 1);
  }
  quickAdd(relation: Relation): void { const m = this.formMode(); if (!m || m.type !== 'edit') return; const id = m.id; this.closeForm(); this.openAdd(relation, id); }
  async pickExisting(personId: number): Promise<void> {
    const m = this.formMode(); if (!m || m.type !== 'add') return;
    this.closeForm();
    if (m.relation === 'spouse') await this.svc.linkSpouse(m.anchor, personId);
    else await this.svc.linkChild(m.anchor, personId, this.coParent());
  }
  async unlinkParent(pId: number, id: number): Promise<void> { await this.svc.removeParentChild(pId, id); }
  async unlinkChild(id: number, cId: number): Promise<void> { await this.svc.removeParentChild(id, cId); }
  async unlinkSpouse(id: number, sId: number): Promise<void> { await this.svc.removeMarriage(id, sId); }

  openPov(): void { this.povQuery.set(''); this.povOpen.set(true); }
  pickPov(id: number): void { this.povOpen.set(false); this.setPov(id); }
  async setDefaultPov(id: number): Promise<void> { await this.svc.setDefaultPov(id); }
  /** The starred viewpoint: the explicitly-set default, else the first-created person. */
  isDefaultPov(id: number): boolean { const d = this.svc.defaultPovId(); return (d != null ? d : this.svc.data().people[0]?.id) === id; }

  openConn(): void { this.connOpen.set(true); this.connA.set(null); this.connB.set(null); this.connPick.set('a'); this.connQuery.set(''); }
  closeConn(): void { this.connOpen.set(false); this.connPick.set(null); }
  startConnPick(slot: 'a' | 'b'): void { this.connPick.set(slot); this.connQuery.set(''); }
  pickConn(id: number): void { (this.connPick() === 'a' ? this.connA : this.connB).set(id); this.connPick.set(null); this.connQuery.set(''); }
  /** Relationship word for `to` as seen from `from` (gendered when known). */
  linkLabel(from: number, to: number): string {
    const g = this.graph();
    if (g.parents(from).some(p => p.id === to)) return this.gw(to, 'father', 'mother', 'parentRel');
    if (g.children(from).some(c => c.id === to)) return this.gw(to, 'son', 'daughter', 'childRel');
    if (g.spouses(from).some(s => s.id === to)) return this.gw(to, 'husband', 'wife', 'spouseRel');
    return '';
  }
  private gw(id: number, male: string, female: string, neutral: string): string {
    const gn = this.byId(id)?.gender;
    return this.t(gn === 'male' ? male : gn === 'female' ? female : neutral);
  }
  switchLang(l: Lang): void { this.lang.set(l); document.body.classList.toggle('te', l === 'te'); setTimeout(() => this.centerOn(this.pov()), 0); }

  async signInGoogle(): Promise<void> { await this.svc.signInWithGoogle(); }
  async signOut(): Promise<void> { await this.svc.signOut(); }
}
