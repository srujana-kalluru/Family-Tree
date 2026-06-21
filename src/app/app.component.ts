import {
  AfterViewInit, Component, ElementRef, HostListener, OnInit, ViewChild,
  ViewEncapsulation, computed, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from './data/data.service';
import { TreeGraph } from './core/tree-graph';
import { buildView, AV, NODE_W } from './core/layout';
import { Lang, Person } from './core/models';
import { dispName } from './core/translit';
import { T } from './core/i18n';

type Relation = 'spouse' | 'child';
type FormMode =
  | { type: 'add'; relation: Relation; anchor: number }
  | { type: 'addRoot' }
  | { type: 'edit'; id: number }
  | null;

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
  lang = signal<Lang>('en');
  pov = signal<number>(1);
  scale = signal(1); panX = signal(0); panY = signal(0);

  formOpen = signal(false);
  formMode = signal<FormMode>(null);
  fFirst = signal('');
  fLast = signal('');
  addExisting = signal(false);
  linkQuery = signal('');
  delArmed = signal(false);
  povOpen = signal(false);
  povQuery = signal('');

  graph = computed(() => new TreeGraph(this.svc.data()));
  view = computed(() => buildView(this.graph(), this.pov(), this.lang()));
  transform = computed(() => `translate(${this.panX()}px, ${this.panY()}px) scale(${this.scale()})`);
  isAdd = computed(() => this.formMode()?.type === 'add');
  isRoot = computed(() => this.formMode()?.type === 'addRoot');
  isEdit = computed(() => this.formMode()?.type === 'edit');
  editId = computed(() => { const m = this.formMode(); return m && m.type === 'edit' ? m.id : -1; });
  addRelation = computed<Relation>(() => { const m = this.formMode(); return m && m.type === 'add' ? m.relation : 'child'; });
  addAnchor = computed(() => { const m = this.formMode(); return m && m.type === 'add' ? m.anchor : -1; });
  povList = computed(() => {
    const q = this.povQuery().toLowerCase();
    return this.svc.data().people
      .filter(p => `${p.first_name} ${p.last_name ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => dispName(a.first_name, this.lang()).localeCompare(dispName(b.first_name, this.lang())));
  });
  // People eligible to link into the current add slot. Spouse: anyone but self/existing spouses (loops ok).
  // Child: exclude self + the anchor's ancestors, so a parent-child link can never form a cycle.
  linkCandidates = computed(() => {
    const m = this.formMode(); if (!m || m.type !== 'add') return [];
    const g = this.graph(); const exclude = new Set<number>([m.anchor]);
    if (m.relation === 'spouse') g.spouses(m.anchor).forEach(s => exclude.add(s.id));
    else { g.ancestors(m.anchor).forEach(a => exclude.add(a)); g.children(m.anchor).forEach(c => exclude.add(c.id)); }
    const q = this.linkQuery().toLowerCase();
    return this.svc.data().people
      .filter(p => !exclude.has(p.id) && `${p.first_name} ${p.last_name ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => dispName(a.first_name, this.lang()).localeCompare(dispName(b.first_name, this.lang())));
  });

  private dragging = false; private sx = 0; private sy = 0; private opx = 0; private opy = 0;
  private clickTimer: ReturnType<typeof setTimeout> | null = null;
  private pinch = 0;
  private palettes = [
    ['#5e9eff', '#3d82f0'], ['#34c759', '#28a64a'], ['#ff9f0a', '#f08800'], ['#ff476f', '#e82f59'],
    ['#af52de', '#9a3fc8'], ['#30bcd6', '#1fa7c0'], ['#ff7a5a', '#f25c3a'], ['#7d8a9c', '#69768a'],
  ];

  constructor(public svc: DataService) {}

  async ngOnInit(): Promise<void> {
    document.body.classList.toggle('te', this.lang() === 'te');
    await this.svc.load();
    const people = this.svc.data().people;
    if (people.length && !people.some(p => p.id === this.pov())) this.pov.set(people[0].id);
    setTimeout(() => this.fitView(), 0);
  }
  ngAfterViewInit(): void {
    const el = this.stageRef.nativeElement;
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('touchmove', this.onTouchMove, { passive: false });
    setTimeout(() => this.fitView(), 0);
  }

  t(k: string): string { return (T[this.lang()] as Record<string, string>)[k] ?? (T.en as Record<string, string>)[k] ?? k; }
  byId(id: number): Person | undefined { return this.graph().byId(id); }
  nameOf(id: number): string { const p = this.byId(id); return p ? dispName(p.first_name, this.lang()) : ''; }
  lastNameOf(id: number): string { const p = this.byId(id); return p?.last_name ? dispName(p.last_name, this.lang()) : ''; }
  round(n: number): number { return Math.round(n); }
  grad(id: number): string {
    let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const [a, b] = this.palettes[h % this.palettes.length];
    return `linear-gradient(135deg,${a},${b})`;
  }
  /** Canvas avatar colour by role: POV dark silver, family lighter blue, extended neutral. */
  avatarBg(cls: string): string {
    if (cls === 'pov') return 'linear-gradient(150deg,#8e93a0 0%,#5b606b 55%,#3f434c 100%)';
    if (cls === 'main') return 'linear-gradient(160deg,#6cb0ff,#3d86ef)';
    return 'linear-gradient(160deg,#c4cad6,#a7aebd)';
  }
  parentsOf(id: number) { return this.graph().parents(id); }
  spousesOf(id: number) { return this.graph().spouses(id); }
  childrenOf(id: number) { return this.graph().children(id); }
  relWord(rel: Relation): string { return this.t(rel === 'spouse' ? 'spouseLabel' : 'childLabel'); }

  setPov(id: number): void { this.pov.set(id); setTimeout(() => this.centerOn(id), 0); }
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
  @HostListener('window:keydown.escape') onEsc(): void { this.formOpen.set(false); this.povOpen.set(false); }

  onWheel = (e: WheelEvent): void => { e.preventDefault(); this.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 0.89); };
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
  fitView(): void {
    const st = this.stageRef?.nativeElement; if (!st) return;
    const v = this.view(); if (!v.width || !v.height) return;
    const s = Math.min(st.clientWidth / v.width, st.clientHeight / v.height) * 0.92;
    this.scale.set(Math.max(0.25, Math.min(s, 1.1)));
    this.panX.set((st.clientWidth - v.width * this.scale()) / 2);
    this.panY.set((st.clientHeight - v.height * this.scale()) / 2);
  }
  centerOn(id: number): void {
    const st = this.stageRef?.nativeElement; if (!st) return;
    const p = this.view().pos[id]; if (!p) return;
    const sc = this.scale();
    this.panX.set(st.clientWidth / 2 - p.x * sc);
    this.panY.set(st.clientHeight / 2 - (p.y + AV / 2) * sc);
  }

  addPersonBtn(): void { this.openAddRoot(); }
  openAddRoot(): void { if (!this.svc.canEdit()) return; this.formMode.set({ type: 'addRoot' }); this.fFirst.set(''); this.fLast.set(''); this.delArmed.set(false); this.formOpen.set(true); }
  openAdd(relation: Relation, anchorId: number): void { if (!this.svc.canEdit()) return; this.formMode.set({ type: 'add', relation, anchor: anchorId }); this.fFirst.set(''); this.fLast.set(''); this.addExisting.set(false); this.linkQuery.set(''); this.delArmed.set(false); this.formOpen.set(true); }
  openEdit(id: number): void { this.formMode.set({ type: 'edit', id }); const p = this.byId(id); this.fFirst.set(p?.first_name ?? ''); this.fLast.set(p?.last_name ?? ''); this.delArmed.set(false); this.formOpen.set(true); }
  closeForm(): void { this.formOpen.set(false); this.formMode.set(null); }
  onScrim(e: MouseEvent, which: 'form' | 'pov'): void {
    if (e.target !== e.currentTarget) return;
    if (which === 'form') this.closeForm(); else this.povOpen.set(false);
  }

  async save(): Promise<void> {
    const first = this.fFirst().trim(); if (!first) return;
    const last = this.fLast().trim() || null;
    const m = this.formMode(); if (!m) return;
    if (m.type === 'edit') { await this.svc.rename(m.id, first, last); this.closeForm(); return; }
    if (m.type === 'addRoot') { this.closeForm(); const id = await this.svc.addPerson(first, last); if (id > 0) this.setPov(id); return; }
    await this.svc.addRelative(m.relation, m.anchor, first, last);
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
    else await this.svc.linkChild(m.anchor, personId);
  }
  async unlinkParent(pId: number, id: number): Promise<void> { await this.svc.removeParentChild(pId, id); }
  async unlinkChild(id: number, cId: number): Promise<void> { await this.svc.removeParentChild(id, cId); }
  async unlinkSpouse(id: number, sId: number): Promise<void> { await this.svc.removeMarriage(id, sId); }

  openPov(): void { this.povQuery.set(''); this.povOpen.set(true); }
  pickPov(id: number): void { this.povOpen.set(false); this.setPov(id); }
  switchLang(l: Lang): void { this.lang.set(l); document.body.classList.toggle('te', l === 'te'); setTimeout(() => this.centerOn(this.pov()), 0); }

  async signInGoogle(): Promise<void> { await this.svc.signInWithGoogle(); }
  async signOut(): Promise<void> { await this.svc.signOut(); }
}
