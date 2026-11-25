import {
  AmbientLight,
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  SphereGeometry,
  TorusGeometry,
} from "@random-mesh/rmsl/scene";
import type { Color } from "@random-mesh/rmsl/scene";
import type { RendererBackend } from "@big-mesh-studios/dr-ui";

export interface RmslBackendOptions {
  /** Optional canvas the companion renderer should draw into. */
  readonly canvas?: HTMLCanvasElement;
}

function toVector3(target: { set: (x: number, y: number, z: number) => unknown; x: number; y: number; z: number }, value: unknown): void {
  if (value == null) return;
  if (Array.isArray(value)) {
    const arr = value as number[];
    target.set(arr[0] ?? target.x, arr[1] ?? target.y, arr[2] ?? target.z);
    return;
  }
  if (typeof value === "number") {
    target.set(value, value, value);
    return;
  }
  if (typeof value === "object") {
    const v = value as { x?: number; y?: number; z?: number };
    target.set(v.x ?? target.x, v.y ?? target.y, v.z ?? target.z);
  }
}

function applyColor(target: { set: (...args: any[]) => unknown } | undefined, value: unknown): void {
  if (!target) return;
  if (value == null) return;
  try {
    if (typeof value === "number") {
      if (typeof (target as any).setHex === "function") (target as any).setHex(value);
      else target.set(value, value, value);
    } else if (Array.isArray(value)) {
      const arr = value as number[];
      if (arr.length === 1) {
        if (typeof (target as any).setHex === "function") (target as any).setHex(arr[0] ?? 0);
        else target.set(arr[0] ?? 0, arr[0] ?? 0, arr[0] ?? 0);
      } else {
        target.set(arr[0] ?? 0, arr[1] ?? 0, arr[2] ?? 0);
      }
    } else if (value && typeof value === "object" && "r" in (value as any)) {
      const c = value as { r: number; g: number; b: number };
      target.set(c.r, c.g, c.b);
    } else {
      try {
        (target as any).setHex?.(value);
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}

function geometryFromType(type: string, props?: Record<string, unknown>): InstanceType<typeof BoxGeometry> | InstanceType<typeof SphereGeometry> | InstanceType<typeof PlaneGeometry> | InstanceType<typeof CylinderGeometry> | InstanceType<typeof ConeGeometry> | InstanceType<typeof TorusGeometry> | InstanceType<typeof CircleGeometry> {
  const radius = (props?.radius as number | undefined) ?? 1;
  const width = (props?.width as number | undefined) ?? 1;
  const height = (props?.height as number | undefined) ?? 1;
  const depth = (props?.depth as number | undefined) ?? 1;
  switch (type) {
    case "box":
      return new BoxGeometry(width, height, depth);
    case "sphere":
      return new SphereGeometry(radius, 32, 16);
    case "plane":
      return new PlaneGeometry(width, height);
    case "cylinder":
      return new CylinderGeometry(radius, radius, height, 32);
    case "cone":
      return new ConeGeometry(radius, height, 32);
    case "torus":
      return new TorusGeometry(radius, (props?.tube as number | undefined) ?? 0.3, 16, 48);
    case "circle":
      return new CircleGeometry(radius, 32);
    default:
      return new BoxGeometry(width, height, depth);
  }
}

function materialFromProps(props?: Record<string, unknown>): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({
    color: (props?.color as number | Color | undefined) ?? 0xffffff,
    roughness: (props?.roughness as number | undefined) ?? 0.5,
    metalness: (props?.metalness as number | undefined) ?? 0.1,
    emissive: (props?.emissive as number | Color | undefined) ?? 0x000000,
  });
  return mat;
}

function createNodeForType(type: string, props?: Record<string, unknown>): Object3D {
  switch (type) {
    case "scene":
      return new Scene();
    case "group":
      return new Group();
    case "mesh":
      return new Mesh(
        (props?.geometry as any) ?? new BoxGeometry(1, 1, 1),
        (props?.material as any) ?? materialFromProps(props),
      );
    case "box":
    case "sphere":
    case "plane":
    case "cylinder":
    case "cone":
    case "torus":
    case "circle":
      return new Mesh(geometryFromType(type, props), materialFromProps(props));
    case "ambientLight":
      return new AmbientLight(
        (props?.color as number | undefined) ?? 0xffffff,
        (props?.intensity as number | undefined) ?? 1,
      );
    case "directionalLight":
      return new DirectionalLight(
        (props?.color as number | undefined) ?? 0xffffff,
        (props?.intensity as number | undefined) ?? 1,
      );
    case "pointLight":
      return new PointLight(
        (props?.color as number | undefined) ?? 0xffffff,
        (props?.intensity as number | undefined) ?? 1,
        (props?.distance as number | undefined) ?? 0,
        (props?.decay as number | undefined) ?? 2,
      );
    case "perspectiveCamera":
      return new PerspectiveCamera(
        (props?.fov as number | undefined) ?? 50,
        (props?.aspect as number | undefined) ?? 1,
        (props?.near as number | undefined) ?? 0.1,
        (props?.far as number | undefined) ?? 1000,
      );
    default:
      return new Group();
  }
}

export function createRmslBackend(_options: RmslBackendOptions = {}): RendererBackend<Scene, Object3D> {
  return {
    createRoot(): Scene {
      return new Scene();
    },

    createNode(type: string, props?: Record<string, unknown>): Object3D {
      return createNodeForType(String(type), props);
    },

    createTextNode(_value: string | number): Object3D {
      // RMSL has no text primitive; represent as an empty group so the tree stays intact.
      return new Group();
    },

    replaceText(_textNode: Object3D, _value: string | number): void {
      // No-op: no text primitive available in the RMSL scene graph.
    },

    insertBefore(parent: Scene | Object3D, node: Object3D, anchor: Object3D | null): void {
      const p = parent as Object3D;
      // Remove from previous parent if needed.
      if (node.parent && node.parent !== p) {
        node.parent.remove(node);
      }
      if (anchor === null) {
        if (!p.children.includes(node)) p.add(node);
        return;
      }
      const existing = p.children.indexOf(node);
      if (existing !== -1) p.children.splice(existing, 1);
      const anchorIndex = p.children.indexOf(anchor);
      if (anchorIndex === -1) {
        p.add(node);
      } else {
        p.children.splice(anchorIndex, 0, node);
        node.parent = p;
      }
    },

    removeChild(parent: Scene | Object3D, node: Object3D): void {
      const p = parent as Object3D;
      try {
        p.remove(node);
      } catch {
        const idx = p.children.indexOf(node);
        if (idx !== -1) p.children.splice(idx, 1);
        node.parent = null;
      }
    },

    setProperty(node: Object3D, key: string, value: unknown, _prevValue?: unknown): void {
      if (key === "children") return;

      // Events / DOM-only props are not applicable to the scene graph.
      if (key.startsWith("on") || key.startsWith("on:")) return;
      if (key === "style" || key === "class" || key === "className") return;

      // Transform props.
      if (key === "position") {
        toVector3(node.position, value);
        return;
      }
      if (key === "rotation") {
        toVector3(node.rotation, value);
        return;
      }
      if (key === "scale") {
        toVector3(node.scale, value);
        return;
      }
      if (key === "visible") {
        node.visible = Boolean(value);
        return;
      }
      if (key === "name") {
        node.name = String(value ?? "");
        return;
      }

      // Mesh-specific.
      if (node instanceof Mesh) {
        const mat = node.material as any;
        if (key === "geometry" && value) {
          node.geometry = value as any;
          return;
        }
        if (key === "material" && value) {
          node.material = value as any;
          return;
        }
        if (key === "color") {
          applyColor(mat?.color, value);
          return;
        }
        if (key === "emissive") {
          applyColor(mat?.emissive, value);
          return;
        }
        if (key === "roughness" && mat) {
          mat.roughness = Number(value);
          return;
        }
        if (key === "metalness" && mat) {
          mat.metalness = Number(value);
          return;
        }
        if (key === "opacity" && mat) {
          mat.opacity = Number(value);
          return;
        }
        if (key === "transparent" && mat) {
          mat.transparent = Boolean(value);
          return;
        }
      }

      // Light-specific.
      if (node instanceof AmbientLight || node instanceof DirectionalLight || node instanceof PointLight) {
        const light = node as any;
        if (key === "color") {
          applyColor(light.color, value);
          return;
        }
        if (key === "intensity") {
          light.intensity = Number(value);
          return;
        }
      }
      if (node instanceof PointLight) {
        const light = node as any;
        if (key === "distance") {
          light.distance = Number(value);
          return;
        }
        if (key === "decay") {
          light.decay = Number(value);
          return;
        }
      }

      // Camera-specific.
      if (node instanceof PerspectiveCamera) {
        const cam = node as any;
        if (key === "fov") {
          cam.fov = Number(value);
          cam.updateProjectionMatrix?.();
          return;
        }
        if (key === "aspect") {
          cam.aspect = Number(value);
          cam.updateProjectionMatrix?.();
          return;
        }
        if (key === "near") {
          cam.near = Number(value);
          cam.updateProjectionMatrix?.();
          return;
        }
        if (key === "far") {
          cam.far = Number(value);
          cam.updateProjectionMatrix?.();
          return;
        }
      }

      // Fallback: set a matching own property.
      if (key in node) {
        try {
          (node as any)[key] = value;
        } catch {
          // ignore read-only
        }
      }
    },

    disposeNode(node: Object3D): void {
      try {
        (node as any).geometry?.dispose?.();
        (node as any).material?.dispose?.();
      } catch {
        // ignore
      }
      // Dispose children recursively.
      const children = [...(node.children ?? [])];
      for (const child of children) {
        this.disposeNode?.(child);
      }
    },
  };
}