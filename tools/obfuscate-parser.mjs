#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const parserSrc = path.join(root, "parser");

const inputs = fs
  .readdirSync(parserSrc)
  .filter((f) => f.endsWith(".py"))
  .map((f) => path.join("parser", f));

if (!inputs.length) {
  console.error("obfuscate-parser: нет .py в parser/");
  process.exit(1);
}

const outDir = path.join(root, "parser_obf");
fs.rmSync(outDir, { recursive: true, force: true });

const home = process.env.HOME || process.env.USERPROFILE || "";
const localBin = home ? path.join(home, ".local", "bin") : "";
const sep = path.delimiter;
const childEnv = {
  ...process.env,
  PATH: localBin ? `${localBin}${sep}${process.env.PATH || ""}` : process.env.PATH,
};

const r = spawnSync("pyarmor", ["gen", "-O", "parser_obf", ...inputs], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: childEnv,
});

if (r.error) {
  console.error("obfuscate-parser: pyarmor не найден");
  process.exit(1);
}
if (r.status !== 0) {
  process.exit(r.status ?? 1);
}
const pyForVer = process.env.PYTHON?.trim() || (process.platform === "win32" ? "python" : "python3");
const vr = spawnSync(pyForVer, ["-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"], {
  cwd: root,
  encoding: "utf8",
  env: childEnv,
});
if (vr.status === 0 && vr.stdout?.trim()) {
  fs.writeFileSync(path.join(root, "parser_obf", ".softprog_pyarmor_python"), `${vr.stdout.trim()}\n`, "utf8");
}
console.log("obfuscate-parser: parser_obf/");
