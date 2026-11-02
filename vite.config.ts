import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    target: "es2022",
    outDir: "public/assets",
    emptyOutDir: true,
    lib: {
      entry: "web/app.ts",
      formats: ["es"],
      fileName: "app",
      cssFileName: "app",
    },
    sourcemap: true,
  },
});
