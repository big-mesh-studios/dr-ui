# Dr. UI

**(Declarative Retained UI)**

This project aims to construct a declarative pattern that resembles Solid.js or
React, but it is just an abstraction on top of vanilla with no signals and no
VDOM.

Instead of subscribing a view to a store, you keep direct references to the
nodes you built. A handle is both the view and the handle to its data. Updating
an item mutates the retained node in place.

## TodoMVC demo

```bash
pnpm install
pnpm -r build
pnpm --filter todo-list dev
```

The demo lives in [`demos/todo-list`](demos/todo-list) and implements the full
TodoMVC behaviour: add, edit (double-click), delete, check/uncheck, toggle all,
clear completed, hash-based filters, and per-row `localStorage` persistence.

It also supports `Alt` + `↑` / `↓` to reorder a row, which exercises the O(1)
swap operation.

### View

The demo is written as JSX and compiled directly to Dr. UI's `h()` factory
(classic JSX pragma via `demos/todo-list/vite.config.ts` and `tsconfig.json`).
It reads like Solid while still building one retained descriptor tree:

```tsx
function App() {
  return h(
    Fragment,
    null,
    <section class="todoapp">
      <Header />
      <Main />
      <Footer />
    </section>,
    <Info />,
  );
}
```

Components are plain functions. The runtime calls each one exactly once during
`runtime.mount(h(App), container)`, and `handle` callbacks capture the DOM refs
that later mutations update. Nothing re-runs after the mount pass.

### Complexity

| Operation | Cost |
| --- | --- |
| add / remove | O(1) |
| check / uncheck | O(1) |
| edit label | O(1) |
| swap two rows | O(1) |
| change filter | O(1), one root attribute |
| toggle all / clear completed | O(k), where k rows actually change |
| initial load | O(n) once |

There is no list-wide reconciliation on an item change, no signals, and no
virtual DOM.

## Derived state

Derived values use a retained `RankedGraph` rather than manual UI updates or
signals. Nodes declare dependencies, the compiler assigns topological ranks,
and a flush runs every dirty node exactly once in rank order.

The demo's footer/chrome graph is:

```text
todos ─┬─> total-count ─────┬─> remaining ─┬─> toggle-all
       └─> completed-count ─┘              └─> chrome
```

A toggle invalidates only `todos`. The flush recomputes both counts, then
`remaining`, then the dependent controls. The chain has a fixed number of
nodes, so it stays O(1) as the todo list grows.

## Packages

- `packages/dr-ui` — the retained runtime, DOM backend, `KeyedList`,
  `RetainedList`, and the `RankedGraph` / `RankedGraphCompiler` derived-state
  scheduler.
- `RetainedList` is the O(1) collection used by the demo. `append`, `remove`,
  `prepend`, `swapKeys`, `swapWithNext`, and `swapWithPrevious` mutate the
  linked order and the mounted node groups directly.
