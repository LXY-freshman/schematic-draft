import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import { editorPreload } from "./build/editor-preload";

function isolateDevDependencyCache(): Plugin {
  return {
    name: "isolate-dev-dependency-cache",
    apply: "serve",
    config(config) {
      // A test server must not replace a running editor's optimized modules.
      // Mixing its cached eager imports with new lazy imports duplicates
      // CodeMirror's state classes and crashes Properties on selection.
      const port = config.server?.port ?? 5173;
      return {
        cacheDir: `node_modules/.vite/dev-${port}`,
        // Keep the cache owner unambiguous instead of silently changing ports.
        server: { strictPort: true },
      };
    },
  };
}

export default defineConfig({
  // The desktop shell serves the bundle from the root of its own `app://`
  // scheme, so asset references stay absolute.
  base: "/",
  plugins: [isolateDevDependencyCache(), react(), editorPreload()],
});
