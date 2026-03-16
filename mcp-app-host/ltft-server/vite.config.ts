import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    target: "esnext",
    rollupOptions: {
      input: "src/app/calculator.html"
    },
    outDir: "dist/app",
    emptyOutDir: true
  }
});
