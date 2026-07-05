import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({ globals: { Buffer: true, process: true, global: true } }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://api:3000", changeOrigin: true },
      "/socket.io": { target: "http://api:3000", ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    commonjsOptions: { transformMixedEsModules: true },
  },
});
