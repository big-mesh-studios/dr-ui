import {
  Fragment,
  RetainedList,
  createDomBackend,
  createUniversalRuntime,
  h,
} from "@big-mesh-studios/dr-ui";
import type {
  ElementDescriptor,
  RendererBackend,
  UniversalRuntime,
} from "@big-mesh-studios/dr-ui";
import "./todomvc.css";
import "./style.css";

/*
 * Every todo below is simultaneously the model and the view. The `RetainedList`
 * owns the live DOM nodes; each item's handle is the only way its row is
 * updated. There are no signals, no VDOM and no diffing pass.
 *
 * Complexity:
 *   add / remove / check / uncheck / edit / swap   O(1)
 *   change filter                                  O(1) (one root attribute)
 *   toggle-all / clear-completed                   O(k), k = rows touched
 *   load                                           O(n) once at startup
 *
 * Persistence is per-row (`dr-ui:todo:<id>`), so an item edit is also O(1)
 * rather than re-serialising the whole list.
 */

type Filter = "all" | "active" | "completed";

interface Todo {
  readonly id: number;
  order: number;
  label: string;
  completed: boolean;
  editing: boolean;
}

interface TodoView {
  setLabel(label: string): void;
  setCompleted(completed: boolean): void;
  beginEdit(): void;
  endEdit(commit: boolean): void;
  focus(): void;
}

const STORAGE_PREFIX = "dr-ui:todo:";

interface StoredTodo {
  id: number;
  order: number;
  label: string;
  completed: boolean;
}

const storage = (() => {
  try {
    if (typeof localStorage === "undefined") return null;
    const probe = "__dr_ui_todo_probe__";
    localStorage.setItem(probe, probe);
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
})();

function loadStoredTodos(): StoredTodo[] {
  if (!storage) return [];

  const items: StoredTodo[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key || !key.startsWith(STORAGE_PREFIX)) continue;

    const id = Number(key.slice(STORAGE_PREFIX.length));
    if (!Number.isFinite(id)) continue;

    const raw = storage.getItem(key);
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw) as {
        label?: unknown;
        completed?: unknown;
        order?: unknown;
      };
      if (typeof parsed.label !== "string") continue;

      items.push({
        id,
        order:
          typeof parsed.order === "number" && Number.isFinite(parsed.order)
            ? parsed.order
            : id,
        label: parsed.label,
        completed: parsed.completed === true,
      });
    } catch {
      // Ignore malformed entries rather than breaking the whole app.
    }
  }

  items.sort((a, b) => a.order - b.order || a.id - b.id);
  return items;
}

