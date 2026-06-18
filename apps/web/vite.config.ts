import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The browser console. A plain SPA: `vite build` emits a static bundle served on
// the private network alongside the backend and workers it talks to.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 1430,
    strictPort: true,
  },
});
