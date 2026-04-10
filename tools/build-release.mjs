#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(root, "release");
const obfMarker = path.join(root, "parser_obf", "telethon_parser.py");
const releaseLicenseApiUrl = String(process.env.SOFTPROG_LICENSE_API_URL || "http://5.42.122.59:8090").trim();
const releaseLicenseApiKey = String(process.env.SOFTPROG_LICENSE_API_KEY || "release-inline-key").trim();

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    cwd: opts.cwd ?? root,
    env: { ...process.env, ...opts.env },
  });
  if (r.error) {
    console.error(`build-release: не удалось запустить ${cmd}`);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (!existsSync(obfMarker)) {
  console.error("build-release: нет parser_obf/telethon_parser.py");
  process.exit(1);
}

console.log("build-release: vite build…");
run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], { cwd: root });

const distSrc = path.join(root, "dist");
if (!existsSync(path.join(distSrc, "index.html"))) {
  console.error("build-release: нет dist/index.html");
  process.exit(1);
}

console.log("build-release: release/…");
rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });

cpSync(distSrc, path.join(releaseDir, "dist"), { recursive: true });
cpSync(path.join(root, "server"), path.join(releaseDir, "server"), { recursive: true });
cpSync(path.join(root, "parser_obf"), path.join(releaseDir, "parser_obf"), { recursive: true });
const releaseMarker = path.join(releaseDir, "parser_obf", ".softprog_pyarmor_python");
if (!existsSync(releaseMarker)) {
  // Release Dockerfile uses python:3.10 for pyvenv/runtime.
  writeFileSync(releaseMarker, "3.10\n", "utf8");
}

cpSync(path.join(root, "package-lock.json"), path.join(releaseDir, "package-lock.json"));

const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
pkg.scripts = {
  start: "node start.mjs",
  "verify-dist": "node tools/assert-dist-accounts-detailed.mjs",
};
writeFileSync(path.join(releaseDir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

cpSync(path.join(root, "tools", "release-start.mjs"), path.join(releaseDir, "start.mjs"));
cpSync(path.join(root, "docker"), path.join(releaseDir, "docker"), { recursive: true });

mkdirSync(path.join(releaseDir, "data"), { recursive: true });
mkdirSync(path.join(releaseDir, "sessions"), { recursive: true });
writeFileSync(path.join(releaseDir, "sessions", ".gitkeep"), "", "utf8");

mkdirSync(path.join(releaseDir, "tools"), { recursive: true });
cpSync(
  path.join(root, "tools", "assert-dist-accounts-detailed.mjs"),
  path.join(releaseDir, "tools", "assert-dist-accounts-detailed.mjs"),
);

cpSync(path.join(root, "parser", "requirements.txt"), path.join(releaseDir, "parser-requirements.txt"));

const obfReq = path.join(root, "parser", "requirements-obfuscate.txt");
if (existsSync(obfReq)) {
  cpSync(obfReq, path.join(releaseDir, "parser-requirements-obfuscate.txt"));
}

console.log("build-release: npm ci --omit=dev в release/…");
run(process.platform === "win32" ? "npm.cmd" : "npm", ["ci", "--omit=dev"], { cwd: releaseDir });

const dockerfile = `FROM python:3.10-bookworm AS pydeps
WORKDIR /tmp
COPY parser-requirements.txt ./requirements.txt
RUN python -m pip install --no-cache-dir -r requirements.txt

FROM node:20-bookworm AS prod_deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-bookworm
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \\
  && apt-get install -y --no-install-recommends tor obfs4proxy \\
  && rm -rf /var/lib/apt/lists/*
COPY --from=prod_deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY server ./server
COPY dist ./dist
COPY parser_obf ./parser_obf
COPY parser-requirements.txt ./parser-requirements.txt
COPY docker/torrc /etc/tor/torrc
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY --from=pydeps /usr/local /usr/local
ENV PYTHONUNBUFFERED=1
ENV TELETHON_PYTHON=/usr/local/bin/python3.10
ENV SOFTPROG_PARSER_DIR=parser_obf
RUN chmod +x /usr/local/bin/entrypoint.sh \\
  && mkdir -p /app/data /app/sessions /app/tor-data \\
  && chown -R node:node /app
USER node
EXPOSE 8787
CMD ["/usr/local/bin/entrypoint.sh"]
`;

const compose = `services:
  softprog:
    build: .
    image: softprog:release
    ports:
      - "8787:8787"
    environment:
      NODE_ENV: production
      PORT: "8787"
      TELETHON_BACKEND_URL: http://127.0.0.1:8787
      TELETHON_PYTHON: /usr/local/bin/python3.10
      SOFTPROG_LICENSE_API_URL: ${releaseLicenseApiUrl}
      SOFTPROG_LICENSE_USAGE_URL: ${releaseLicenseApiUrl}
      SOFTPROG_LICENSE_API_KEY: ${releaseLicenseApiKey}
    volumes:
      - softprog-data:/app/data
      - softprog-sessions:/app/sessions

volumes:
  softprog-data:
  softprog-sessions:
`;

const dockerignore = `node_modules
data
sessions
.git
*.log
`;

writeFileSync(path.join(releaseDir, "Dockerfile"), dockerfile, "utf8");
writeFileSync(path.join(releaseDir, "docker-compose.yml"), compose, "utf8");
writeFileSync(path.join(releaseDir, ".dockerignore"), dockerignore, "utf8");

console.log("build-release:", releaseDir);
