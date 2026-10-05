import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // OUTPUT e i dati del backend cambiano di continuo (lock, log): non vanno osservati dal frontend.
    watch: { ignored: ["**/OUTPUT/**", "**/backend/**", "**/data/**", "**/runtime/**", "**/ANDREA-BRAIN/**", "**/searxng/**", "**/scrapling/**", "**/.venv/**"] },
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
  build: {
    outDir: "dist",
    target: "es2018",
    rollupOptions: {
      output: {
        // Come manualChunks, ma senza trascinare le dipendenze dentro il gruppo:
        // altrimenti react/jsx-runtime finisce in markdown-vendor e il chunk
        // Markdown/KaTeX (lazy) verrebbe caricato comunque all'apertura.
        codeSplitting: {
          includeDependenciesRecursively: false,
          groups: [{
            name(id: string) {
              if (!id.includes("node_modules")) return undefined;
              if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "react-vendor";
              if (/[\\/]node_modules[\\/](react-markdown|remark-|rehype-|unified|micromark|mdast|hast|katex)/.test(id)) return "markdown-vendor";
              if (id.includes("lucide-react")) return "icons-vendor";
              return "vendor";
            },
          }],
        },
      },
    },
  },
});
