import { defineConfig } from 'vitest/config';

// Coverage thresholds prevent regression - CI will fail if coverage drops
// Co-authored with Claude
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/utils.ts'], // Pure functions - fully testable
      exclude: [
        'src/extension.ts', // UI code - requires GNOME Shell
        'src/prefs.ts',     // UI code - requires GTK
        'src/manager.ts',   // Tested via mocks in manager.test.ts
        'src/history.ts',   // I/O code - tested via mocks
      ],
      reporter: ['text', 'text-summary'],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 90,
        statements: 95,
      },
    },
  },
});
