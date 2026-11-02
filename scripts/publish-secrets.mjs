import { loadEnvFile } from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

loadEnvFile(".dev.vars");
const values = {};
for (const name of ["DEEPSEEK_API_KEY", "ADMIN_PASSWORD", "APP_SECRET"]) {
  if (!process.env[name]?.trim())
    throw new Error(`Missing ${name} in .dev.vars`);
  values[name] = process.env[name];
}
const command = fileURLToPath(
  new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
);
const result = spawnSync(process.execPath, [command, "secret", "bulk"], {
  input: JSON.stringify(values),
  stdio: ["pipe", "inherit", "inherit"],
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
