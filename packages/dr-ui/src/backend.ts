export type ChildInput<TNode> =
  | TNode
  | ChildInput<TNode>[]
  | string
  | number
  | boolean
  | null
  | undefined;

export interface ElementDescriptor<
  TType extends string | symbol | ((...args: any[]) => unknown) = string,
  TProps extends Record<string, unknown> = Record<string, unknown>,
  THandle = unknown,
> {
  readonly type: TType;
  readonly props: TProps;
  readonly children: readonly ChildInput<unknown>[];
  readonly key?: string | number;
  readonly handle?: (node: any) => THandle;
}

export interface RetainedHandleEntry<THandle = unknown, TNode = unknown> {
  readonly id: string;
  readonly node: TNode;
  readonly api: THandle;
}

export interface RendererBackend<TRoot, TNode> {
  createRoot(): TRoot;
  createNode(type: string, props?: Record<string, unknown>): TNode;
  createTextNode(value: string | number): TNode;
  replaceText(textNode: TNode, value: string | number): void;
  insertBefore(parent: TRoot | TNode, node: TNode, anchor: TNode | null): void;
  removeChild(parent: TRoot | TNode, node: TNode): void;
  setProperty(node: TNode, key: string, value: unknown, prevValue?: unknown): void;
  disposeNode?(node: TNode): void;
}
