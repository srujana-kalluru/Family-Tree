import { Injectable, signal } from '@angular/core';
import { createClient, SupabaseClient, Session } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';
import { TreeData, Person, Marriage, ParentChild, AppUser } from '../core/models';

type Relation = 'spouse' | 'child';
type Gender = 'male' | 'female' | null;
const SELECT = 'id,first_name,last_name,photo_url,gender,created_by,updated_by,created_at,updated_at';
const EMPTY: TreeData = { people: [], marriages: [], parentChild: [] };

@Injectable({ providedIn: 'root' })
export class DataService {
  private client: SupabaseClient | null = null;
  readonly online = signal(false);
  readonly ready = signal(false);
  readonly signedIn = signal(false);
  readonly userEmail = signal<string | null>(null);
  readonly userName = signal<string | null>(null);
  readonly userPhoto = signal<string | null>(null);
  readonly userId = signal<string | null>(null);
  readonly lastError = signal<string | null>(null);
  readonly data = signal<TreeData>({ people: [], marriages: [], parentChild: [] });
  readonly defaultPovId = signal<number | null>(null);
  readonly users = signal<Record<string, AppUser>>({});   // auth UUID -> editor name/email

  constructor() {
    const url = environment.supabaseUrl?.trim();
    const key = environment.supabaseAnonKey?.trim();
    if (url && key) {
      this.client = createClient(url, key);
      this.online.set(true);
      this.client.auth.getSession().then(({ data }) => this.applySession(data.session));
      this.client.auth.onAuthStateChange((_e, session: Session | null) => this.applySession(session));
    }
  }
  private applySession(session: Session | null): void {
    this.signedIn.set(!!session);
    this.userEmail.set(session?.user?.email ?? null);
    this.userId.set(session?.user?.id ?? null);
    const meta = session?.user?.user_metadata ?? {};
    this.userName.set((meta['full_name'] as string) ?? (meta['name'] as string) ?? session?.user?.email ?? null);
    this.userPhoto.set((meta['avatar_url'] as string) ?? (meta['picture'] as string) ?? null);
    if (session?.user) this.upsertSelf();
  }
  /** Record (or refresh) this signed-in user in app_user so their edits resolve to a name and email. */
  private async upsertSelf(): Promise<void> {
    const id = this.userId(); if (!this.client || !id) return;
    try { await this.client.from('app_user').upsert({ id, name: this.userName(), email: this.userEmail(), updated_at: new Date().toISOString() }); } catch { /* app_user not migrated yet */ }
  }

  /** Editing requires a signed-in Supabase user - identical locally and in production. */
  canEdit(): boolean { return this.signedIn(); }

  async signInWithGoogle(): Promise<void> {
    if (!this.client) return;
    const redirectTo = window.location.origin + window.location.pathname;
    const { error } = await this.client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
    if (error) this.fail(error.message);
  }
  async signOut(): Promise<void> { await this.client?.auth.signOut(); }

  async load(): Promise<void> {
    if (!this.client) { this.data.set({ ...EMPTY }); this.ready.set(true); return; }
    try {
      const [pp, mm, pc] = await Promise.all([
        this.client.from('person').select(SELECT).order('id'),
        this.client.from('marriage').select('id,partner1_id,partner2_id').order('id'),
        this.client.from('parent_child').select('parent_id,child_id'),
      ]);
      if (pp.error || mm.error || pc.error) throw (pp.error || mm.error || pc.error);
      this.data.set({
        people: (pp.data as Person[]) ?? [],
        marriages: (mm.data as Marriage[]) ?? [],
        parentChild: (pc.data as ParentChild[]) ?? [],
      });
    } catch (e) {
      this.fail(e);
      this.data.set({ ...EMPTY });
    }
    try {   // resilient: a missing settings table just means no default yet
      const s = await this.client.from('app_settings').select('default_person_id').eq('id', 1).maybeSingle();
      this.defaultPovId.set(s.error ? null : ((s.data as { default_person_id: number | null } | null)?.default_person_id ?? null));
    } catch { this.defaultPovId.set(null); }
    try {   // resilient: the app_user table may not be migrated yet
      const u = await this.client.from('app_user').select('id,name,email');
      const map: Record<string, AppUser> = {};
      ((u.data as AppUser[]) ?? []).forEach(x => { map[x.id] = x; });
      this.users.set(map);
    } catch { this.users.set({}); }
    this.ready.set(true);
  }

  async setDefaultPov(personId: number): Promise<void> {
    if (!this.client) return;
    const prev = this.defaultPovId();
    this.defaultPovId.set(personId);   // optimistic
    const { error } = await this.client.from('app_settings').upsert({ id: 1, default_person_id: personId, updated_by_email: this.userEmail(), updated_at: new Date().toISOString() });
    if (error) { this.defaultPovId.set(prev); this.fail(error); }
  }

  clearError(): void { this.lastError.set(null); }
  private fail(msg: unknown): void {
    const text = typeof msg === 'string' ? msg : ((msg as Error)?.message ?? 'Something went wrong.');
    console.error('[Supabase]', msg);
    this.lastError.set(text);
  }
  private mutate(fn: (d: TreeData) => void): void { const d = structuredClone(this.data()); fn(d); this.data.set(d); }
  private nextMarriageId(): number { const ids = this.data().marriages.map(m => m.id); return (ids.length ? Math.max(...ids) : 0) + 1; }
  /** Optimistic audit for instant display; the DB fills created_* via column defaults, the app sends updated_*. */
  private stamp(p: Person): Person {
    const by = this.userId(); const now = new Date().toISOString();
    return { ...p, created_by: by, updated_by: by, created_at: now, updated_at: now };
  }
  private linkLocal(d: TreeData, relation: Relation, anchorId: number, id: number, coParentId: number | null = null): void {
    if (relation === 'spouse') d.marriages.push({ id: this.nextMarriageId(), partner1_id: anchorId, partner2_id: id });
    if (relation === 'child') {
      d.parentChild.push({ parent_id: anchorId, child_id: id });
      if (coParentId != null) d.parentChild.push({ parent_id: coParentId, child_id: id });   // second parent only if the user picks one
    }
  }

