import type { ElementDescriptor } from "./backend";
import type { RendererBackend } from "./backend";

export interface RendererListBackend<TRoot, TNode> extends RendererBackend<TRoot, TNode> {
  /** Optional O(1) direct sibling swap hook if the backend stores an indexed child array */
  swapChildren?(parent: TRoot | TNode, first: TNode, second: TNode): void;
}

export interface TrackedListEntry<TNode = unknown, THandle = unknown> {
  readonly key: string | number;
  readonly nodes: TNode[];
  readonly handle?: THandle;
  index: number;
}

export interface KeyedListOptions<TItem, TRoot, TNode, THandle = unknown> {
  readonly parent: TRoot | TNode;
  readonly backend: RendererListBackend<TRoot, TNode>;
  readonly getKey: (item: TItem, index: number) => string | number;
  readonly renderItem: (item: TItem, index: number) => ElementDescriptor<any, any, THandle>;
  readonly mountItemDescriptor: (
    desc: ElementDescriptor<any, any, THandle>,
  ) => { nodes: TNode[]; handle?: THandle };
  /** Re-sync child positions in `parent` using `insertBefore` during `reconcile` */
  readonly syncOrder?: boolean;
  readonly onIndexChange?: (
    entry: TrackedListEntry<TNode, THandle>,
    newIndex: number,
  ) => void;
  readonly onUpdate?: (
    entry: TrackedListEntry<TNode, THandle>,
    item: TItem,
    index: number,
  ) => void;
}

export class KeyedList<TItem, TRoot, TNode, THandle = unknown> {
  private readonly entries = new Map<string | number, TrackedListEntry<TNode, THandle>>();
  private readonly ordered: TrackedListEntry<TNode, THandle>[] = [];
  private readonly opts: KeyedListOptions<TItem, TRoot, TNode, THandle>;

  constructor(opts: KeyedListOptions<TItem, TRoot, TNode, THandle>) {
    this.opts = opts;
  }

  /**
   * Swaps two rows by key in O(1) time without scanning the full list.
   */
  public swapKeys(keyA: string | number, keyB: string | number): boolean {
    if (keyA === keyB) return false;

    const entryA = this.entries.get(keyA);
    const entryB = this.entries.get(keyB);
    if (!entryA || !entryB) return false;

    const idxA = entryA.index;
    const idxB = entryB.index;

    this.ordered[idxA] = entryB;
    this.ordered[idxB] = entryA;
    entryA.index = idxB;
    entryB.index = idxA;

    if (entryA.nodes.length === 1 && entryB.nodes.length === 1) {
      const nodeA = entryA.nodes[0];
      const nodeB = entryB.nodes[0];

      if (this.opts.backend.swapChildren) {
        this.opts.backend.swapChildren(this.opts.parent, nodeA, nodeB);
      } else {
        // Fallback via insertBefore: move `nodeB` before `nodeA`, and `nodeA` before `afterB`
        const lo = Math.min(idxA, idxB);
        const hi = Math.max(idxA, idxB);
        const first = this.ordered[lo].nodes[0];
        const second = this.ordered[hi].nodes[0];
        const afterSecond = this.ordered[hi + 1]?.nodes[0] ?? null;

        if (hi === lo + 1) {
          this.opts.backend.insertBefore(this.opts.parent, second, first);
        } else {
          const afterFirst = this.ordered[lo + 1]?.nodes[0] ?? null;
          this.opts.backend.insertBefore(this.opts.parent, second, afterFirst);
          this.opts.backend.insertBefore(this.opts.parent, first, afterSecond);
        }
      }
    }

    this.opts.onIndexChange?.(entryA, entryA.index);
    this.opts.onIndexChange?.(entryB, entryB.index);

    return true;
  }

  public reconcile(items: readonly TItem[]): void {
    const {
      parent,
      backend,
      getKey,
      renderItem,
      mountItemDescriptor,
      syncOrder = false,
      onIndexChange,
      onUpdate,
    } = this.opts;

    const nextKeys = new Set<string | number>();
    this.ordered.length = 0;

    // 1. Remove and dispose entries whose keys are no longer present
    for (const [key, entry] of this.entries) {
      if (!nextKeys.has(key)) {
        // Check against incoming items first so removed nodes detach cleanly
      }
    }
    const incomingSet = new Set<string | number>();
    for (let i = 0; i < items.length; i++) {
      incomingSet.add(getKey(items[i], i));
    }
    for (const [key, entry] of this.entries) {
      if (!incomingSet.has(key)) {
        for (let n = 0; n < entry.nodes.length; n++) {
          const node = entry.nodes[n];
          backend.removeChild(parent, node);
          backend.disposeNode?.(node);
        }
        this.entries.delete(key);
      }
    }

    // 2. Reuse existing entries or mount new ones
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const key = getKey(item, i);
      nextKeys.add(key);

      let entry = this.entries.get(key);
      if (entry) {
        if (entry.index !== i) {
          entry.index = i;
          onIndexChange?.(entry, i);
        }
        onUpdate?.(entry, item, i);
      } else {
        const mounted = mountItemDescriptor(renderItem(item, i));
        entry = {
          key,
          nodes: mounted.nodes,
          handle: mounted.handle,
          index: i,
        };
        this.entries.set(key, entry);
        for (let n = 0; n < entry.nodes.length; n++) {
          backend.insertBefore(parent, entry.nodes[n], null);
        }
      }

      this.ordered.push(entry);
    }

    // 3. Optional reverse-anchor pass using `insertBefore(parent, node, anchor)`
    if (syncOrder) {
      let anchor: TNode | null = null;
      for (let i = this.ordered.length - 1; i >= 0; i--) {
        const { nodes } = this.ordered[i];
        for (let n = nodes.length - 1; n >= 0; n--) {
          const currentNode = nodes[n];
          backend.insertBefore(parent, currentNode, anchor);
          anchor = currentNode;
        }
      }
    }
  }

  public get(key: string | number): TrackedListEntry<TNode, THandle> | undefined {
    return this.entries.get(key);
  }

  public clear(): void {
    this.reconcile([]);
  }
}