import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    fs: { allow: ['..'] },
    proxy: { '/api': 'http://127.0.0.1:8788' }, // `wrangler dev` in the other terminal
  },
});
