import { defineConfig } from "vite";

export default defineConfig({
  // Compile JSX directly to Dr. UI's retained `h()` factory. This is the same
  // descriptor tree as writing `h(...)` by hand, but it reads like Solid.
  oxc: {
    jsx: {
      runtime: "classic",
      pragma: "h",
    },
  },
});
