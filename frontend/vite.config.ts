import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Same shape as the deployed site: the browser calls /api on its own origin (vercel.json forwards it).
    proxy: { "/api": { target: "http://127.0.0.1:8000", changeOrigin: false } },
  },
});
