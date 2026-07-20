import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/.worktrees/**', '**/dist/**'],
    environment: 'node',
    environmentMatchGlobs: [['src/dashboard/frontend/**', 'jsdom']],
    setupFiles: ['src/dashboard/frontend/vitest.setup.ts'],
  },
});
