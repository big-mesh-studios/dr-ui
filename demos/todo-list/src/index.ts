import { createDomBackend, KeyedList, createUniversalRuntime, h } from "@big-mesh-studios/dr-ui";

const mountTarget = document.getElementById("app")!;
const backend = createDomBackend({ container: mountTarget });
const runtime = createUniversalRuntime(backend);

runtime.mount(
  h(
    "div",
    { className: "shell", style: { padding: "16px" } },
    h("h1", null, "Universal Retained UI"),
    h(
      "button",
      {
        onClick: () => console.log("clicked"),
      },
      "Action",
    ),
  ),
);

// Example keyed DOM list using `runtime.mountItem` and `runtime.backend`
interface TodoItem {
  id: number;
  label: string;
}

const listHost = backend.createNode("ul");
backend.insertBefore(runtime.root, listHost, null);

const todoList = new KeyedList<TodoItem, HTMLElement, Node, { setLabel(text: string): void }>({
  parent: listHost,
  backend,
  getKey: (item) => item.id,
  renderItem: (item) =>
    h(
      "li",
      {
        key: item.id,
        handle: (node: Node) => {
          const textNode = backend.createTextNode(item.label);
          backend.insertBefore(node, textNode, null);
          return {
            setLabel(nextText: string) {
              backend.replaceText(textNode, nextText);
            },
          };
        },
      },
    ),
  mountItemDescriptor: (desc) =>
    runtime.mountItem(desc) as {
      nodes: Node[];
      handle?: { setLabel(text: string): void };
    },
  syncOrder: true,
  onUpdate(entry, item) {
    entry.handle?.setLabel(item.label);
  },
});

todoList.reconcile([
  { id: 1, label: "First item" },
  { id: 2, label: "Second item" },
]);
