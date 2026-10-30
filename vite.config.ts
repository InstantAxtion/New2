import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1500 },
  server: {
    // In the browser, Spotify's pages can only be read through the dev server.
    // On the phone the app reads them natively.
    proxy: {
      '/proxy/spotify': {
        target: 'https://open.spotify.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/proxy\/spotify/, ''),
      },
    },
  },
});
