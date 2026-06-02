import webExtension from "vite-plugin-web-extension";
import { defineConfig } from "vitest/config";

// `vitest` runs with mode "test" by default, so the web-extension plugin is
// skipped there — unit tests target the shared/content logic and must not
// require a built MV3 manifest. `vite build` / `vite dev` use "production" /
// "development" and keep the plugin to emit the unpacked extension.
export default defineConfig(({ mode }) => ({
  plugins: mode === "test" ? [] : [webExtension({ manifest: "src/manifest.json" })],
  oxc: {
    // Vite 8 transpiles with Oxc (not esbuild); configure Preact JSX here so we
    // avoid an extra preset dependency (overview.md §11).
    jsx: {
      runtime: "automatic",
      importSource: "preact",
    },
  },
  test: {
    environment: "happy-dom",
    include: ["tests/**/*.test.ts"],
  },
}));
