import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Several tests create real git repositories; on Windows under parallel load they can exceed the
    // 5 s default, which made the gate flaky without any code problem.
    testTimeout: 20_000,
  },
});
