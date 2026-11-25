export interface GraphNodeSpec {
  readonly id: string;
  /** IDs of upstream nodes this node depends on (if omitted, inferred from other nodes' `dependents`) */
  readonly dependencies?: readonly string[];
  /** Optional IDs of downstream nodes that depend on this node */
  readonly dependents?: readonly string[];
  /** Called once per flush when this node is dirty */
  run: () => void;
}

export interface CompiledTopoNode extends GraphNodeSpec {
  readonly rank: number;
  readonly dependents: readonly string[];
}

/**
 * Computes topological ranks for a retained dependency graph.
 *
 * Ranks are only a scheduling hint: lower ranks always run before higher
 * ranks, so a dirty node never observes a stale upstream value during a flush.
 */
export class RankedGraphCompiler {
  private readonly specs = new Map<string, GraphNodeSpec>();

  public add(spec: GraphNodeSpec): void {
    this.specs.set(spec.id, spec);
  }

  public remove(id: string): void {
    this.specs.delete(id);
  }

  /**
   * Computes topological ranks automatically from dependencies/dependents.
   * Throws an Error if a cycle exists in the graph.
   */
  public compile(): Map<string, CompiledTopoNode> {
    const upstreamMap = new Map<string, Set<string>>();
    const downstreamMap = new Map<string, Set<string>>();

    for (const id of this.specs.keys()) {
      upstreamMap.set(id, new Set<string>());
      downstreamMap.set(id, new Set<string>());
    }

    // Build bidirectional adjacency lists from either `dependencies` or `dependents`
    for (const [id, spec] of this.specs) {
      if (spec.dependencies) {
        for (const depId of spec.dependencies) {
          if (!this.specs.has(depId)) continue;
          upstreamMap.get(id)!.add(depId);
          downstreamMap.get(depId)!.add(id);
        }
      }

      if (spec.dependents) {
        for (const downId of spec.dependents) {
          if (!this.specs.has(downId)) continue;
          downstreamMap.get(id)!.add(downId);
          upstreamMap.get(downId)!.add(id);
        }
      }
    }

    // Kahn's algorithm: start with nodes that have 0 upstream dependencies
    const inDegree = new Map<string, number>();
    const rankMap = new Map<string, number>();
    const queue: string[] = [];

    for (const [id, ups] of upstreamMap) {
      inDegree.set(id, ups.size);
      rankMap.set(id, 0);
      if (ups.size === 0) {
        queue.push(id);
      }
    }

    let visited = 0;
    let head = 0;

    while (head < queue.length) {
      const currentId = queue[head++];
      visited++;

      const currentRank = rankMap.get(currentId)!;
      for (const nextId of downstreamMap.get(currentId)!) {
        const candidateRank = currentRank + 1;
        if (candidateRank > rankMap.get(nextId)!) {
          rankMap.set(nextId, candidateRank);
        }

        const remaining = inDegree.get(nextId)! - 1;
        inDegree.set(nextId, remaining);
        if (remaining === 0) {
          queue.push(nextId);
        }
      }
    }

    if (visited !== this.specs.size) {
      throw new Error(
        "Cycle detected in retained dependency graph; topological ranks cannot be computed.",
      );
    }

    const compiled = new Map<string, CompiledTopoNode>();
    for (const [id, spec] of this.specs) {
      compiled.set(id, {
        ...spec,
        rank: rankMap.get(id)!,
        dependents: Array.from(downstreamMap.get(id)!),
      });
    }

    return compiled;
  }
}

/**
 * Retained dependency graph runtime.
 *
 * `invalidate(id)` marks a node dirty. `flush()` expands that to all
 * downstream nodes, runs each affected node once in rank order, and drops the
 * dirty set. Invalidations raised from inside a `run` are handled in a
 * following pass, so the graph always settles.
 *
 * The graph is deliberately imperative: nodes are retained objects whose
 * `run` mutates the UI nodes they captured. There are no subscriptions and no
 * new node allocations on flush.
 */
export class RankedGraph {
  private readonly compiler = new RankedGraphCompiler();
  private compiled: Map<string, CompiledTopoNode> | null = null;
  private readonly dirty = new Set<string>();
  private flushing = false;
  private batchDepth = 0;

  public add(spec: GraphNodeSpec): this {
    this.compiler.add(spec);
    this.compiled = null;
    this.dirty.add(spec.id);
    return this;
  }

  public remove(id: string): this {
    this.compiler.remove(id);
    this.compiled = null;
    this.dirty.delete(id);
    return this;
  }

  public has(id: string): boolean {
    return this.ensureCompiled().has(id);
  }

  /** Mark a node dirty. Nothing runs until `flush()`. */
  public invalidate(id: string): this {
    this.dirty.add(id);
    return this;
  }

  /** Mark every node dirty. Useful after a bulk replacement of retained nodes. */
  public invalidateAll(): this {
    for (const id of this.ensureCompiled().keys()) {
      this.dirty.add(id);
    }
    return this;
  }

  public get dirtySize(): number {
    return this.dirty.size;
  }

  /**
   * Coalesce all invalidations raised by `fn` into a single flush. Nested
   * batches flush only when the outermost batch finishes.
   */
  public batch<T>(fn: () => T): T {
    this.batchDepth++;
    try {
      return fn();
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0) {
        this.flush();
      }
    }
  }

  /**
   * Run every dirty node and all of its downstream dependents exactly once,
   * in topological rank order.
   */
  public flush(): void {
    if (this.flushing || this.batchDepth > 0) return;

    this.flushing = true;
    try {
      let passes = 0;

      while (this.dirty.size > 0) {
        if (++passes > 1000) {
          throw new Error(
            "RankedGraph flush did not settle; a node is invalidating itself forever.",
          );
        }

        const compiled = this.ensureCompiled();
        const affected = new Set<string>();
        const stack = Array.from(this.dirty);
        this.dirty.clear();

        while (stack.length > 0) {
          const id = stack.pop()!;
          if (affected.has(id)) continue;

          const node = compiled.get(id);
          if (!node) continue;

          affected.add(id);
          for (let i = 0; i < node.dependents.length; i++) {
            stack.push(node.dependents[i]);
          }
        }

        const ordered: CompiledTopoNode[] = [];
        for (const id of affected) {
          const node = compiled.get(id);
          if (node) ordered.push(node);
        }

        ordered.sort(
          (a, b) => a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
        );

        for (let i = 0; i < ordered.length; i++) {
          ordered[i].run();
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  private ensureCompiled(): Map<string, CompiledTopoNode> {
    if (!this.compiled) {
      this.compiled = this.compiler.compile();
    }
    return this.compiled;
  }
}
