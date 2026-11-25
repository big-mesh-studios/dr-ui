import type { ChildInput, ElementDescriptor, RetainedHandleEntry } from "./backend";
import type { RendererBackend } from "./backend";

export const Fragment = Symbol("UniversalFragment");

export interface HOptions<TNode, THandle> {
  key?: string | number;
  handle?: (node: TNode) => THandle;
}

/**
 * Universal hyperscript helper:
 * h(type, props?, ...children)
 */
export function h<
  TNode = unknown,
  THandle = unknown,
  TProps extends Record<string, unknown> = Record<string, unknown>,
>(
  type: string | typeof Fragment | ((props: TProps & { children?: readonly unknown[] }) => unknown),
  props?: (TProps & HOptions<TNode, THandle>) | null,
  ...children: ChildInput<unknown>[]
): ElementDescriptor<any, TProps, THandle> {
  const safeProps = (props ?? {}) as TProps & HOptions<TNode, THandle>;
  const { key, handle, ...restProps } = safeProps;

  return {
    type,
    props: restProps as TProps,
    children,
    key,
    handle,
  };
}

export interface MountedDescriptorResult<TNode, THandle = unknown> {
  readonly nodes: TNode[];
  readonly handle?: THandle;
}

export interface UniversalRuntime<TRoot, TNode> {
  readonly root: TRoot;
  readonly backend: RendererBackend<TRoot, TNode>;
  mount(
    element: ElementDescriptor<any, any, any>,
    container?: TRoot | TNode,
    anchor?: TNode | null,
  ): TNode[];
  mountItem(
    element: ElementDescriptor<any, any, any>,
  ): MountedDescriptorResult<TNode, unknown>;
  unmount(node: TNode, parent?: TRoot | TNode): void;
  getHandle<THandle>(id: string): RetainedHandleEntry<THandle, TNode> | undefined;
}

