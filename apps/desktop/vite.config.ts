import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri-friendly Vite config: a fixed dev port the Tauri shell expects, and a
// quiet console so Tauri's own output is not obscured during development.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
});
