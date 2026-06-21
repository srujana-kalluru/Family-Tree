import { Injectable, signal } from '@angular/core';
import { createClient, SupabaseClient, Session } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';
import { TreeData, Person, Marriage, ParentChild } from '../core/models';

type Relation = 'parent' | 'spouse' | 'child';
const SELECT = 'id,name,created_by_email,updated_by_email,created_at,updated_at';
const EMPTY: TreeData = { people: [], marriages: [], parentChild: [] };

@Injectable({ providedIn: 'root' })
export class DataService {
  private client: SupabaseClient | null = null;
  readonly online = signal(false);
  readonly ready = signal(false);
  readonly signedIn = signal(false);
  readonly userEmail = signal<string | null>(null);
  readonly userId = signal<string | null>(null);
  readonly lastError = signal<string | null>(null);
  readonly data = signal<TreeData>({ people: [], marriages: [], parentChild: [] });

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
    this.ready.set(true);
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
    const email = this.userEmail(); const now = new Date().toISOString();
    return { ...p, created_by_email: email, updated_by_email: email, created_at: now, updated_at: now };
  }
  private linkLocal(d: TreeData, relation: Relation, anchorId: number, id: number): void {
    if (relation === 'parent') d.parentChild.push({ parent_id: id, child_id: anchorId });
    if (relation === 'child') d.parentChild.push({ parent_id: anchorId, child_id: id });
    if (relation === 'spouse') d.marriages.push({ id: this.nextMarriageId(), partner1_id: anchorId, partner2_id: id });
  }

  /** Add a standalone person (the first person in an empty tree). Returns the new id, or -1 on failure. */
  async addPerson(name: string): Promise<number> {
    if (!this.client) return -1;
    try {
      const ins = await this.client.from('person').insert({ name }).select('id').single();
      if (ins.error) throw ins.error;
      const id = (ins.data as { id: number }).id;
      this.mutate(d => d.people.push(this.stamp({ id, name })));
      return id;
    } catch (e) { this.fail(e); await this.load(); return -1; }
  }

  async addRelative(relation: Relation, anchorId: number, name: string): Promise<void> {
    if (!this.client) return;
    try {
      const ins = await this.client.from('person').insert({ name }).select('id').single();
      if (ins.error) throw ins.error;
      const id = (ins.data as { id: number }).id;
      let linkErr = null;
      if (relation === 'parent') linkErr = (await this.client.from('parent_child').insert({ parent_id: id, child_id: anchorId })).error;
      if (relation === 'child') linkErr = (await this.client.from('parent_child').insert({ parent_id: anchorId, child_id: id })).error;
      if (relation === 'spouse') linkErr = (await this.client.from('marriage').insert({ partner1_id: anchorId, partner2_id: id })).error;
      if (linkErr) throw linkErr;
      this.mutate(d => { d.people.push(this.stamp({ id, name })); this.linkLocal(d, relation, anchorId, id); });
    } catch (e) { this.fail(e); await this.load(); }
  }

  async rename(id: number, name: string): Promise<void> {
    if (!this.client) return;
    const email = this.userEmail(); const now = new Date().toISOString();
    this.mutate(d => { const p = d.people.find(x => x.id === id); if (p) { p.name = name; p.updated_by_email = email; p.updated_at = now; } });
    const { error } = await this.client.from('person').update({ name, updated_by: this.userId(), updated_by_email: email, updated_at: now }).eq('id', id);
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
