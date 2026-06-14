import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static gallery site. No backend: `vite build` emits a fully static bundle.
export default defineConfig({
  plugins: [react()],
});