export function createUniversalRuntime<TRoot, TNode>(
  backend: RendererBackend<TRoot, TNode>,
): UniversalRuntime<TRoot, TNode> {
  const root = backend.createRoot();
  const handles = new Map<string, RetainedHandleEntry<unknown, TNode>>();
  const handleIds = new Map<TNode, string>();

  function registerHandle(
    desc: ElementDescriptor<any, any, any>,
    node: TNode,
    capturedHandle?: { value?: unknown },
  ): void {
    if (typeof desc.handle === "function") {
      const api = desc.handle(node);
      const id = desc.key !== undefined ? String(desc.key) : String(desc.type);
      handles.set(id, { id, node, api });
      handleIds.set(node, id);
      if (capturedHandle) {
        capturedHandle.value = api;
      }
    }
  }

  function attachChild(
    parent: TRoot | TNode,
    child: ChildInput<unknown>,
    anchor: TNode | null = null,
  ): void {
    if (child === null || child === undefined || typeof child === "boolean") {
      return;
    }

    if (Array.isArray(child)) {
      for (let i = 0; i < child.length; i++) {
        attachChild(parent, child[i], anchor);
      }
      return;
    }

    if (typeof child === "string" || typeof child === "number") {
      const textNode = backend.createTextNode(child);
      backend.insertBefore(parent, textNode, anchor);
      return;
    }

    if (isDescriptor(child)) {
      const mounted = mountDescriptor(child, parent);
      for (let i = 0; i < mounted.nodes.length; i++) {
        backend.insertBefore(parent, mounted.nodes[i], anchor);
      }
      return;
    }

    // Already-instantiated target node (e.g., an Object3D or custom node)
    backend.insertBefore(parent, child as TNode, anchor);
  }

  function mountDescriptor(
    desc: ElementDescriptor<any, any, any>,
    parent?: TRoot | TNode,
    capturedHandle?: { value?: unknown },
  ): MountedDescriptorResult<TNode, unknown> {
    // 1. Functional component / builder (invoked once during retained assembly)
    if (typeof desc.type === "function") {
      const result = desc.type({
        ...desc.props,
        children: desc.children,
      });
      return collectResult(result, parent, capturedHandle);
    }

    // 2. Fragment: group children without allocating a wrapper node
    if (desc.type === Fragment) {
      const out: TNode[] = [];
      for (let i = 0; i < desc.children.length; i++) {
        const child = desc.children[i];
        if (isDescriptor(child)) {
          const m = mountDescriptor(child, parent, capturedHandle);
          for (let n = 0; n < m.nodes.length; n++) {
            out.push(m.nodes[n]);
          }
        } else if (child !== null && child !== undefined && typeof child !== "boolean") {
          if (typeof child === "string" || typeof child === "number") {
            out.push(backend.createTextNode(child));
          } else {
            out.push(child as TNode);
          }
        }
      }
      return { nodes: out, handle: capturedHandle?.value };
    }

    // 3. Intrinsic target node (string tag)
    const tag = String(desc.type);
    const node = backend.createNode(tag, desc.props);

    for (const [k, v] of Object.entries(desc.props)) {
      if (k !== "children") {
        backend.setProperty(node, k, v, undefined);
      }
    }

    for (let i = 0; i < desc.children.length; i++) {
      attachChild(node, desc.children[i], null);
    }

    registerHandle(desc, node, capturedHandle);

    return { nodes: [node], handle: capturedHandle?.value };
  }

  function collectResult(
    result: unknown,
    parent?: TRoot | TNode,
    capturedHandle?: { value?: unknown },
  ): MountedDescriptorResult<TNode, unknown> {
    if (isDescriptor(result)) {
      return mountDescriptor(result, parent, capturedHandle);
    }

    if (Array.isArray(result)) {
      const out: TNode[] = [];
      for (let i = 0; i < result.length; i++) {
        const item = result[i];
        if (isDescriptor(item)) {
          const m = mountDescriptor(item, parent, capturedHandle);
          for (let n = 0; n < m.nodes.length; n++) {
            out.push(m.nodes[n]);
          }
        } else if (item !== null && item !== undefined && typeof item !== "boolean") {
          if (typeof item === "string" || typeof item === "number") {
            out.push(backend.createTextNode(item));
          } else {
            out.push(item as TNode);
          }
        }
      }
      return { nodes: out, handle: capturedHandle?.value };
    }

    if (result !== null && result !== undefined && typeof result !== "boolean") {
      if (typeof result === "string" || typeof result === "number") {
        return { nodes: [backend.createTextNode(result)], handle: capturedHandle?.value };
      }
      return { nodes: [result as TNode], handle: capturedHandle?.value };
    }

    return { nodes: [], handle: capturedHandle?.value };
  }

  function mount(
    element: ElementDescriptor<any, any, any>,
    container: TRoot | TNode = root,
    anchor: TNode | null = null,
  ): TNode[] {
    const { nodes } = mountDescriptor(element, container);
    for (let i = 0; i < nodes.length; i++) {
      backend.insertBefore(container, nodes[i], anchor);
    }
    return nodes;
  }

  function mountItem(
    element: ElementDescriptor<any, any, any>,
  ): MountedDescriptorResult<TNode, unknown> {
    const captured: { value?: unknown } = {};
    return mountDescriptor(element, undefined, captured);
  }

  function unmount(node: TNode, parent?: TRoot | TNode): void {
    if (parent) {
      backend.removeChild(parent, node);
    }
    backend.disposeNode?.(node);

    const id = handleIds.get(node);
    if (id !== undefined) {
      const entry = handles.get(id);
      if (entry && entry.node === node) {
        handles.delete(id);
      }
      handleIds.delete(node);
    }
  }

  function getHandle<THandle>(id: string): RetainedHandleEntry<THandle, TNode> | undefined {
    return handles.get(id) as RetainedHandleEntry<THandle, TNode> | undefined;
  }

  return {
    root,
    backend,
    mount,
    mountItem,
    unmount,
    getHandle,
  };
}

function isDescriptor(value: unknown): value is ElementDescriptor<any, any, any> {
  return typeof value === "object" && value !== null && "type" in value && "props" in value;
}