import path from "path";
import { webcrypto } from "node:crypto";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite 5 expects Web Crypto on globalThis. Node 16 exposes it via node:crypto.webcrypto
// but does not always wire it to the global object.
if (!globalThis.crypto?.getRandomValues) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname),
  server: {
    host: "0.0.0.0",
    port: 5178,
    proxy: {
      "/api": {
        target: "http://localhost:4318",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist/client"),
    emptyOutDir: true,
  },
});
