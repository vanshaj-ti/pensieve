import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Real bug found live: without this, DOM from one test's render() leaks
// into the next test in the same file (no auto-cleanup import elsewhere),
// causing false positives on queryByText/getByText across tests that
// happen to render overlapping text.
afterEach(() => {
  cleanup();
});
