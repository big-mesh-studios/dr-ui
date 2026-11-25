import type { ElementDescriptor } from "@big-mesh-studios/dr-ui";

declare global {
  namespace JSX {
    /**
     * JSX expressions produce retained descriptors, not framework elements.
     * Making `Element` the descriptor type keeps JSX and `h()` interchangeable.
     */
    type Element = ElementDescriptor<any, any, any>;

    interface IntrinsicElements {
      [tag: string]: Record<string, unknown>;
    }
  }
}
