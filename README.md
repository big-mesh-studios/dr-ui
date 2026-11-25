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

## Packages

- `packages/dr-ui` — the retained runtime, DOM backend, `KeyedList`, and the
  incremental `RetainedList`.
- `RetainedList` is the O(1) collection used by the demo. `append`, `remove`,
  `prepend`, `swapKeys`, `swapWithNext`, and `swapWithPrevious` mutate the
  linked order and the mounted node groups directly.
