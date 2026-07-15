import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Each gantry run executes in an isolated worktree under .worktrees/ that
    // contains its own copy of test/*.test.ts — without this exclude, running
    // `npm test` from the main checkout also picks up every in-flight run's
    // worktree copies, duplicating test output and slowing the suite down as
    // more runs accumulate.
    exclude: ['**/node_modules/**', '**/.worktrees/**', '**/dist/**'],
  },
});
