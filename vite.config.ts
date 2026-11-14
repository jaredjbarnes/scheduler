import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dts from "vite-plugin-dts";
import { defineConfig } from "vitest/config";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
  },
  build: {
    target: "es2022",
    minify: false,
    sourcemap: true,
    emptyOutDir: true,
    outDir: "dist",
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
      },
      formats: ["es"],
    },
    rollupOptions: {
      external: [/^@j13b\/state/],
      output: {
        preserveModules: true,
        preserveModulesRoot: "src",
        entryFileNames: "[name].js",
      },
    },
  },
  plugins: [
    dts({
      include: ["src/**/*"],
      exclude: ["**/*.test.ts", "**/__tests__/**"],
      rollupTypes: false,
    }),
  ],
});
