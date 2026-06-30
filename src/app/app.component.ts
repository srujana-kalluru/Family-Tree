import {
  AfterViewInit, Component, ElementRef, HostListener, OnInit, ViewChild,
  ViewEncapsulation, computed, effect, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from './data/data.service';
import { TreeGraph } from './core/tree-graph';
import { buildView, connectionSegment, AV, NODE_W, ROW } from './core/layout';
import { AppUser, Lang, Person, TreeView, Wire } from './core/models';
import { dispName } from './core/translit';
import { tr } from './core/i18n';

type Relation = 'spouse' | 'child';
type FormMode =
  | { type: 'add'; relation: Relation; anchor: number }
  | { type: 'addRoot' }
  | { type: 'edit'; id: number }
  | null;

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
  private measureName = (label: string): number => {
    const ctx = this.nameCtx;
    if (!ctx) return label.length * 8 + 26;
    ctx.font = '500 13.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans Telugu", sans-serif';
    return ctx.measureText(label).width + 24;
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
  adminOpen = signal(false);
  linkUserOpen = signal(false);
  linkedUser = signal<AppUser | null>(null);
  povQuery = signal('');
  connOpen = signal(false);
  connA = signal<number | null>(null);
  connB = signal<number | null>(null);
  connPick = signal<'a' | 'b' | null>(null);
  connQuery = signal('');
  highlight = signal<number | null>(null);
  animating = signal(false);
  trackNode = (_: number, n: { id: number }) => n.id;

  graph = computed(() => new TreeGraph(this.svc.data()));
  view = signal<TreeView>(EMPTY_VIEW);
  transform = computed(() => `translate(${this.panX()}px, ${this.panY()}px) scale(${this.scale()})`);
  genBands = computed(() => {
    const ns = this.view().nodes, w = this.view().width;
    if (!ns.length) return [] as { y: number; h: number; w: number; shade: boolean }[];
    const ys = [...new Set(ns.map(n => n.y))].sort((a, b) => a - b);
    return ys.map((gy, i) => ({ y: gy + AV / 2 - ROW / 2, h: ROW, w, shade: i % 2 === 1 }));
  });
  isAdd = computed(() => this.formMode()?.type === 'add');
  isRoot = computed(() => this.formMode()?.type === 'addRoot');
  isEdit = computed(() => this.formMode()?.type === 'edit');
  editId = computed(() => { const m = this.formMode(); return m && m.type === 'edit' ? m.id : -1; });
  addRelation = computed<Relation>(() => { const m = this.formMode(); return m && m.type === 'add' ? m.relation : 'child'; });
  addAnchor = computed(() => { const m = this.formMode(); return m && m.type === 'add' ? m.anchor : -1; });
  povList = computed(() => this.matchSort(this.svc.data().people, this.povQuery().toLowerCase()));
  users = computed(() => this.svc.users());
  linkCandidates = computed(() => {
    const m = this.formMode(); if (!m || m.type !== 'add') return [];
    const g = this.graph(); const exclude = new Set<number>([m.anchor]);
    if (m.relation === 'spouse') g.spouses(m.anchor).forEach(s => exclude.add(s.id));
    else { g.ancestors(m.anchor).forEach(a => exclude.add(a)); g.children(m.anchor).forEach(c => exclude.add(c.id)); }
    return this.matchSort(this.svc.data().people.filter(p => !exclude.has(p.id)), this.linkQuery().toLowerCase());
  });
  anchorSpouses = computed(() => {
    const m = this.formMode();
    return m && m.type === 'add' && m.relation === 'child' ? this.graph().spouses(m.anchor) : [];
  });
  connCandidates = computed(() => this.connPick() ? this.matchSort(this.svc.data().people, this.connQuery().toLowerCase()) : []);
  connPaths = computed(() => {
    const a = this.connA(), b = this.connB();
    return a != null && b != null ? this.graph().connectionPaths(a, b) : [];
  });
  connSeg = computed(() => connectionSegment(this.graph(), this.connPaths()));
  branchSet = computed(() => {
    const g = this.graph();
    const h = this.highlight() ?? this.pov();
    const s = new Set<number>([h, ...g.ancestors(h), ...g.descendants(h)]);
    g.spouses(h).forEach(sp => s.add(sp.id));
    return s;
  });
  wireHi(w: Wire): boolean {
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
  wirePath(w: Wire): string {
    if (w.d) return w.d;
    if (!w.hops?.length) return `M${w.x1} ${w.y1}L${w.x2} ${w.y2}`;
    const y = w.y1, r = 5, lo = Math.min(w.x1, w.x2), hi = Math.max(w.x1, w.x2);
    let d = `M${lo} ${y}`;
    for (const hx of w.hops) d += `L${hx - r} ${y}A${r} ${r} 0 0 1 ${hx + r} ${y}`;
    return d + `L${hi} ${y}`;
  }
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
      const people = this.svc.data().people;
      const def = this.svc.defaultPovId();
      if (!people.length) return;
      const ok = (id: number | null) => id != null && people.some(p => p.id === id);
      if (this.povReady) { if (!ok(this.pov())) this.pov.set(ok(def) ? def! : people[0].id); return; }
      this.povReady = true;
      let saved: number | null = null;
      try { const s = localStorage.getItem('ft_pov'); saved = s != null ? +s : null; } catch { saved = null; }
      this.pov.set(ok(def) ? def! : ok(saved) ? saved! : people[0].id);
    });
    effect(() => {
      const g = this.graph(), p = this.pov(), l = this.lang();
      this.view.set(buildView(g, p, l, this.measureName));
      this.maybeInitialFit();
    });
  }
  private fitted = false;
  private povReady = false;
  private maybeInitialFit(): void {
    if (this.fitted || !this.stageRef || !this.view().nodes.length) return;
    this.fitted = true;
    setTimeout(() => this.frameOnPov(), 0);
  }

  async ngOnInit(): Promise<void> {
    document.body.classList.toggle('te', this.lang() === 'te');
    await this.svc.load();
  }
  ngAfterViewInit(): void {
    const el = this.stageRef.nativeElement;
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('touchmove', this.onTouchMove, { passive: false });
    setTimeout(() => this.frameOnPov(), 0);
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
  avatarBg(cls: string): string {
    if (cls === 'pov') return 'linear-gradient(150deg,#5f6675 0%,#41454f 55%,#2c2f37 100%)';
    if (cls === 'main') return 'linear-gradient(160deg,#1f6fd6,#0f4fa6)';
    return 'linear-gradient(160deg,#525b6b,#363d4a)';
  }
  readonly CROP_FRAME = 240;
  cropSrc = signal<string | null>(null);
  cropZoom = signal(1); cropX = signal(0); cropY = signal(0); cropZmin = 1;
  private cropIW = 1; private cropIH = 1;
  private cropDrag: { sx: number; sy: number; ox: number; oy: number } | null = null;

  onPhotoFile(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string, img = new Image();
      img.onload = () => {
        this.cropIW = img.width; this.cropIH = img.height;
        const z = this.CROP_FRAME / Math.min(img.width, img.height);
        this.cropZmin = z; this.cropZoom.set(z);
        this.cropX.set((this.CROP_FRAME - img.width * z) / 2);
        this.cropY.set((this.CROP_FRAME - img.height * z) / 2);
        this.cropSrc.set(src);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  }
  private cropPt(e: MouseEvent | TouchEvent) {
    const t = (e as TouchEvent).touches?.[0] ?? (e as TouchEvent).changedTouches?.[0];
    return t ? { x: t.clientX, y: t.clientY } : { x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY };
  }
  private clampCrop(x: number, y: number): [number, number] {
    const z = this.cropZoom();
    return [Math.min(0, Math.max(this.CROP_FRAME - this.cropIW * z, x)), Math.min(0, Math.max(this.CROP_FRAME - this.cropIH * z, y))];
  }
  cropDragStart(e: MouseEvent | TouchEvent): void { const p = this.cropPt(e); this.cropDrag = { sx: p.x, sy: p.y, ox: this.cropX(), oy: this.cropY() }; e.preventDefault(); }
  cropDragMove(e: MouseEvent | TouchEvent): void { if (!this.cropDrag) return; const p = this.cropPt(e); const [x, y] = this.clampCrop(this.cropDrag.ox + (p.x - this.cropDrag.sx), this.cropDrag.oy + (p.y - this.cropDrag.sy)); this.cropX.set(x); this.cropY.set(y); }
  cropDragEnd(): void { this.cropDrag = null; }
  setCropZoom(z: number): void { const old = this.cropZoom(), f = this.CROP_FRAME / 2; const nx = f - (f - this.cropX()) * z / old, ny = f - (f - this.cropY()) * z / old; this.cropZoom.set(z); const [x, y] = this.clampCrop(nx, ny); this.cropX.set(x); this.cropY.set(y); }
  cropDone(): void {
    const src = this.cropSrc(); if (!src) return;
    const OUT = 256, z = this.cropZoom(), img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = OUT; c.height = OUT;
      const ctx = c.getContext('2d'); if (!ctx) return;
      const s = this.CROP_FRAME / z;
      ctx.drawImage(img, -this.cropX() / z, -this.cropY() / z, s, s, 0, 0, OUT, OUT);
      this.fPhoto.set(c.toDataURL('image/jpeg', 0.85));
      this.cropSrc.set(null);
    };
    img.src = src;
  }
  cropCancel(): void { this.cropSrc.set(null); }
  parentsOf(id: number) { return this.graph().parents(id); }
  private editorMap = computed(() => { const m: Record<string, AppUser> = {}; this.svc.users().forEach(u => { m[u.id] = u; }); return m; });
  editorOf(uuid: string | null | undefined): AppUser | null { return uuid ? (this.editorMap()[uuid] ?? null) : null; }
  spousesOf(id: number) { return this.graph().spouses(id); }
  childrenOf(id: number) { return this.graph().children(id); }
  relWord(rel: Relation): string { return this.t(rel === 'spouse' ? 'spouseLabel' : 'childLabel'); }

  setPov(id: number): void { this.pov.set(id); try { localStorage.setItem('ft_pov', String(id)); } catch { } setTimeout(() => this.frameOnPov(true), 0); }
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
    if (e.ctrlKey) this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
    else { this.panX.update(x => x - e.deltaX); this.panY.update(y => y - e.deltaY); }
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
    const s = Math.max(0.25, Math.min(fit, 1.1) * zoom);
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
  frameOnPov(animate = false): void {
    const st = this.stageRef?.nativeElement; if (!st) return;
    const v = this.view(); if (!v.width || !v.height) return;
    if (animate) { this.animating.set(true); setTimeout(() => this.animating.set(false), 560); }
    const vw = st.clientWidth, vh = st.clientHeight, PAD = 36;
    const px = v.pos[this.pov()]?.x ?? v.width / 2;
    const reach = Math.max(px, v.width - px);
    const s = Math.max(0.12, Math.min(vw / (2 * reach + PAD * 2), vh / (v.height + PAD * 2), 1.1) * 1.44);
    this.scale.set(s);
    this.panX.set(vw / 2 - px * s);
    this.panY.set((vh - v.height * s) / 2);
  }

  addPersonBtn(): void { this.openAddRoot(); }
  openAddRoot(): void { if (!this.svc.canEdit()) return; this.formMode.set({ type: 'addRoot' }); this.fFirst.set(''); this.fLast.set(''); this.fPhoto.set(null); this.fGender.set(null); this.delArmed.set(false); this.formOpen.set(true); }
  openAdd(relation: Relation, anchorId: number): void {
    if (!this.svc.canEdit()) return;
    this.formMode.set({ type: 'add', relation, anchor: anchorId });
    this.fFirst.set(''); this.fLast.set(''); this.fPhoto.set(null); this.fGender.set(null); this.addExisting.set(false); this.linkQuery.set('');
    const sp = relation === 'child' ? this.graph().spouses(anchorId) : [];
    this.coParent.set(sp.length === 1 ? sp[0].id : null);
    this.delArmed.set(false); this.formOpen.set(true);
  }
  openEdit(id: number): void { this.formMode.set({ type: 'edit', id }); const p = this.byId(id); this.fFirst.set(p?.first_name ?? ''); this.fLast.set(p?.last_name ?? ''); this.fPhoto.set(p?.photo_url ?? null); this.fGender.set(p?.gender ?? null); this.delArmed.set(false); this.linkUserOpen.set(false); this.linkedUser.set(null); this.formOpen.set(true); }
  useGooglePhoto(): void {
    this.fPhoto.set(this.svc.userPhoto());
    const m = this.formMode(); const uid = this.svc.userId();
    if (m && m.type === 'edit' && uid) this.svc.linkUserToPerson(uid, m.id);
  }
  pickLinkUser(userId: string): void {
    const m = this.formMode(); if (!m || m.type !== 'edit') return;
    this.svc.linkUserToPerson(userId, m.id);
    this.linkedUser.set(this.svc.users().find(u => u.id === userId) ?? null);
    this.linkUserOpen.set(false);
  }
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
  isDefaultPov(id: number): boolean { const d = this.svc.defaultPovId(); return (d != null ? d : this.svc.data().people[0]?.id) === id; }

  openConn(): void { this.connOpen.set(true); this.connA.set(null); this.connB.set(null); this.connPick.set('a'); this.connQuery.set(''); }
  closeConn(): void { this.connOpen.set(false); this.connPick.set(null); }
  startConnPick(slot: 'a' | 'b'): void { this.connPick.set(slot); this.connQuery.set(''); }
  pickConn(id: number): void { (this.connPick() === 'a' ? this.connA : this.connB).set(id); this.connPick.set(null); this.connQuery.set(''); }
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
  switchLang(l: Lang): void { this.lang.set(l); document.body.classList.toggle('te', l === 'te'); setTimeout(() => this.frameOnPov(true), 0); }

  async signInGoogle(): Promise<void> { await this.svc.signInWithGoogle(); }
  async signOut(): Promise<void> { await this.svc.signOut(); }
}