function filterFromHash(): Filter {
  const route = window.location.hash.replace(/^#\/?/, "").replace(/\/$/, "");
  return route === "active" || route === "completed" ? route : "all";
}

function firstOf<T>(set: Set<T>): T | undefined {
  for (const value of set) return value;
  return undefined;
}

class TodoApp {
  private readonly backend: RendererBackend<HTMLElement, Node>;
  private readonly runtime: UniversalRuntime<HTMLElement, Node>;
  private readonly list: RetainedList<Todo, HTMLElement, Node, TodoView>;
  private readonly active = new Set<Todo>();
  private readonly completed = new Set<Todo>();
  private readonly filterLinks = new Map<Filter, HTMLAnchorElement>();

  private appRoot!: HTMLElement;
  private newTodoInput!: HTMLInputElement;
  private toggleAllInput!: HTMLInputElement;
  private listHost!: HTMLUListElement;
  private mainSection!: HTMLElement;
  private footer!: HTMLElement;
  private clearCompletedButton!: HTMLButtonElement;
  private countText!: Node;
  private pluralText!: Node;

  private editing: Todo | null = null;
  private nextId = 1;
  private nextOrder = 1;

  constructor(
    container: HTMLElement,
    backend: RendererBackend<HTMLElement, Node>,
  ) {
    this.backend = backend;
    this.runtime = createUniversalRuntime(backend);
    this.countText = backend.createTextNode("0");
    this.pluralText = backend.createTextNode(" items left");

    this.runtime.mount(this.buildView(), container);

    this.list = new RetainedList<Todo, HTMLElement, Node, TodoView>({
      parent: this.listHost,
      backend,
      getKey: (item) => item.id,
      renderItem: (item) => this.renderTodo(item),
      mountItemDescriptor: (descriptor) => {
        const mounted = this.runtime.mountItem(descriptor);
        return {
          nodes: mounted.nodes,
          handle: mounted.handle as TodoView | undefined,
        };
      },
      detachNodes: (nodes) => {
        for (let i = 0; i < nodes.length; i++) {
          this.runtime.unmount(nodes[i], this.listHost);
        }
      },
    });

    const stored = loadStoredTodos();
    for (let i = 0; i < stored.length; i++) {
      const record = stored[i];
      const item: Todo = {
        id: record.id,
        order: record.order,
        label: record.label,
        completed: record.completed,
        editing: false,
      };
      this.list.append(item);
      (item.completed ? this.completed : this.active).add(item);
      if (item.id >= this.nextId) this.nextId = item.id + 1;
      if (item.order >= this.nextOrder) this.nextOrder = item.order + 1;
    }

    this.updateChrome();
    this.applyFilter(filterFromHash());

    window.addEventListener("hashchange", () => {
      this.applyFilter(filterFromHash());
    });

    this.newTodoInput.focus();
  }

  private buildView(): ElementDescriptor<any, any, unknown> {
    return h(
      Fragment,
      null,
      h(
        "section",
        {
          className: "todoapp",
          "data-filter": "all",
          handle: (node: Node) => {
            this.appRoot = node as HTMLElement;
          },
        },
        h(
          "header",
          { className: "header" },
          h("h1", null, "todos"),
          h("input", {
            className: "new-todo",
            placeholder: "What needs to be done?",
            autofocus: true,
            onKeyDown: (event: KeyboardEvent) => this.handleNewTodoKeyDown(event),
            handle: (node: Node) => {
              this.newTodoInput = node as HTMLInputElement;
            },
          }),
        ),
        h(
          "section",
          {
            className: "main",
            handle: (node: Node) => {
              this.mainSection = node as HTMLElement;
            },
          },
          h("input", {
            className: "toggle-all",
            id: "toggle-all",
            type: "checkbox",
            onChange: () => this.toggleAll(),
            handle: (node: Node) => {
              this.toggleAllInput = node as HTMLInputElement;
            },
          }),
          h("label", { for: "toggle-all" }, "Mark all as complete"),
          h("ul", {
            className: "todo-list",
            handle: (node: Node) => {
              this.listHost = node as HTMLUListElement;
            },
          }),
        ),
        h(
          "footer",
          {
            className: "footer",
            handle: (node: Node) => {
              this.footer = node as HTMLElement;
            },
          },
          h(
            "span",
            { className: "todo-count" },
            h("strong", null, this.countText),
            this.pluralText,
          ),
          h(
            "ul",
            { className: "filters" },
            this.filterLink("all", "#/", "All"),
            this.filterLink("active", "#/active", "Active"),
            this.filterLink("completed", "#/completed", "Completed"),
          ),
          h(
            "button",
            {
              className: "clear-completed",
              onClick: () => this.clearCompleted(),
              handle: (node: Node) => {
                this.clearCompletedButton = node as HTMLButtonElement;
              },
            },
            "Clear completed",
          ),
        ),
      ),
      h(
        "footer",
        { className: "info" },
        h("p", null, "Double-click to edit a todo"),
        h(
          "p",
          null,
          "Use ",
          h("kbd", null, "Alt"),
          " + ",
          h("kbd", null, "↑"),
          " / ",
          h("kbd", null, "↓"),
          " to reorder (O(1) swap)",
        ),
        h(
          "p",
          null,
          "Built with Dr. UI — retained nodes, no signals, no VDOM.",
        ),
        h(
          "p",
          null,
          "Part of ",
          h("a", { href: "https://todomvc.com" }, "TodoMVC"),
        ),
      ),
    );
  }

  private filterLink(
    filter: Filter,
    href: string,
    label: string,
  ): ElementDescriptor<any, any, unknown> {
    return h(
      "li",
      null,
      h(
        "a",
        {
          href,
          onClick: () => this.applyFilter(filter),
          handle: (node: Node) => {
            this.filterLinks.set(filter, node as HTMLAnchorElement);
          },
        },
        label,
      ),
    );
  }

  private handleNewTodoKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Enter") return;
    event.preventDefault();

    const text = this.newTodoInput.value;
    if (text.trim().length === 0) return;

    this.addTodo(text);
    this.newTodoInput.value = "";
  }

  private renderTodo(item: Todo): ElementDescriptor<any, any, TodoView> {
    const app = this;
    const backend = this.backend;
    const labelText = backend.createTextNode(item.label);

    let root!: HTMLLIElement;
    let toggle!: HTMLInputElement;
    let edit!: HTMLInputElement;

    const view: TodoView = {
      setLabel(nextLabel: string) {
        item.label = nextLabel;
        backend.replaceText(labelText, nextLabel);
        edit.value = nextLabel;
      },
      setCompleted(completed: boolean) {
        item.completed = completed;
        toggle.checked = completed;
        root.classList.toggle("completed", completed);
      },
      beginEdit() {
        if (item.editing) {
          edit.focus();
          edit.select();
          return;
        }
        item.editing = true;
        app.editing = item;
        root.classList.add("editing");
        edit.value = item.label;
        edit.focus();
        edit.select();
      },
      endEdit(commit: boolean) {
        if (!item.editing) return;

        item.editing = false;
        if (app.editing === item) app.editing = null;
        root.classList.remove("editing");

        if (!commit) {
          edit.value = item.label;
          return;
        }

        const nextLabel = edit.value.trim();
        if (nextLabel.length === 0) {
          app.removeTodo(item);
        } else if (nextLabel !== item.label) {
          app.updateTodoLabel(item, nextLabel);
        }
      },
      focus() {
        root.focus();
      },
    };

    return h(
      "li",
      {
        key: item.id,
        className: item.completed ? "completed" : "",
        tabIndex: 0,
        onKeyDown: (event: KeyboardEvent) => {
          if (!event.altKey || item.editing) return;
          if (event.key === "ArrowUp") {
            event.preventDefault();
            app.swapTodo(item, "up");
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            app.swapTodo(item, "down");
          }
        },
        handle: (node: Node) => {
          root = node as HTMLLIElement;
          return view;
        },
      },
      h(
        "div",
        { className: "view" },
        h("input", {
          className: "toggle",
          type: "checkbox",
          checked: item.completed,
          onChange: () => app.setTodoCompleted(item, toggle.checked),
          handle: (node: Node) => {
            toggle = node as HTMLInputElement;
          },
        }),
        h("label", { onDblClick: () => app.beginEdit(item) }, labelText),
        h("button", {
          className: "destroy",
          title: "Delete",
          onClick: () => app.removeTodo(item),
        }),
      ),
      h("input", {
        className: "edit",
        value: item.label,
        onBlur: () => app.finishEdit(item, true),
        onKeyDown: (event: KeyboardEvent) => {
          if (event.key === "Enter") {
            event.preventDefault();
            app.finishEdit(item, true);
            edit.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            app.finishEdit(item, false);
            edit.blur();
          }
        },
        handle: (node: Node) => {
          edit = node as HTMLInputElement;
        },
      }),
    );
  }

  private addTodo(label: string): void {
    const trimmed = label.trim();
    if (trimmed.length === 0) return;

    const item: Todo = {
      id: this.nextId++,
      order: this.nextOrder++,
      label: trimmed,
      completed: false,
      editing: false,
    };

    this.list.append(item);
    this.active.add(item);
    this.persistTodo(item);
    this.updateChrome();
  }

  private removeTodo(item: Todo): void {
    const entry = this.list.get(item.id);
    if (!entry) {
      this.active.delete(item);
      this.completed.delete(item);
      return;
    }

    if (this.editing === item) this.editing = null;
    item.editing = false;

    this.active.delete(item);
    this.completed.delete(item);
    this.list.remove(item.id);
    this.forgetTodo(item.id);
    this.updateChrome();
  }

  private beginEdit(item: Todo): void {
    if (this.editing && this.editing !== item) {
      this.finishEdit(this.editing, true);
    }
    this.list.get(item.id)?.handle?.beginEdit();
  }

  private finishEdit(item: Todo, commit: boolean): void {
    this.list.get(item.id)?.handle?.endEdit(commit);
  }

  private updateTodoLabel(item: Todo, label: string): void {
    const entry = this.list.get(item.id);
    if (!entry) return;
    entry.handle?.setLabel(label);
    item.label = label;
    this.persistTodo(item);
  }

  private setTodoCompleted(item: Todo, completed: boolean): void {
    if (item.completed === completed) return;

    const entry = this.list.get(item.id);
    if (!entry) return;

    entry.handle?.setCompleted(completed);
    item.completed = completed;

    if (completed) {
      this.active.delete(item);
      this.completed.add(item);
    } else {
      this.completed.delete(item);
      this.active.add(item);
    }

    this.persistTodo(item);
    this.updateChrome();
  }

  private swapTodo(item: Todo, direction: "up" | "down"): void {
    const entry = this.list.get(item.id);
    if (!entry) return;

    const neighborKey =
      direction === "up"
        ? this.list.previousKey(item.id)
        : this.list.nextKey(item.id);
    if (neighborKey === undefined) return;

    const neighbor = this.list.get(neighborKey)?.item;
    if (!neighbor) return;

    if (!this.list.swapKeys(item.id, neighborKey)) return;

    const order = item.order;
    item.order = neighbor.order;
    neighbor.order = order;
    this.persistTodo(item);
    this.persistTodo(neighbor);

    // Moving a focused DOM node drops focus to <body>; put it back so the row
    // can be moved repeatedly with the keyboard.
    entry.handle?.focus();
  }

  private toggleAll(): void {
    if (this.list.size === 0) {
      this.toggleAllInput.checked = false;
      return;
    }

    if (this.active.size === 0) {
      for (
        let item = firstOf(this.completed);
        item;
        item = firstOf(this.completed)
      ) {
        this.setTodoCompleted(item, false);
      }
    } else {
      for (let item = firstOf(this.active); item; item = firstOf(this.active)) {
        this.setTodoCompleted(item, true);
      }
    }
  }

  private clearCompleted(): void {
    for (
      let item = firstOf(this.completed);
      item;
      item = firstOf(this.completed)
    ) {
      this.removeTodo(item);
    }
  }

  private updateChrome(): void {
    const remaining = this.active.size;
    const total = this.list.size;

    this.backend.replaceText(this.countText, remaining);
    this.backend.replaceText(
      this.pluralText,
      remaining === 1 ? " item left" : " items left",
    );

    this.toggleAllInput.checked = total > 0 && remaining === 0;
    this.toggleAllInput.indeterminate =
      remaining > 0 && this.completed.size > 0;

    this.mainSection.hidden = total === 0;
    this.footer.hidden = total === 0;
    this.clearCompletedButton.hidden = this.completed.size === 0;
  }

  private applyFilter(filter: Filter): void {
    this.appRoot.dataset.filter = filter;

    this.filterLinks.forEach((link, key) => {
      link.classList.toggle("selected", key === filter);
    });

    // A row being edited can be hidden by the new filter. Commit it first so
    // the editor never disappears with unsaved text.
    const editing = this.editing;
    if (
      editing &&
      ((filter === "active" && editing.completed) ||
        (filter === "completed" && !editing.completed))
    ) {
      this.finishEdit(editing, true);
    }
  }

  private persistTodo(item: Todo): void {
    if (!storage) return;
    try {
      storage.setItem(
        STORAGE_PREFIX + item.id,
        JSON.stringify({
          label: item.label,
          completed: item.completed,
          order: item.order,
        }),
      );
    } catch {
      // Storage can be full or disabled; the app still works in memory.
    }
  }

  private forgetTodo(id: number): void {
    if (!storage) return;
    try {
      storage.removeItem(STORAGE_PREFIX + id);
    } catch {
      // Ignore quota/availability errors.
    }
  }
}

const mountTarget = document.getElementById("app");
if (!mountTarget) {
  throw new Error("Missing #app mount target.");
}

new TodoApp(mountTarget, createDomBackend({ container: mountTarget }));
