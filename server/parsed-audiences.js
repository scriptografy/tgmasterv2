import fs from "fs";
import path from "path";

export function audiencesRoot(dataDir) {
  return path.join(dataDir, "parsed_audiences");
}

export function slugFromSourceLink(sourceLink) {
  const raw = String(sourceLink || "").trim();
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    let s = `${u.hostname}${u.pathname}`.replace(/^www\./, "");
    s = s.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
    return s.slice(0, 100) || "chat";
  } catch {
    return raw.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 100) || "chat";
  }
}

export function newAudienceDirBase(sourceLink, periodDays) {
  const base = slugFromSourceLink(sourceLink);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${base}_d${periodDays}_${stamp}`;
}

export function ensureUniqueDir(parent, name) {
  let dir = name;
  let i = 0;
  while (fs.existsSync(path.join(parent, dir))) {
    i += 1;
    dir = `${name}__${i}`;
  }
  return dir;
}

export function startAudienceFolder(dataDir, opts) {
  const root = audiencesRoot(dataDir);
  fs.mkdirSync(root, { recursive: true });
  const baseName = newAudienceDirBase(opts.sourceLink, opts.periodDays);
  const dirName = ensureUniqueDir(root, baseName);
  const fullPath = path.join(root, dirName);
  fs.mkdirSync(fullPath, { recursive: true });
  const meta = {
    id: dirName,
    sourceLink: opts.sourceLink,
    periodDays: opts.periodDays,
    premiumFilter: opts.premiumFilter,
    variant: opts.variant,
    startedAt: opts.startedAt,
    userCount: 0,
    status: "running",
  };
  fs.writeFileSync(path.join(fullPath, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(fullPath, "users.jsonl"), "", "utf8");
  return { dirName, fullPath };
}

export function appendAudienceUsers(fullPath, rows) {
  if (!fullPath || !rows?.length) return;
  const f = path.join(fullPath, "users.jsonl");
  const chunk = rows.map((r) => `${JSON.stringify(r)}\n`).join("");
  fs.appendFileSync(f, chunk, "utf8");
}

export function countUsersJsonl(fullPath) {
  const f = path.join(fullPath, "users.jsonl");
  if (!fs.existsSync(f)) return 0;
  const c = fs.readFileSync(f, "utf8");
  if (!c.trim()) return 0;
  return c.trim().split("\n").length;
}

export function finalizeAudienceFolder(fullPath, status) {
  if (!fullPath || !fs.existsSync(fullPath)) return;
  const metaPath = path.join(fullPath, "meta.json");
  let meta = {};
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  } catch {
    meta = { id: path.basename(fullPath) };
  }
  meta.userCount = countUsersJsonl(fullPath);
  meta.status = status;
  meta.finishedAt = new Date().toISOString();
  fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
}

export function safeAudienceId(id) {
  const s = String(id || "").trim();
  if (!s || s.includes("..") || !/^[a-zA-Z0-9._-]+$/.test(s)) return null;
  return s;
}

export function listAudiences(dataDir) {
  const root = audiencesRoot(dataDir);
  if (!fs.existsSync(root)) return [];
  const names = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const out = [];
  for (const id of names) {
    const metaPath = path.join(root, id, "meta.json");
    if (!fs.existsSync(metaPath)) continue;
    try {
      const m = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      const liveCount = countUsersJsonl(path.join(root, id));
      out.push({
        ...m,
        id,
        userCount: m.status === "running" ? liveCount : m.userCount ?? liveCount,
      });
    } catch {
      continue;
    }
  }
  out.sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")));
  return out;
}

export function rowToRecipient(row) {
  const u = String(row.username || "").trim();
  if (u) return u.startsWith("@") ? u : `@${u}`;
  const id = String(row.external_id || "").trim();
  return id || "";
}

export function readAudienceRecipients(dataDir, id, limit = 100000) {
  const safe = safeAudienceId(id);
  if (!safe) return [];
  const root = audiencesRoot(dataDir);
  const file = path.join(root, safe, "users.jsonl");
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf8");
  const lines = text.trim() ? text.trim().split("\n") : [];
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const key = `${row.external_id || ""}|${row.username || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const r = rowToRecipient(row);
    if (r) out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}
