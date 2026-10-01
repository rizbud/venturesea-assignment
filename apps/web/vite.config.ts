import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    outDir: "dist",
    // Off: dist/ is published as-is, so a map would serve the full source.
    // Upload hidden maps to the error tracker instead once one exists.
    sourcemap: false,
  },
});
