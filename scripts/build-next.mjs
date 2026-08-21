import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const env = { ...process.env };
delete env.TURBOPACK;
delete env.NEXT_TURBOPACK;
env.HOME = projectRoot;
env.USERPROFILE = projectRoot;

const child = spawn("npx", ["next", "build", "--webpack"], {
  cwd: projectRoot,
  env,
  shell: process.platform === "win32",
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
