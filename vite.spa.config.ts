import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import path from "path";

export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true, routesDirectory: "./src/routes", generatedRouteTree: "./src/routeTree.gen.ts" }),
    react(),
    tailwindcss(),
  ],
  resolve: { alias: { "@": path.resolve(process.cwd(), "src") } },
  build: {
    outDir: "dist-netlify",
    emptyOutDir: true,
    rollupOptions: { input: "spa-index.html" },
  },
});
