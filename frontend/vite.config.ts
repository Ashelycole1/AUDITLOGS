import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Vite runs this file in Node; declared here instead of adding @types/node as a dependency.
declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Same shape as the deployed site: the browser calls /api on its own origin (vercel.json forwards it).
    // VITE_API_PROXY points at the API container under docker-compose.dev.yml.
    proxy: { "/api": { target: process.env.VITE_API_PROXY ?? "http://127.0.0.1:8000", changeOrigin: false } },
  },
});
