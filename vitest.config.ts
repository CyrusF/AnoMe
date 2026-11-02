import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          DEEPSEEK_API_KEY: "test-only-not-a-real-key",
          ADMIN_PASSWORD: "test-password",
          APP_SECRET: "test-only-application-secret",
          TEST_MIGRATIONS: await readD1Migrations("./migrations"),
        },
      },
    }),
  ],
  test: {
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    onConsoleLog: () => false,
  },
});
