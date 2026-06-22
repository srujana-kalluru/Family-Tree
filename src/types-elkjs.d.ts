declare module 'elkjs/lib/elk.bundled.js' {
  export default class ELK {
    constructor(options?: unknown);
    layout(graph: unknown, options?: unknown): Promise<{ children?: { id: string; x?: number; y?: number; width?: number; height?: number }[] }>;
  }
}
