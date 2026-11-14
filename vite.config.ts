import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "Scheduler",
      fileName: "index",
      formats: ["es"],
    },
    rollupOptions: {
      external: [/^@j13b\/state/],
    },
  },
});
