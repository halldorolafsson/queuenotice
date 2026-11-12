import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    env: { LOG_LEVEL: "silent", NOTIFY_MODE: "dry-run", AUTH_MODE: "dev", PASSWORD_HASH_COST: "12" },
    testTimeout: 20000,
  },
});
