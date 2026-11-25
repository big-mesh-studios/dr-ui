import {
  Fragment,
  createUniversalRuntime,
  h,
} from "@big-mesh-studios/dr-ui";
import { createRmslBackend } from "@big-mesh-studios/dr-ui-rmsl";
import {
  Mesh,
  PerspectiveCamera,
  WebGLRenderer,
} from "@random-mesh/rmsl/scene";

interface Planet {
  name: string;
  radius: number;
  distance: number;
  speed: number;
  color: number;
  mesh: Mesh | null;
}

const planets: Planet[] = [
  { name: "Mercury", radius: 0.4, distance: 6, speed: 4.1, color: 0xb0b0b0, mesh: null },
  { name: "Venus", radius: 0.9, distance: 9, speed: 1.6, color: 0xe8cda2, mesh: null },
  { name: "Earth", radius: 1.0, distance: 13, speed: 1.0, color: 0x3b82f6, mesh: null },
  { name: "Mars", radius: 0.55, distance: 17, speed: 0.53, color: 0xd97706, mesh: null },
  { name: "Jupiter", radius: 2.2, distance: 24, speed: 0.084, color: 0xf59e0b, mesh: null },
  { name: "Saturn", radius: 1.9, distance: 32, speed: 0.034, color: 0xfacc15, mesh: null },
];

let sunMesh: Mesh | null = null;

function App() {
  return h(
    Fragment,
    null,
    <ambientLight intensity={0.15} color={0xffffff} />,
    <directionalLight position={[10, 12, 8]} intensity={2.2} color={0xfff3e0} />,
    <sphere
      radius={2.6}
      color={0xffcc33}
      emissive={0xffaa00}
      handle={(node: unknown) => {
        sunMesh = node as Mesh;
      }}
    />,
    <group>
      {planets.map((planet) => (
        <sphere
          key={planet.name}
          radius={planet.radius}
          color={planet.color}
          handle={(node: unknown) => {
            planet.mesh = node as Mesh;
          }}
        />
      ))}
    </group>,
  );
}

const backend = createRmslBackend();
const runtime = createUniversalRuntime(backend);
runtime.mount(h(App));

const scene = runtime.root as any;
const camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(0, 40, 90);
camera.lookAt(0, 0, 0);

const canvas = document.createElement("canvas");
document.body.appendChild(canvas);
const renderer = new WebGLRenderer(canvas);
renderer.setClearColor(0x050814);
renderer.setSize(window.innerWidth, window.innerHeight);

function animate(time: number): void {
  if (sunMesh) sunMesh.rotation.y = time * 0.0004;

  for (const planet of planets) {
    if (!planet.mesh) continue;
    const angle = time * 0.0005 * planet.speed;
    planet.mesh.position.x = Math.cos(angle) * planet.distance;
    planet.mesh.position.z = Math.sin(angle) * planet.distance;
    planet.mesh.rotation.y += 0.02;
  }

  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix?.();
  renderer.setSize(window.innerWidth, window.innerHeight);
});