import type { ElementDescriptor } from "./backend";
import type { RetainedList } from "./retained-list";
import type { MountContext } from "./runtime";

export interface ForProps<TItem, THandle = unknown> {
  /**
   * The retained collection backing this mount point. It is mutated directly
   * (`append`, `remove`, `swapKeys`); `<For>` never diffs a snapshot, so every
   * row operation stays O(1).
   */
  readonly each: RetainedList<TItem, any, any, THandle>;
  /**
   * Row renderer. It runs once per item, when the item is inserted.
   *
   * At runtime the compiler passes children as an array, so this is unwrapped
   * by `unwrapRender`; the type stays a function so JSX checks the body.
   */
  readonly children?: (item: TItem) => ElementDescriptor<any, any, THandle>;
}

/**
 * Declarative mount point for a {@link RetainedList}.
 *
 * ```tsx
 * <ul class="todo-list">
 *   <For each={todos}>{(item: Todo) => <TodoItem item={item} />}</For>
 * </ul>
 * ```
 *
 * `<For>` renders no wrapper element. It leaves a marker text node at its
 * position and inserts rows before that marker, so it composes with siblings.
 * It does not subscribe to anything: the list is the change channel.
 */
export function For<TItem, THandle = unknown>(
  props: ForProps<TItem, THandle>,
  context: MountContext<any, any>,
): ElementDescriptor<any, any, any> {
  const render = unwrapRender<TItem, THandle>(props.children);
  const parent = context.parent;
  if (parent === undefined) {
    throw new Error("<For> must be mounted inside a parent node.");
  }

  const anchor = context.backend.createTextNode("");

  props.each.attach({
    parent,
    anchor,
    backend: context.backend,
    renderItem: render,
    mountItemDescriptor: (descriptor) => {
      const mounted = context.mountItem(descriptor);
      return {
        nodes: mounted.nodes,
        handle: mounted.handle as THandle | undefined,
      };
    },
    detachNodes: (nodes) => {
      for (let i = 0; i < nodes.length; i++) {
        context.unmount(nodes[i], parent);
      }
    },
  });

  // The runtime treats a non-descriptor return value as an already-built
  // target node, which is exactly what the marker is. The cast only satisfies
  // JSX's descriptor-shaped `Element` type.
  return anchor as unknown as ElementDescriptor<any, any, any>;
}

function unwrapRender<TItem, THandle>(
  children: unknown,
): (item: TItem) => ElementDescriptor<any, any, THandle> {
  const candidate = Array.isArray(children) ? children[0] : children;
  if (typeof candidate !== "function") {
    throw new Error(
      '<For> expects a single render function child, e.g. <For each={list}>{(item) => ...}</For>.',
    );
  }
  return candidate as (item: TItem) => ElementDescriptor<any, any, THandle>;
}
