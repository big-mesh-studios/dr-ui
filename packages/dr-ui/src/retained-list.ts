import type { ElementDescriptor, RendererBackend } from "./backend";

/**
 * A live entry in a {@link RetainedList}.
 *
 * `item` is the data the entry was created from, `nodes` are the retained
 * target-language nodes, and `handle` is whatever the descriptor's `handle`
 * callback returned. There is deliberately no positional index: keeping one
 * up to date after an O(1) removal would require walking the rest of the list.
 */
export interface RetainedListEntry<TItem = unknown, TNode = unknown, THandle = unknown> {
  readonly key: string | number;
  readonly item: TItem;
  readonly nodes: readonly TNode[];
  readonly handle?: THandle;
}

interface MutableEntry<TItem, TNode, THandle>
  extends RetainedListEntry<TItem, TNode, THandle> {
  readonly nodes: TNode[];
  prev: MutableEntry<TItem, TNode, THandle> | null;
  next: MutableEntry<TItem, TNode, THandle> | null;
}

export interface RetainedListOptions<TItem, TRoot, TNode, THandle = unknown> {
  readonly parent: TRoot | TNode;
  readonly backend: RendererBackend<TRoot, TNode>;
  readonly getKey: (item: TItem) => string | number;
  readonly renderItem: (item: TItem) => ElementDescriptor<any, any, THandle>;
  readonly mountItemDescriptor: (
    descriptor: ElementDescriptor<any, any, THandle>,
  ) => { nodes: TNode[]; handle?: THandle };
  /**
   * Optional override used instead of the plain backend removal when an entry
   * is detached. Pass a runtime-aware remover to also release runtime state
   * (for example, `runtime.unmount` and its retained handles).
   */
  readonly detachNodes?: (nodes: readonly TNode[]) => void;
}

/**
 * Incrementally maintained keyed collection of retained UI entries.
 *
 * Unlike {@link KeyedList.reconcile}, which rebuilds order from a snapshot,
 * this collection is mutated directly. `append`, `remove`, `prepend` and
 * `swapKeys` are all O(1) in the size of the list; only the mounted nodes of
 * the entry being touched are moved.
 */
export class RetainedList<TItem, TRoot, TNode, THandle = unknown> {
  private readonly entries = new Map<
    string | number,
    MutableEntry<TItem, TNode, THandle>
  >();
  private readonly opts: RetainedListOptions<TItem, TRoot, TNode, THandle>;
  private headEntry: MutableEntry<TItem, TNode, THandle> | null = null;
  private tailEntry: MutableEntry<TItem, TNode, THandle> | null = null;
  private count = 0;

  constructor(opts: RetainedListOptions<TItem, TRoot, TNode, THandle>) {
    this.opts = opts;
  }

  public get size(): number {
    return this.count;
  }

  public get first(): RetainedListEntry<TItem, TNode, THandle> | undefined {
    return this.headEntry ?? undefined;
  }

  public get last(): RetainedListEntry<TItem, TNode, THandle> | undefined {
    return this.tailEntry ?? undefined;
  }

  public get(
    key: string | number,
  ): RetainedListEntry<TItem, TNode, THandle> | undefined {
    return this.entries.get(key);
  }

  public has(key: string | number): boolean {
    return this.entries.has(key);
  }

  /** Mount one item and append it to the end. O(1). */
  public append(item: TItem): RetainedListEntry<TItem, TNode, THandle> {
    const entry = this.mount(item);
    const { backend, parent } = this.opts;

    for (let i = 0; i < entry.nodes.length; i++) {
      backend.insertBefore(parent, entry.nodes[i], null);
    }

    entry.prev = this.tailEntry;
    entry.next = null;
    if (this.tailEntry) {
      this.tailEntry.next = entry;
    } else {
      this.headEntry = entry;
    }
    this.tailEntry = entry;
    this.register(entry);
    return entry;
  }

  /** Mount one item and insert it at the front. O(1). */
  public prepend(item: TItem): RetainedListEntry<TItem, TNode, THandle> {
    const entry = this.mount(item);
    const { backend, parent } = this.opts;
    const anchor = this.headEntry?.nodes[0] ?? null;

    for (let i = 0; i < entry.nodes.length; i++) {
      backend.insertBefore(parent, entry.nodes[i], anchor);
    }

    entry.prev = null;
    entry.next = this.headEntry;
    if (this.headEntry) {
      this.headEntry.prev = entry;
    } else {
      this.tailEntry = entry;
    }
    this.headEntry = entry;
    this.register(entry);
    return entry;
  }

