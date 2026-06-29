export interface Person {
  id: number;
  uuid?: string | null;
  email?: string | null;
  first_name: string;
  last_name?: string | null;
  photo_url?: string | null;
  gender?: 'male' | 'female' | null;
  approved?: boolean;
  is_admin?: boolean;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}
export interface Marriage { id: number; partner1_id: number; partner2_id: number; created_by?: string | null; updated_by?: string | null; }
export interface ParentChild { parent_id: number; child_id: number; created_by?: string | null; updated_by?: string | null; }
export interface TreeData { people: Person[]; marriages: Marriage[]; parentChild: ParentChild[]; }
export type Lang = 'en' | 'te';
export type NodeClass = 'pov' | 'main' | 'ext';
export interface PositionedNode { id: number; x: number; y: number; size: number; cls: NodeClass; label: string; initials: string; photo?: string | null; }
export interface Wire { x1: number; y1: number; x2: number; y2: number; main: boolean; ids?: number[]; kind?: 'mar' | 'drop' | 'bus' | 'kid'; pars?: number[]; kids?: number[]; kid?: number; hops?: number[]; d?: string; }
export interface BoxRect { x: number; y: number; w: number; h: number; }
export interface TreeView { nodes: PositionedNode[]; wires: Wire[]; box: BoxRect | null; width: number; height: number; pos: Record<number, { x: number; y: number }>; }
