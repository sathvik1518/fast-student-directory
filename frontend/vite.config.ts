import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The page asks /api/... on its own address; this proxy forwards it to the Python server. Same origin, so no CORS.
const api = { "/api": { target: "http://127.0.0.1:8000", changeOrigin: false } };

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true, proxy: api },
  preview: { port: 4173, strictPort: true, proxy: api },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
