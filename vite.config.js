import { defineConfig } from 'vite';

// Keep the app and build configuration at the repository root so Vercel and
// Netlify can run `npm install` and `npm run build` without a nested root.
export default defineConfig({
  appType: 'spa',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
