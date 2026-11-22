import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Config for `pnpm verify:motion`: the full motion validation suite.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["kinematics-verify/**/*.test.ts"],
    testTimeout: 120000,
  },
});