  /** Add a standalone person (the first person in an empty tree). Returns the new id, or -1 on failure. */
  /** Insert a person row and return its new id (throws on error). */
  private async insertPerson(first: string, last: string | null, gender: Gender): Promise<number> {
    const ins = await this.client!.from('person').insert({ first_name: first, last_name: last, gender }).select('id').single();
    if (ins.error) throw ins.error;
    return (ins.data as { id: number }).id;
  }

  async addPerson(first: string, last: string | null, gender: Gender = null): Promise<number> {
    if (!this.client) return -1;
    try {
      const id = await this.insertPerson(first, last, gender);
      this.mutate(d => d.people.push(this.stamp({ id, first_name: first, last_name: last, gender })));
      return id;
    } catch (e) { this.fail(e); await this.load(); return -1; }
  }

  async addRelative(relation: Relation, anchorId: number, first: string, last: string | null, coParentId: number | null = null, gender: Gender = null): Promise<void> {
    if (!this.client) return;
    try {
      const id = await this.insertPerson(first, last, gender);
      let linkErr = null;
      if (relation === 'spouse') linkErr = (await this.client.from('marriage').insert({ partner1_id: anchorId, partner2_id: id })).error;
      if (relation === 'child') {
        const rows = [{ parent_id: anchorId, child_id: id }];
        if (coParentId != null) rows.push({ parent_id: coParentId, child_id: id });
        linkErr = (await this.client.from('parent_child').insert(rows)).error;
      }
      if (linkErr) throw linkErr;
      this.mutate(d => { d.people.push(this.stamp({ id, first_name: first, last_name: last, gender })); this.linkLocal(d, relation, anchorId, id, coParentId); });
    } catch (e) { this.fail(e); await this.load(); }
  }

  /** Link two people who already exist as spouses (loops are allowed - e.g. cousin/uncle marriages). */
  async linkSpouse(aId: number, bId: number): Promise<void> {
    if (!this.client || aId === bId) return;
    if (this.data().marriages.some(m => (m.partner1_id === aId && m.partner2_id === bId) || (m.partner1_id === bId && m.partner2_id === aId))) return;
    this.mutate(d => d.marriages.push({ id: this.nextMarriageId(), partner1_id: aId, partner2_id: bId }));
    const { error } = await this.client.from('marriage').insert({ partner1_id: aId, partner2_id: bId });
    if (error) { this.fail(error); await this.load(); }
  }
  /** Link an existing person as a child of a parent. Caller must keep parent_child acyclic. */
  async linkChild(parentId: number, childId: number, coParentId: number | null = null): Promise<void> {
    if (!this.client || parentId === childId) return;
    const exists = (p: number) => this.data().parentChild.some(r => r.parent_id === p && r.child_id === childId);
    const rows = exists(parentId) ? [] : [{ parent_id: parentId, child_id: childId }];
    if (coParentId != null && coParentId !== childId && !exists(coParentId)) rows.push({ parent_id: coParentId, child_id: childId });
    if (!rows.length) return;
    this.mutate(d => rows.forEach(r => d.parentChild.push(r)));
    const { error } = await this.client.from('parent_child').insert(rows);
    if (error) { this.fail(error); await this.load(); }
  }

  async rename(id: number, first: string, last: string | null, photo: string | null, gender: Gender): Promise<void> {
    if (!this.client) return;
    const by = this.userId(); const now = new Date().toISOString();
    this.mutate(d => { const p = d.people.find(x => x.id === id); if (p) { p.first_name = first; p.last_name = last; p.photo_url = photo; p.gender = gender; p.updated_by = by; p.updated_at = now; } });
    const { error } = await this.client.from('person').update({ first_name: first, last_name: last, photo_url: photo, gender, updated_by: by, updated_at: now }).eq('id', id);
    if (error) { this.fail(error); await this.load(); }
  }
  async deletePerson(id: number): Promise<void> {
    if (!this.client) return;
    this.mutate(d => {
      d.people = d.people.filter(p => p.id !== id);
      d.parentChild = d.parentChild.filter(r => r.parent_id !== id && r.child_id !== id);
      d.marriages = d.marriages.filter(m => m.partner1_id !== id && m.partner2_id !== id);
    });
    const { error } = await this.client.from('person').delete().eq('id', id);
    if (error) { this.fail(error); await this.load(); }
  }
  async removeParentChild(parentId: number, childId: number): Promise<void> {
    if (!this.client) return;
    this.mutate(d => { d.parentChild = d.parentChild.filter(r => !(r.parent_id === parentId && r.child_id === childId)); });
    const { error } = await this.client.from('parent_child').delete().eq('parent_id', parentId).eq('child_id', childId);
    if (error) { this.fail(error); await this.load(); }
  }
  async removeMarriage(aId: number, bId: number): Promise<void> {
    if (!this.client) return;
    this.mutate(d => { d.marriages = d.marriages.filter(m => !((m.partner1_id === aId && m.partner2_id === bId) || (m.partner1_id === bId && m.partner2_id === aId))); });
    const { error } = await this.client.from('marriage').delete()
      .or(`and(partner1_id.eq.${aId},partner2_id.eq.${bId}),and(partner1_id.eq.${bId},partner2_id.eq.${aId})`);
    if (error) { this.fail(error); await this.load(); }
  }
}
