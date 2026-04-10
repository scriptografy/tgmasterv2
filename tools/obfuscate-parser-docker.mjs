#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const IMAGE = process.env.SOFTPROG_PYARMOR_IMAGE || "python:3.10-bookworm";

function dockerSpawnFor(runArgs) {
  const custom = process.env.SOFTPROG_DOCKER?.trim();
  let prefix;
  if (custom) {
    prefix = custom.split(/\s+/).filter(Boolean);
  } else if (
    process.env.SOFTPROG_DOCKER_SUDO === "1" ||
    /^true$/i.test(process.env.SOFTPROG_DOCKER_SUDO || "")
  ) {
    prefix = ["sudo", "docker"];
  } else {
    prefix = ["docker"];
  }
  if (!prefix.length) prefix = ["docker"];
  return { file: prefix[0], args: [...prefix.slice(1), ...runArgs] };
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const parserSrc = path.join(root, "parser");

const inputs = fs
  .readdirSync(parserSrc)
  .filter((f) => f.endsWith(".py"))
  .map((f) => path.join("parser", f));

if (!inputs.length) {
  console.error("obfuscate-parser-docker: нет .py в parser/");
  process.exit(1);
}

const inner = [
  "pip install --no-cache-dir pyarmor",
  "rm -rf parser_obf",
  `pyarmor gen -O parser_obf ${inputs.join(" ")}`,
  `python -c "import sys, pathlib; pathlib.Path('parser_obf/.softprog_pyarmor_python').write_text(f'{sys.version_info[0]}.{sys.version_info[1]}')"`,
].join(" && ");

const { file, args } = dockerSpawnFor([
  "run",
  "--rm",
  "-v",
  `${root}:/work`,
  "-w",
  "/work",
  IMAGE,
  "bash",
  "-lc",
  inner,
]);

const r = spawnSync(file, args, { stdio: "inherit", cwd: root });

if (r.error) {
  console.error("obfuscate-parser-docker: docker");
  process.exit(1);
}
if (r.status !== 0) {
  process.exit(r.status ?? 1);
}
console.log("obfuscate-parser-docker: parser_obf/", IMAGE);
