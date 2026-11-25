import {
  Fragment,
  RankedGraph,
  RetainedList,
  createDomBackend,
  createUniversalRuntime,
  h,
} from "@big-mesh-studios/dr-ui";
import type { RendererBackend } from "@big-mesh-studios/dr-ui";
import "./todomvc.css";
import "./style.css";

/*
 * The whole app is one function.
 *
 * State, actions and view share a single closure, so the view is just a tree of
 * plain function calls built once:
 *
 *   runtime.mount(h(App), container)
 *
 * Every component runs exactly once while that descriptor tree is assembled.
 * Its `handle` callbacks capture the DOM refs used afterwards. There are no
 * signals, no VDOM, no re-render and no diffing.
 *
 * JSX is compiled to the library's `h()` factory (see `vite.config.ts`), which
 * keeps the component code looking like Solid while producing retained nodes.
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

type FilterLinkProps = {
  readonly filter: Filter;
  readonly href: string;
  readonly label: string;
};

type TodoItemProps = { readonly item: Todo };

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

function createTodoApp(
  container: HTMLElement,
  backend: RendererBackend<HTMLElement, Node>,
): void {
  // --- retained state ------------------------------------------------------
  const runtime = createUniversalRuntime(backend);
  const activeTodos = new Set<Todo>();
  const completedTodos = new Set<Todo>();
  const filterLinks = new Map<Filter, HTMLAnchorElement>();
  const graph = new RankedGraph();

  const countText = backend.createTextNode("0");
  const pluralText = backend.createTextNode(" items left");

  let list!: RetainedList<Todo, HTMLElement, Node, TodoView>;
  let editing: Todo | null = null;
  let nextId = 1;
  let nextOrder = 1;
  let totalCount = 0;
  let completedCount = 0;
  let remaining = 0;

  // DOM refs filled by the view during the single mount pass.
  let appRoot!: HTMLElement;
  let newTodoInput!: HTMLInputElement;
  let toggleAllInput!: HTMLInputElement;
  let listHost!: HTMLUListElement;
  let mainSection!: HTMLElement;
  let footer!: HTMLElement;
  let clearCompletedButton!: HTMLButtonElement;

  // --- view ---------------------------------------------------------------
  // Plain function components, each called once while `<App />` is mounted.

  function App() {
    // `Fragment` is a symbol handled by the runtime, so it is passed to `h`
    // directly rather than through `<>...</>`.
    return h(
      Fragment,
      null,
      <section
        class="todoapp"
        data-filter="all"
        handle={(node: Node) => {
          appRoot = node as HTMLElement;
        }}
      >
        <Header />
        <Main />
        <Footer />
      </section>,
      <Info />,
    );
  }

  function Header() {
    return (
      <header class="header">
        <h1>todos</h1>
        <input
          class="new-todo"
          placeholder="What needs to be done?"
          autofocus
          onKeyDown={(event: KeyboardEvent) => handleNewTodoKeyDown(event)}
          handle={(node: Node) => {
            newTodoInput = node as HTMLInputElement;
          }}
        />
      </header>
    );
  }

  function Main() {
    return (
      <section
        class="main"
        handle={(node: Node) => {
          mainSection = node as HTMLElement;
        }}
      >
        <input
          class="toggle-all"
          id="toggle-all"
          type="checkbox"
          onChange={() => toggleAll()}
          handle={(node: Node) => {
            toggleAllInput = node as HTMLInputElement;
          }}
        />
        <label for="toggle-all">Mark all as complete</label>
        <ul
          class="todo-list"
          handle={(node: Node) => {
            listHost = node as HTMLUListElement;
          }}
        />
      </section>
    );
  }

  function Footer() {
    return (
      <footer
        class="footer"
        handle={(node: Node) => {
          footer = node as HTMLElement;
        }}
      >
        <span class="todo-count">
          <strong>{countText}</strong>
          {pluralText}
        </span>
        <ul class="filters">
          <FilterLink filter="all" href="#/" label="All" />
          <FilterLink filter="active" href="#/active" label="Active" />
          <FilterLink filter="completed" href="#/completed" label="Completed" />
        </ul>
        <button
          class="clear-completed"
          onClick={() => clearCompleted()}
          handle={(node: Node) => {
            clearCompletedButton = node as HTMLButtonElement;
          }}
        >
          Clear completed
        </button>
      </footer>
    );
  }

  function FilterLink({ filter, href, label }: FilterLinkProps) {
    return (
      <li>
        <a
          href={href}
          onClick={() => applyFilter(filter)}
          handle={(node: Node) => {
            filterLinks.set(filter, node as HTMLAnchorElement);
          }}
        >
          {label}
        </a>
      </li>
    );
  }

  function TodoItem({ item }: TodoItemProps) {
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
        editing = item;
        root.classList.add("editing");
        edit.value = item.label;
        edit.focus();
        edit.select();
      },
      endEdit(commit: boolean) {
        if (!item.editing) return;

        item.editing = false;
        if (editing === item) editing = null;
        root.classList.remove("editing");

        if (!commit) {
          edit.value = item.label;
          return;
        }

        const nextLabel = edit.value.trim();
        if (nextLabel.length === 0) {
          removeTodo(item);
        } else if (nextLabel !== item.label) {
          updateTodoLabel(item, nextLabel);
        }
      },
      focus() {
        root.focus();
      },
    };

    return (
      <li
        key={item.id}
        class={item.completed ? "completed" : ""}
        tabIndex={0}
        onKeyDown={(event: KeyboardEvent) => {
          if (!event.altKey || item.editing) return;
          if (event.key === "ArrowUp") {
            event.preventDefault();
            swapTodo(item, "up");
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            swapTodo(item, "down");
          }
        }}
        handle={(node: Node) => {
          root = node as HTMLLIElement;
          return view;
        }}
      >
        <div class="view">
          <input
            class="toggle"
            type="checkbox"
            checked={item.completed}
            onChange={() => setTodoCompleted(item, toggle.checked)}
            handle={(node: Node) => {
              toggle = node as HTMLInputElement;
            }}
          />
          <label onDblClick={() => beginEdit(item)}>{labelText}</label>
          <button
            class="destroy"
            title="Delete"
            onClick={() => removeTodo(item)}
          />
        </div>
        <input
          class="edit"
          value={item.label}
          onBlur={() => finishEdit(item, true)}
          onKeyDown={(event: KeyboardEvent) => {
            if (event.key === "Enter") {
              event.preventDefault();
              finishEdit(item, true);
              edit.blur();
            } else if (event.key === "Escape") {
              event.preventDefault();
              finishEdit(item, false);
              edit.blur();
            }
          }}
          handle={(node: Node) => {
            edit = node as HTMLInputElement;
          }}
        />
      </li>
    );
  }

  function Info() {
    return (
      <footer class="info">
        <p>Double-click to edit a todo</p>
        <p>
          Use <kbd>Alt</kbd> + <kbd>↑</kbd> / <kbd>↓</kbd> to reorder (O(1) swap)
        </p>
        <p>Built with Dr. UI — retained nodes, no signals, no VDOM.</p>
        <p>
          Part of <a href="https://todomvc.com">TodoMVC</a>
        </p>
      </footer>
    );
  }

  // --- actions ------------------------------------------------------------
  // Ordinary closures over the same state the view captured.

  function handleNewTodoKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Enter") return;
    event.preventDefault();

    const text = newTodoInput.value;
    if (text.trim().length === 0) return;

    addTodo(text);
    newTodoInput.value = "";
  }

  function addTodo(label: string): void {
    const trimmed = label.trim();
    if (trimmed.length === 0) return;

    const item: Todo = {
      id: nextId++,
      order: nextOrder++,
      label: trimmed,
      completed: false,
      editing: false,
    };

    list.append(item);
    activeTodos.add(item);
    persistTodo(item);
    refreshDerived();
  }

  function removeTodo(item: Todo): void {
    const entry = list.get(item.id);
    if (!entry) {
      activeTodos.delete(item);
      completedTodos.delete(item);
      return;
    }

    if (editing === item) editing = null;
    item.editing = false;

    activeTodos.delete(item);
    completedTodos.delete(item);
    list.remove(item.id);
    forgetTodo(item.id);
    refreshDerived();
  }

  function beginEdit(item: Todo): void {
    if (editing && editing !== item) {
      finishEdit(editing, true);
    }
    list.get(item.id)?.handle?.beginEdit();
  }

  function finishEdit(item: Todo, commit: boolean): void {
    list.get(item.id)?.handle?.endEdit(commit);
  }

  function updateTodoLabel(item: Todo, label: string): void {
    const entry = list.get(item.id);
    if (!entry) return;
    entry.handle?.setLabel(label);
    item.label = label;
    persistTodo(item);
  }

  function setTodoCompleted(item: Todo, completed: boolean): void {
    if (item.completed === completed) return;

    const entry = list.get(item.id);
    if (!entry) return;

    entry.handle?.setCompleted(completed);
    item.completed = completed;

    if (completed) {
      activeTodos.delete(item);
      completedTodos.add(item);
    } else {
      completedTodos.delete(item);
      activeTodos.add(item);
    }

    persistTodo(item);
    refreshDerived();
  }

  function swapTodo(item: Todo, direction: "up" | "down"): void {
    const entry = list.get(item.id);
    if (!entry) return;

    const neighborKey =
      direction === "up"
        ? list.previousKey(item.id)
        : list.nextKey(item.id);
    if (neighborKey === undefined) return;

    const neighbor = list.get(neighborKey)?.item;
    if (!neighbor) return;

    if (!list.swapKeys(item.id, neighborKey)) return;

    const order = item.order;
    item.order = neighbor.order;
    neighbor.order = order;
    persistTodo(item);
    persistTodo(neighbor);

    // Moving a focused DOM node drops focus to <body>; put it back so the row
    // can be moved repeatedly with the keyboard.
    entry.handle?.focus();
  }

  function toggleAll(): void {
    if (list.size === 0) {
      toggleAllInput.checked = false;
      return;
    }

    graph.batch(() => {
      if (activeTodos.size === 0) {
        for (
          let item = firstOf(completedTodos);
          item;
          item = firstOf(completedTodos)
        ) {
          setTodoCompleted(item, false);
        }
      } else {
        for (
          let item = firstOf(activeTodos);
          item;
          item = firstOf(activeTodos)
        ) {
          setTodoCompleted(item, true);
        }
      }
    });
  }

  function clearCompleted(): void {
    graph.batch(() => {
      for (
        let item = firstOf(completedTodos);
        item;
        item = firstOf(completedTodos)
      ) {
        removeTodo(item);
      }
    });
  }

  function applyFilter(filter: Filter): void {
    appRoot.dataset.filter = filter;

    filterLinks.forEach((link, key) => {
      link.classList.toggle("selected", key === filter);
    });

    // A row being edited can be hidden by the new filter. Commit it first so
    // the editor never disappears with unsaved text.
    const activeEdit = editing;
    if (
      activeEdit &&
      ((filter === "active" && activeEdit.completed) ||
        (filter === "completed" && !activeEdit.completed))
    ) {
      finishEdit(activeEdit, true);
    }
  }

  function persistTodo(item: Todo): void {
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

  function forgetTodo(id: number): void {
    if (!storage) return;
    try {
      storage.removeItem(STORAGE_PREFIX + id);
    } catch {
      // Ignore quota/availability errors.
    }
  }

  // --- derived state ------------------------------------------------------
  /*
   * Derived UI state is a small ranked graph:
   *
   *   todos ─┬─> total-count ─────┬─> remaining ─┬─> toggle-all
   *          └─> completed-count ─┘              └─> chrome
   *
   * Every source mutation invalidates `todos`. Flushing runs each derived node
   * once, in rank order, so `remaining` always sees fresh counts and the
   * downstream nodes always see fresh `remaining`. The whole chain is O(1)
   * regardless of how many todos exist.
   */

  function setupDerivedGraph(): void {
    graph.add({ id: "todos", run: () => {} });

    graph.add({
      id: "total-count",
      dependencies: ["todos"],
      run: () => {
        totalCount = list.size;
      },
    });

    graph.add({
      id: "completed-count",
      dependencies: ["todos"],
      run: () => {
        completedCount = completedTodos.size;
      },
    });

    graph.add({
      id: "remaining",
      dependencies: ["total-count", "completed-count"],
      run: () => {
        remaining = totalCount - completedCount;
        backend.replaceText(countText, remaining);
        backend.replaceText(
          pluralText,
          remaining === 1 ? " item left" : " items left",
        );
      },
    });

    graph.add({
      id: "toggle-all",
      dependencies: ["remaining"],
      run: () => {
        toggleAllInput.checked = totalCount > 0 && remaining === 0;
        toggleAllInput.indeterminate =
          remaining > 0 && completedCount > 0;
      },
    });

    graph.add({
      id: "chrome",
      dependencies: ["remaining"],
      run: () => {
        mainSection.hidden = totalCount === 0;
        footer.hidden = totalCount === 0;
        clearCompletedButton.hidden = completedCount === 0;
      },
    });
  }

  function refreshDerived(): void {
    graph.invalidate("todos").flush();
  }

  // --- single mount pass --------------------------------------------------
  // The descriptor tree is built once. From here on, updates only touch the
  // captured refs; nothing is re-rendered.

  runtime.mount(h(App), container);

  list = new RetainedList<Todo, HTMLElement, Node, TodoView>({
    parent: listHost,
    backend,
    getKey: (item) => item.id,
    // Rows use the same component model as the rest of the tree.
    renderItem: (item) => <TodoItem item={item} />,
    mountItemDescriptor: (descriptor) => {
      const mounted = runtime.mountItem(descriptor);
      return {
        nodes: mounted.nodes,
        handle: mounted.handle as TodoView | undefined,
      };
    },
    detachNodes: (nodes) => {
      for (let i = 0; i < nodes.length; i++) {
        runtime.unmount(nodes[i], listHost);
      }
    },
  });

  setupDerivedGraph();

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
    list.append(item);
    (item.completed ? completedTodos : activeTodos).add(item);
    if (item.id >= nextId) nextId = item.id + 1;
    if (item.order >= nextOrder) nextOrder = item.order + 1;
  }

  refreshDerived();
  applyFilter(filterFromHash());

  window.addEventListener("hashchange", () => {
    applyFilter(filterFromHash());
  });

  newTodoInput.focus();
}

const mountTarget = document.getElementById("app");
if (!mountTarget) {
  throw new Error("Missing #app mount target.");
}

createTodoApp(mountTarget, createDomBackend({ container: mountTarget }));