  /** Remove an entry by key, detaching and disposing its nodes. O(1). */
  public remove(
    key: string | number,
  ): RetainedListEntry<TItem, TNode, THandle> | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.detach(entry);
    return entry;
  }

  /**
   * Exchange the positions of two entries by key. The linked-list links and
   * the two mounted node groups are moved directly, with no scan. O(1).
   */
  public swapKeys(
    keyA: string | number,
    keyB: string | number,
  ): boolean {
    if (keyA === keyB) return false;
    const a = this.entries.get(keyA);
    const b = this.entries.get(keyB);
    if (!a || !b) return false;

    const { backend, parent } = this.opts;

    // Temporary anchors let us exchange two arbitrary (including adjacent)
    // node groups without needing to know which one comes first.
    const markerA = backend.createTextNode("");
    const markerB = backend.createTextNode("");
    backend.insertBefore(parent, markerA, a.nodes[0] ?? null);
    backend.insertBefore(parent, markerB, b.nodes[0] ?? null);

    for (let i = 0; i < a.nodes.length; i++) {
      backend.insertBefore(parent, a.nodes[i], markerB);
    }
    for (let i = 0; i < b.nodes.length; i++) {
      backend.insertBefore(parent, b.nodes[i], markerA);
    }

    backend.removeChild(parent, markerA);
    backend.removeChild(parent, markerB);
    backend.disposeNode?.(markerA);
    backend.disposeNode?.(markerB);

    this.swapPositions(a, b);
    return true;
  }

  /** Key of the entry after `key`, or undefined at the tail. O(1). */
  public nextKey(key: string | number): string | number | undefined {
    return this.entries.get(key)?.next?.key;
  }

  /** Key of the entry before `key`, or undefined at the head. O(1). */
  public previousKey(key: string | number): string | number | undefined {
    return this.entries.get(key)?.prev?.key;
  }

  /** Swap an entry with its successor. O(1). */
  public swapWithNext(key: string | number): boolean {
    const entry = this.entries.get(key);
    if (!entry?.next) return false;
    return this.swapKeys(entry.key, entry.next.key);
  }

  /** Swap an entry with its predecessor. O(1). */
  public swapWithPrevious(key: string | number): boolean {
    const entry = this.entries.get(key);
    if (!entry?.prev) return false;
    return this.swapKeys(entry.key, entry.prev.key);
  }

  /** Visit every entry from head to tail. Mutation of the current entry is safe. */
  public forEach(
    callback: (
      entry: RetainedListEntry<TItem, TNode, THandle>,
      item: TItem,
      index: number,
    ) => void,
  ): void {
    let index = 0;
    for (let entry = this.headEntry; entry !== null; ) {
      const next = entry.next;
      callback(entry, entry.item, index++);
      entry = next;
    }
  }

  public *[Symbol.iterator](): IterableIterator<
    RetainedListEntry<TItem, TNode, THandle>
  > {
    for (let entry = this.headEntry; entry !== null; ) {
      const next = entry.next;
      yield entry;
      entry = next;
    }
  }

  /** Remove every entry. O(n), as each node must be detached. */
  public clear(): void {
    while (this.headEntry !== null) {
      this.detach(this.headEntry);
    }
  }

  private mount(item: TItem): MutableEntry<TItem, TNode, THandle> {
    const key = this.opts.getKey(item);
    if (this.entries.has(key)) {
      throw new Error(`RetainedList already contains key "${String(key)}".`);
    }

    const mounted = this.opts.mountItemDescriptor(this.opts.renderItem(item));
    return {
      key,
      item,
      nodes: mounted.nodes,
      handle: mounted.handle,
      prev: null,
      next: null,
    };
  }

  private register(entry: MutableEntry<TItem, TNode, THandle>): void {
    this.entries.set(entry.key, entry);
    this.count++;
  }

  private detach(entry: MutableEntry<TItem, TNode, THandle>): void {
    const { prev, next } = entry;
    if (prev) {
      prev.next = next;
    } else {
      this.headEntry = next;
    }
    if (next) {
      next.prev = prev;
    } else {
      this.tailEntry = prev;
    }

    this.entries.delete(entry.key);
    this.count--;

    if (this.opts.detachNodes) {
      this.opts.detachNodes(entry.nodes);
    } else {
      const { backend, parent } = this.opts;
      for (let i = 0; i < entry.nodes.length; i++) {
        const node = entry.nodes[i];
        backend.removeChild(parent, node);
        backend.disposeNode?.(node);
      }
    }

    entry.prev = null;
    entry.next = null;
  }

  private swapPositions(
    a: MutableEntry<TItem, TNode, THandle>,
    b: MutableEntry<TItem, TNode, THandle>,
  ): void {
    if (a.next === b) {
      // P -> a -> b -> N  becomes  P -> b -> a -> N
      const beforeA = a.prev;
      const afterB = b.next;

      a.prev = b;
      a.next = afterB;
      b.prev = beforeA;
      b.next = a;

      if (beforeA) beforeA.next = b;
      else this.headEntry = b;
      if (afterB) afterB.prev = a;
      else this.tailEntry = a;
      return;
    }

    if (b.next === a) {
      // P -> b -> a -> N  becomes  P -> a -> b -> N
      const beforeB = b.prev;
      const afterA = a.next;

      b.prev = a;
      b.next = afterA;
      a.prev = beforeB;
      a.next = b;

      if (beforeB) beforeB.next = a;
      else this.headEntry = a;
      if (afterA) afterA.prev = b;
      else this.tailEntry = b;
      return;
    }

    // P1 -> a -> N1 ... P2 -> b -> N2
    // becomes
    // P1 -> b -> N1 ... P2 -> a -> N2
    const beforeA = a.prev;
    const afterA = a.next;
    const beforeB = b.prev;
    const afterB = b.next;

    b.prev = beforeA;
    b.next = afterA;
    if (beforeA) beforeA.next = b;
    else this.headEntry = b;
    if (afterA) afterA.prev = b;
    else this.tailEntry = b;

    a.prev = beforeB;
    a.next = afterB;
    if (beforeB) beforeB.next = a;
    else this.headEntry = a;
    if (afterB) afterB.prev = a;
    else this.tailEntry = a;
  }
}
