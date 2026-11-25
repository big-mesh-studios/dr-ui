import type { ElementDescriptor } from "@big-mesh-studios/dr-ui";

declare global {
  namespace JSX {
    type Element = ElementDescriptor<any, any, any>;

    interface IntrinsicElements {
      [tag: string]: Record<string, unknown>;
    }
  }
}