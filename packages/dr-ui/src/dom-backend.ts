import type { RendererBackend } from "./backend";

export interface DomBackendOptions {
  /** Container element used as the runtime root; defaults to creating a detached container or `document.body` */
  readonly container?: HTMLElement;
  /** Optional SVG namespace support for SVG tags */
  readonly svgNamespace?: boolean;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const SVG_TAGS = new Set([
  "svg",
  "g",
  "path",
  "circle",
  "rect",
  "line",
  "polygon",
  "polyline",
  "ellipse",
  "text",
  "tspan",
  "defs",
  "linearGradient",
  "stop",
  "clipPath",
]);

type ListenerMap = Map<string, EventListenerOrEventListenerObject>;
const nodeListeners = new WeakMap<Node, ListenerMap>();

function getOrCreateListenerMap(node: Node): ListenerMap {
  let map = nodeListeners.get(node);
  if (!map) {
    map = new Map();
    nodeListeners.set(node, map);
  }
  return map;
}

function normalizeEventName(key: string): string | null {
  if (!key.startsWith("on") || key.length <= 2) return null;
  // Supports `onClick` -> `click`, `onPointerMove` -> `pointermove`, or `on:custom` -> `custom`
  if (key.startsWith("on:")) return key.slice(3);
  return key.slice(2).toLowerCase();
}

function applyStyle(el: HTMLElement | SVGElement, value: unknown, prevValue: unknown): void {
  if (typeof prevValue === "object" && prevValue !== null) {
    const prevObj = prevValue as Record<string, string | number | null | undefined>;
    for (const prop of Object.keys(prevObj)) {
      if (prop.startsWith("--")) {
        el.style.removeProperty(prop);
      } else {
        (el.style as unknown as Record<string, string>)[prop] = "";
      }
    }
  }

  if (value == null || value === false) {
    el.removeAttribute("style");
    return;
  }

  if (typeof value === "string") {
    el.setAttribute("style", value);
    return;
  }

  if (typeof value === "object") {
    const styleObj = value as Record<string, string | number | boolean | null | undefined>;
    for (const [prop, val] of Object.entries(styleObj)) {
      if (val == null || val === false) {
        if (prop.startsWith("--")) el.style.removeProperty(prop);
        else (el.style as unknown as Record<string, string>)[prop] = "";
      } else if (prop.startsWith("--")) {
        el.style.setProperty(prop, String(val));
      } else {
        (el.style as unknown as Record<string, string>)[prop] = String(val);
      }
    }
  }
}

function cleanupNodeListeners(node: Node): void {
  const map = nodeListeners.get(node);
  if (!map) return;
  for (const [eventName, listener] of map) {
    node.removeEventListener(eventName, listener);
  }
  map.clear();
  nodeListeners.delete(node);
}

function disposeSubtree(node: Node): void {
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    disposeSubtree(child);
  }
  cleanupNodeListeners(node);
}

export function createDomBackend(
  options: DomBackendOptions = {},
): RendererBackend<HTMLElement, Node> {
  const rootEl =
    options.container ??
    (typeof document !== "undefined" ? document.body : (null as unknown as HTMLElement));

  return {
    createRoot(): HTMLElement {
      if (!rootEl) {
        throw new Error("No DOM container or document.body available for createRoot().");
      }
      return rootEl;
    },

    createNode(type: string, props?: Record<string, unknown>): Element {
      const isSvg =
        Boolean(options.svgNamespace) ||
        SVG_TAGS.has(type) ||
        Boolean(props && props.xmlns === SVG_NS);

      if (isSvg) {
        return document.createElementNS(SVG_NS, type);
      }
      return document.createElement(type);
    },

    createTextNode(value: string | number): Text {
      return document.createTextNode(String(value));
    },

    replaceText(textNode: Node, value: string | number): void {
      textNode.textContent = String(value);
    },

    insertBefore(parent: HTMLElement | Node, node: Node, anchor: Node | null): void {
      parent.insertBefore(node, anchor);
    },

    removeChild(parent: HTMLElement | Node, node: Node): void {
      if (node.parentNode === parent) {
        parent.removeChild(node);
      }
    },

    setProperty(node: Node, key: string, value: unknown, prevValue?: unknown): void {
      if (node.nodeType === Node.TEXT_NODE) {
        if (key === "textContent" || key === "value") {
          node.textContent = value == null ? "" : String(value);
        }
        return;
      }

      if (!(node instanceof Element)) return;

      // Event handlers (e.g., onClick, onInput, on:pointerdown)
      const eventName = normalizeEventName(key);
      if (eventName) {
        const listeners = getOrCreateListenerMap(node);
        const existing = listeners.get(eventName);
        if (existing) {
          node.removeEventListener(eventName, existing);
          listeners.delete(eventName);
        }
        if (typeof value === "function" || (typeof value === "object" && value !== null && "handleEvent" in value)) {
          const listener = value as EventListenerOrEventListenerObject;
          node.addEventListener(eventName, listener);
          listeners.set(eventName, listener);
        }
        return;
      }

      // Style prop
      if (key === "style") {
        if (node instanceof HTMLElement || node instanceof SVGElement) {
          applyStyle(node, value, prevValue);
        }
        return;
      }

      // Class / className
      if (key === "class" || key === "className") {
        if (value == null || value === false) {
          if (node instanceof HTMLElement) node.className = "";
          else node.removeAttribute("class");
        } else if (node instanceof HTMLElement && key === "className") {
          node.className = String(value);
        } else {
          node.setAttribute("class", String(value));
        }
        return;
      }

      // Text content shorthand
      if (key === "textContent") {
        node.textContent = value == null ? "" : String(value);
        return;
      }

      // Direct DOM properties when present on the element instance (e.g., value, checked, disabled)
      if (key in node && !(node instanceof SVGElement)) {
        try {
          (node as unknown as Record<string, unknown>)[key] = value ?? "";
          if (value === false || value == null) {
            node.removeAttribute(key);
          }
          return;
        } catch {
          // Fall through to attribute handling if property is read-only
        }
      }

      if (value === false || value == null) {
        node.removeAttribute(key);
      } else if (value === true) {
        node.setAttribute(key, "");
      } else {
        node.setAttribute(key, String(value));
      }
    },

    disposeNode(node: Node): void {
      disposeSubtree(node);
    },
  };
}
