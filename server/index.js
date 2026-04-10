import cors from "cors";
import AdmZip from "adm-zip";
import express from "express";
import fs from "fs";
import multer from "multer";
import net from "net";
import path from "path";
import { spawn, spawnSync } from "child_process";
import { db, dbPath, dataDir, sessionsDir } from "./db.js";
import {
  appendAudienceUsers,
  finalizeAudienceFolder,
  listAudiences,
  readAudienceRecipients,
  startAudienceFolder,
} from "./parsed-audiences.js";
import { getTelegramScripts } from "./telegram/scripts.js";
import { runPythonJson, resolvePythonExecutable } from "./telegram/python.js";
import { createTelegramState } from "./telegram/state.js";
import { getAccountProfile } from "./telegram/profile.js";

const app = express();
const PORT = Number(process.env.PORT || 8787);
const TELETHON_BACKEND_URL = process.env.TELETHON_BACKEND_URL || `http://127.0.0.1:${PORT}`;

const resolveStaticRoot = () => {
  const cwd = process.cwd();
  if (process.env.STATIC_DIR) return path.resolve(cwd, process.env.STATIC_DIR);
  const asBundle = path.join(cwd, "public");
  const asRepo = path.join(cwd, "dist");
  if (fs.existsSync(path.join(asBundle, "index.html"))) return asBundle;
  if (fs.existsSync(path.join(asRepo, "index.html"))) return asRepo;
  return asRepo;
};
const staticRoot = resolveStaticRoot();

const serveStatic =
  process.env.NODE_ENV === "production" || process.env.SERVE_DIST === "1";

app.use(cors());
app.use(express.json({ limit: "80mb" }));
const upload = multer({ limits: { fileSize: 70 * 1024 * 1024 } });

app.use((req, res, next) => {
  if (req.path.startsWith("/api")) {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
  }
  next();
});

app.use(async (req, res, next) => {
  if (!req.path.startsWith("/api")) return next();
  if (
    req.path === "/api/health" ||
    req.path === "/api/license/status" ||
    req.path === "/api/license/unlock" ||
    req.path === "/api/license/disable"
  ) {
    return next();
  }
  if (!licenseState.unlocked) {
    await tryAutoUnlockFromStoredKey();
  }
  if (licenseState.unlocked) return next();
  return res.status(423).json({
    error: "Приложение заблокировано: введите лицензионный ключ",
    code: "LICENSE_REQUIRED",
  });
});

if (serveStatic) {
  app.use(async (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    if (!licenseState.unlocked) {
      await tryAutoUnlockFromStoredKey();
    }
    if (licenseState.unlocked) return next();
    if (req.method !== "GET" && req.method !== "HEAD") {
      return res.status(423).type("text/plain").send("License required");
    }
    return res.status(423).type("html").send(`<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Лицензия требуется</title>
  <style>
    body { margin:0; background:#0b1220; color:#e5e7eb; font-family:Arial,sans-serif; }
    .wrap { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:20px; }
    .card { width:100%; max-width:520px; background:#111b33; border:1px solid #223056; border-radius:12px; padding:20px; }
    input,button { width:100%; box-sizing:border-box; padding:12px; border-radius:8px; border:1px solid #2d3f70; }
    input { background:#0a1329; color:#fff; margin:12px 0; }
    button { background:#2563eb; color:#fff; cursor:pointer; }
    .muted { color:#9ca3af; font-size:13px; margin-top:10px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h2 style="margin-top:0;">Доступ к панели заблокирован</h2>
      <p>Введите лицензионный ключ для активации.</p>
      <input id="key" placeholder="Лицензионный ключ" />
      <button id="btn">Активировать</button>
      <div id="out" class="muted"></div>
    </div>
  </div>
  <script>
    const out = document.getElementById("out");
    document.getElementById("btn").onclick = async () => {
      const password = document.getElementById("key").value.trim();
      if (!password) { out.textContent = "Введите ключ."; return; }
      out.textContent = "Проверка...";
      try {
        const r = await fetch("/api/license/unlock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password })
        });
        const j = await r.json();
        if (!r.ok || !j.ok) { out.textContent = j.error || "Ключ не принят"; return; }
        out.textContent = "Лицензия активирована. Перезагрузка...";
        setTimeout(() => location.reload(), 600);
      } catch (e) {
        out.textContent = "Ошибка сети";
      }
    };
  </script>
</body>
</html>`);
  });
}

const nowIso = () => new Date().toISOString();
const rootDir = path.resolve(process.cwd());
const licenseScript = path.join(rootDir, "server", "license_check.py");
const LICENSE_BOT_API_URL = String(
  process.env.SOFTPROG_LICENSE_API_URL || process.env.SOFTPROG_LICENSE_USAGE_URL || "http://5.42.122.59:8090",
)
  .trim()
  .replace(/\/+$/, "");
const LICENSE_API_KEY = String(process.env.SOFTPROG_LICENSE_API_KEY || "").trim();
const licenseState = { unlocked: process.env.SOFTPROG_DISABLE_LICENSE === "1" };
const {
  parserScript,
  botParserScript,
  authScript,
  mailingScript,
  profileScript,
  spambotScript,
  reactionsScript,
  messagesScript,
  exitIpScript,
  proxyExitIpScript,
} = getTelegramScripts(rootDir);

const mapProxy = (row) => ({
  ...row,
  enabled: Boolean(row.enabled),
});

const parseProxyLine = (line) => {
  const parts = line.split(":").map((x) => x.trim());
  if (parts.length < 2) return null;
  const [host, portRaw, third = "", fourth = "", fifth = ""] = parts;
  const port = Number(portRaw);
  if (!host || !Number.isInteger(port) || port <= 0) return null;
  const authFlag = String(third || "").toLowerCase();
  if (authFlag === "true" || authFlag === "false") {
    const login = authFlag === "true" ? fourth : "";
    const pass = authFlag === "true" ? fifth : "";
    return { host, port, login, pass };
  }
  return { host, port, login: third || "", pass: fourth || "" };
};

const tokenAlias = (token) => {
  const t = String(token || "").trim();
  const p = t.split(":")[0] || "";
  return p ? `bot_${p}` : "bot_unknown";
};

const botApiCall = async (botToken, method, payload = {}) => {
  const token = String(botToken || "").trim();
  if (!token) throw new Error("botToken is required");
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    throw new Error(String(json?.description || `Telegram API error: ${res.status}`));
  }
  return json.result;
};

const normalizeInviteLink = (url) => {
  let s = String(url || "").trim();
  if (!s) return "";
  s = s.replace(/^http:\/\//i, "https://");
  return s;
};

const autoInviteName = ({ chatTitle = "", index = 1 } = {}) => {
  const base = String(chatTitle || "channel")
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20) || "channel";
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
  const n = Math.max(1, Number(index) || 1);
  return `${base}-${stamp}-${String(n).padStart(2, "0")}`;
};

const resolveChatForInvite = async (botToken, input) => {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("Укажите канал (@username, t.me/… или числовой ID)");
  let chatIdParam = raw;
  if (!/^-?\d+$/.test(raw)) {
    let u = raw.replace(/^https?:\/\//i, "");
    const m = u.match(/t\.me\/([^/?#]+)/i);
    if (m) u = m[1];
    u = u.replace(/^@+/, "").trim();
    if (!u) throw new Error("Не удалось распознать канал");
    chatIdParam = `@${u}`;
  }
  const chat = await botApiCall(botToken, "getChat", { chat_id: chatIdParam });
  const id = chat?.id;
  if (id == null) throw new Error("Пустой ответ getChat");
  const title = String(chat.title || chat.username || chat.first_name || "").trim();
  return { chat_id: String(id), chat_title: title || chatIdParam };
};

const buildAudienceSourceFromChat = async (botToken, channelId, fallback = "") => {
  const cid = String(channelId || "").trim();
  const fb = String(fallback || "").trim() || `channel_id_${cid}`;
  if (!cid) return fb;
  try {
    const chat = await botApiCall(botToken, "getChat", { chat_id: cid });
    const title = String(chat?.title || chat?.username || chat?.first_name || "").trim();
    if (!title) return fb;
    return `channel_${title}`;
  } catch {
    return fb;
  }
};

const saveInviteLinkRow = (row) => {
  db.prepare(
    `INSERT INTO bot_invite_links
      (invite_link, bot_name, chat_id, chat_title, name, creates_join_request, expire_date, member_limit, join_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?,0), ?, ?)
     ON CONFLICT(invite_link) DO UPDATE SET
       bot_name = excluded.bot_name,
       chat_id = excluded.chat_id,
       chat_title = COALESCE(NULLIF(TRIM(excluded.chat_title), ''), bot_invite_links.chat_title),
       name = excluded.name,
       creates_join_request = excluded.creates_join_request,
       expire_date = excluded.expire_date,
       member_limit = excluded.member_limit,
       updated_at = excluded.updated_at`,
  ).run(
    normalizeInviteLink(row.invite_link),
    String(row.bot_name || ""),
    String(row.chat_id || ""),
    String(row.chat_title || ""),
    String(row.name || ""),
    row.creates_join_request ? 1 : 0,
    row.expire_date || null,
    row.member_limit || null,
    Number(row.join_count) || 0,
    nowIso(),
    nowIso(),
  );
};

const bumpInviteJoin = ({ inviteLink, userId, chatId, updateId, botName, user = {} }) => {
  const il = normalizeInviteLink(inviteLink);
  if (!il) return false;
  const username = String(user?.username || "").trim();
  const firstName = String(user?.first_name || user?.firstName || "").trim();
  const lastName = String(user?.last_name || user?.lastName || "").trim();
  const isPremium = user?.is_premium ? 1 : 0;
  const existing = db
    .prepare("SELECT username, first_name, last_name, is_premium FROM bot_invite_joins WHERE invite_link = ? AND user_id = ? LIMIT 1")
    .get(il, String(userId));
  const inserted = db
    .prepare(
      `INSERT INTO bot_invite_joins
       (invite_link, user_id, chat_id, update_id, username, first_name, last_name, is_premium, joined_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(invite_link, user_id) DO UPDATE SET
         chat_id = COALESCE(NULLIF(excluded.chat_id, ''), bot_invite_joins.chat_id),
         update_id = COALESCE(excluded.update_id, bot_invite_joins.update_id),
         username = COALESCE(NULLIF(excluded.username, ''), bot_invite_joins.username),
         first_name = COALESCE(NULLIF(excluded.first_name, ''), bot_invite_joins.first_name),
         last_name = COALESCE(NULLIF(excluded.last_name, ''), bot_invite_joins.last_name),
         is_premium = CASE WHEN excluded.is_premium = 1 THEN 1 ELSE bot_invite_joins.is_premium END`,
    )
    .run(il, String(userId), String(chatId || ""), updateId ?? null, username, firstName, lastName, isPremium, nowIso());
  if (!inserted.changes) return false;
  db.prepare(
    `INSERT INTO bot_invite_links (invite_link, bot_name, chat_id, name, join_count, created_at, updated_at)
     VALUES (?, ?, ?, '', 1, ?, ?)
     ON CONFLICT(invite_link) DO UPDATE SET
       join_count = COALESCE(join_count, 0) + 1,
       updated_at = excluded.updated_at`,
  ).run(il, String(botName || ""), String(chatId || ""), nowIso(), nowIso());
  return !existing;
};

const refreshInviteMetadata = async (botToken, { profileLimit = 200, titleLimit = 100 } = {}) => {
  let profilesUpdated = 0;
  let titlesUpdated = 0;
  const chats = db
    .prepare(
      `SELECT DISTINCT chat_id
       FROM bot_invite_links
       WHERE TRIM(COALESCE(chat_id, '')) <> ''
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(Math.max(1, Number(titleLimit) || 100));
  for (const row of chats) {
    const chatId = String(row?.chat_id || "").trim();
    if (!chatId) continue;
    try {
      const chat = await botApiCall(botToken, "getChat", { chat_id: chatId });
      const chatTitle = String(chat?.title || chat?.username || chat?.first_name || "").trim();
      if (!chatTitle) continue;
      const r = db
        .prepare("UPDATE bot_invite_links SET chat_title = ?, updated_at = ? WHERE chat_id = ? AND TRIM(COALESCE(chat_title, '')) <> ?")
        .run(chatTitle, nowIso(), chatId, chatTitle);
      titlesUpdated += Number(r?.changes || 0);
    } catch {
      // skip inaccessible chats
    }
  }

  const users = db
    .prepare(
      `SELECT invite_link, user_id, chat_id
       FROM bot_invite_joins
       WHERE TRIM(COALESCE(chat_id, '')) <> ''
         AND (TRIM(COALESCE(username, '')) = '' OR TRIM(COALESCE(first_name, '')) = '' OR TRIM(COALESCE(last_name, '')) = '')
       ORDER BY joined_at DESC
       LIMIT ?`,
    )
    .all(Math.max(1, Number(profileLimit) || 200));
  for (const u of users) {
    const chatId = String(u?.chat_id || "").trim();
    const userId = String(u?.user_id || "").trim();
    if (!chatId || !userId) continue;
    try {
      const member = await botApiCall(botToken, "getChatMember", { chat_id: chatId, user_id: userId });
      const usr = member?.user || {};
      const username = String(usr?.username || "").trim();
      const firstName = String(usr?.first_name || usr?.firstName || "").trim();
      const lastName = String(usr?.last_name || usr?.lastName || "").trim();
      const isPremium = usr?.is_premium ? 1 : 0;
      const r = db
        .prepare(
          `UPDATE bot_invite_joins
           SET username = COALESCE(NULLIF(?, ''), username),
               first_name = COALESCE(NULLIF(?, ''), first_name),
               last_name = COALESCE(NULLIF(?, ''), last_name),
               is_premium = CASE WHEN ? = 1 THEN 1 ELSE is_premium END
           WHERE invite_link = ? AND user_id = ?`,
        )
        .run(username, firstName, lastName, isPremium, String(u.invite_link || ""), userId);
      profilesUpdated += Number(r?.changes || 0);
    } catch {
      // user may be unavailable/restricted
    }
  }

  return { profilesUpdated, titlesUpdated, profilesChecked: users.length, chatsChecked: chats.length };
};

const revokeAndDeleteInviteLinks = async (botToken, rows = []) => {
  let revoked = 0;
  let removed = 0;
  let alreadyInvalid = 0;
  const failed = [];
  for (const r of rows) {
    const inviteLink = normalizeInviteLink(r?.invite_link);
    const chatId = String(r?.chat_id || "").trim();
    if (!inviteLink || !chatId) continue;
    let canDelete = false;
    try {
      await botApiCall(botToken, "revokeChatInviteLink", { chat_id: chatId, invite_link: inviteLink });
      revoked += 1;
      canDelete = true;
    } catch (err) {
      const msg = String(err?.message || err || "");
      const mayAlreadyInvalid = /EXPIRED|REVOKE|INVITE_HASH|not found|invalid/i.test(msg);
      if (mayAlreadyInvalid) {
        alreadyInvalid += 1;
        canDelete = true;
      } else {
        failed.push({ invite_link: inviteLink, chat_id: chatId, error: msg });
      }
    }
    if (canDelete) {
      const tx = db.transaction(() => {
        db.prepare("DELETE FROM bot_invite_joins WHERE invite_link = ?").run(inviteLink);
        return db.prepare("DELETE FROM bot_invite_links WHERE invite_link = ?").run(inviteLink);
      });
      const res = tx();
      removed += Number(res?.changes || 0);
    }
  }
  return { revoked, removed, alreadyInvalid, failed };
};

const runLicenseCheck = (password, checkOnly = false) => {
  const candidates = [
    process.env.TELETHON_PYTHON,
    process.env.PYTHON,
    "python3.10",
    "python3",
    "python",
  ].filter(Boolean);
  for (const cmd of candidates) {
    const args = ["-u", licenseScript, "--password", String(password || "")];
    if (checkOnly) args.push("--check-only");
    const r = spawnSync(cmd, args, {
      encoding: "utf8",
      timeout: 8000,
      env: process.env,
      windowsHide: process.platform === "win32",
    });
    if (r.error || r.signal || r.status !== 0) continue;
    try {
      const parsed = JSON.parse(String(r.stdout || "{}").trim() || "{}");
      return {
        ok: Boolean(parsed?.ok),
        message: String(parsed?.message || (parsed?.ok ? "ok" : "invalid")),
        expiresAt: parsed?.expires_at ? String(parsed.expires_at) : "",
        licenseKey: parsed?.license_key ? String(parsed.license_key) : "",
        boundIp: parsed?.bound_ip ? String(parsed.bound_ip) : "",
      };
    } catch {}
  }
  return { ok: false, message: "Не удалось выполнить проверку лицензии (python недоступен)." };
};

const runLicenseCheckRemote = async (password) => {
  const key = String(password || "").trim();
  if (!key) return { ok: false, message: "Введите лицензионный ключ" };
  try {
    const res = await fetch(`${LICENSE_BOT_API_URL}/licenses/${encodeURIComponent(key)}`, {
      method: "GET",
      headers: LICENSE_API_KEY ? { "X-API-Key": LICENSE_API_KEY } : {},
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, message: String(payload?.detail || "Неверный лицензионный ключ") };
    }
    const status = String(payload?.status || "").toLowerCase();
    if (status !== "active") {
      return { ok: false, message: "Лицензия не активна" };
    }
    return {
      ok: true,
      message: "Лицензия активирована",
      expiresAt: payload?.expires_at ? String(payload.expires_at) : "",
      licenseKey: payload?.license_key ? String(payload.license_key) : key,
      boundIp: "",
    };
  } catch {
    return { ok: false, message: "Сервер лицензий недоступен" };
  }
};

const autoUnlockState = { inFlight: null, lastTryMs: 0 };
const getStoredLicenseKey = () => {
  const primary = String(getSetting("license_active_key", "") || "").trim();
  if (primary) return primary;
  const legacy = String(getSetting("license_last_key", "") || "").trim();
  return legacy;
};

const tryAutoUnlockFromStoredKey = async () => {
  if (licenseState.unlocked) return true;
  const now = Date.now();
  if (autoUnlockState.inFlight) return autoUnlockState.inFlight;
  if (now - autoUnlockState.lastTryMs < 2500) return false;
  autoUnlockState.lastTryMs = now;
  const activeKey = getStoredLicenseKey();
  if (!activeKey) return false;
  autoUnlockState.inFlight = (async () => {
    let checked = await runLicenseCheckRemote(activeKey);
    if (!checked.ok) {
      checked = runLicenseCheck(activeKey, true);
    }
    if (!checked.ok) {
      licenseState.unlocked = false;
      setSetting("license_unlocked", "0");
      return false;
    }
    licenseState.unlocked = true;
    setSetting("license_unlocked", "1");
    setSetting("license_revoked_at", "");
    if (checked.expiresAt) setSetting("license_expires_at", checked.expiresAt);
    if (checked.licenseKey) setSetting("license_key_masked", String(checked.licenseKey).slice(-4));
    return true;
  })();
  try {
    return await autoUnlockState.inFlight;
  } finally {
    autoUnlockState.inFlight = null;
  }
};

const logEvent = (message) => {
  db.prepare("INSERT INTO system_events (message, created_at) VALUES (?, ?)").run(message, nowIso());
};

const aggregateMailingLiveFile = (liveFilePath) => {
  if (!liveFilePath || !fs.existsSync(liveFilePath)) {
    return { processed: 0, sent: 0, failed: 0 };
  }
  let sent = 0;
  let failed = 0;
  try {
    const raw = fs.readFileSync(liveFilePath, "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        const o = JSON.parse(t);
        if (o.status === "sent") sent += 1;
        else if (o.status === "failed" || o.status === "error") failed += 1;
      } catch {
        /* skip bad line */
      }
    }
  } catch {
    return { processed: 0, sent: 0, failed: 0 };
  }
  return { processed: sent + failed, sent, failed };
};

const {
  parsingJob,
  botParsingJob,
  mailingJob,
  reactionsJob,
  pendingAuth,
  pushJobLog,
  pushBotParsingLog,
  pushMailLog,
  pushReactionsLog,
} = createTelegramState();

const getSetting = (key, fallback = "") => {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key);
  return row?.value ?? fallback;
};

const setSetting = (key, value) => {
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, nowIso());
};

const isLicenseErrorText = (text) => {
  const t = String(text || "").toLowerCase();
  return (
    t.includes("license is not active") ||
    t.includes("license validation failed") ||
    t.includes("license server unavailable") ||
    t.includes("license key not set")
  );
};

const forceLicenseRelock = (reason = "License check failed") => {
  if (!licenseState.unlocked) return;
  licenseState.unlocked = false;
  setSetting("license_unlocked", "0");
  setSetting("license_revoked_at", nowIso());
  logEvent(`Лицензия отключена автоматически: ${reason}`);
};

const loadAccountProfilesCacheMap = () => {
  const rows = db
    .prepare("SELECT session_name, first_name, last_name, phone, authorized FROM account_profiles_cache")
    .all();
  return new Map(
    rows.map((r) => [
      r.session_name,
      {
        firstName: String(r.first_name || ""),
        lastName: String(r.last_name || ""),
        phone: String(r.phone || ""),
        authorized: Boolean(r.authorized),
      },
    ]),
  );
};

const upsertAccountProfileCache = (row) => {
  db.prepare(
    `INSERT INTO account_profiles_cache (session_name, first_name, last_name, phone, authorized, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_name) DO UPDATE SET
       first_name = excluded.first_name,
       last_name = excluded.last_name,
       phone = excluded.phone,
       authorized = excluded.authorized,
       updated_at = excluded.updated_at`,
  ).run(
    String(row.sessionName || ""),
    String(row.firstName || ""),
    String(row.lastName || ""),
    String(row.phone || ""),
    row.authorized ? 1 : 0,
    nowIso(),
  );
};

const classifyAccountStatus = (spambot = null, authorized = false) => {
  if (!authorized) return { status: "not_authorized", statusText: "не авторизован", statusColor: "red" };
  const s = String(spambot?.status || "unknown").toLowerCase();
  const text = `${spambot?.summary || ""} ${spambot?.botReply || ""}`.toLowerCase();
  if (
    s === "blocked" ||
    text.includes("banned") ||
    text.includes("заблок") ||
    text.includes("навсегда") ||
    text.includes("forever")
  ) {
    return { status: "blocked", statusText: "заблокирован", statusColor: "red" };
  }
  if (s === "ok") return { status: "ok", statusText: "без спамблока", statusColor: "green" };
  if (s === "limited") return { status: "limited", statusText: "спамблок/лимит", statusColor: "yellow" };
  if (s === "pending") return { status: "pending", statusText: "проверяется", statusColor: "yellow" };
  return { status: "unknown", statusText: "статус неизвестен", statusColor: "yellow" };
};

const accountDisplayLabel = (a) => {
  const fio = `${a.firstName || ""} ${a.lastName || ""}`.trim() || a.name || a.sessionName;
  const number = a.phone ? `+${String(a.phone).replace(/^\++/, "")}` : "номер не указан";
  return `${fio} - ${number} - ${a.statusText || "статус неизвестен"}`;
};

if (process.env.SOFTPROG_DISABLE_LICENSE !== "1") {
  licenseState.unlocked = getSetting("license_unlocked", "0") === "1";
  if (licenseState.unlocked) {
    const activeKey = getStoredLicenseKey();
    if (!activeKey) {
      licenseState.unlocked = false;
      setSetting("license_unlocked", "0");
    } else {
      const checked = runLicenseCheck(activeKey, true);
      if (!checked.ok) {
        licenseState.unlocked = false;
        setSetting("license_unlocked", "0");
        setSetting("license_revoked_at", nowIso());
      }
    }
  }
}

const listAccountsFromSessions = () => {
  const files = fs.readdirSync(sessionsDir, { withFileTypes: true });
  const sessionFiles = files
    .filter((f) => f.isFile())
    .map((f) => f.name)
    .filter((name) => !name.startsWith("."))
    .filter((name) => name.endsWith(".session"));

  const sessions = sessionFiles.map((name) => name.replace(/\.session$/i, ""));

  const stateRows = db.prepare("SELECT session_name, enabled FROM accounts_state").all();
  const stateMap = new Map(stateRows.map((r) => [r.session_name, Boolean(r.enabled)]));
  const profileMap = loadAccountProfilesCacheMap();

  return sessions.map((sessionBase, idx) => {
    const sessionPath = `sessions/${sessionBase}`;
    const cached = profileMap.get(sessionPath) || {};
    const firstName = String(cached.firstName || "");
    const lastName = String(cached.lastName || "");
    const phone = String(cached.phone || "");
    const authorized = Boolean(cached.authorized);
    const statusInfo = classifyAccountStatus(spambotPayloadForAccount(sessionPath, authorized, true), authorized);
    const name = `${firstName} ${lastName}`.trim() || sessionBase;
    return {
      id: idx + 1,
      sessionName: sessionPath,
      name,
      enabled: stateMap.has(sessionPath) ? stateMap.get(sessionPath) : true,
      source: "sessions",
      firstName,
      lastName,
      phone,
      authorized,
      ...statusInfo,
      displayLabel: "",
    };
  });
};

const testProxyTcp = (host, port, timeoutMs = 2000) =>
  new Promise((resolve) => {
    const started = Date.now();
    const socket = new net.Socket();
    let settled = false;

    const finish = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ok, latencyMs: Date.now() - started });
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });

const getActiveTelethonProxyJson = () => {
  const row = db
    .prepare(
      `SELECT host, port, login, pass, protocol
       FROM proxies
       WHERE enabled = 1
       ORDER BY CASE status WHEN 'online' THEN 0 WHEN 'unknown' THEN 1 ELSE 2 END, id DESC
       LIMIT 1`
    )
    .get();
  if (!row?.host || !row?.port) return null;
  return JSON.stringify({
    host: row.host,
    port: Number(row.port),
    login: row.login || "",
    pass: row.pass || "",
    protocol: row.protocol || "HTTP/S",
  });
};
const isTelethonProxyRequired = () => getSetting("telethon_use_proxy", "1") === "1";

const telethonProxyJsonOrEmpty = () => {
  if (!isTelethonProxyRequired()) return "";
  return getActiveTelethonProxyJson() || "";
};

const SPAMBOT_CACHE_TTL_MS = Number(process.env.SOFTPROG_SPAMBOT_TTL_MS || 21600000);

const readSpambotCacheRow = (sessionName) =>
  db
    .prepare(
      "SELECT session_name, status, summary, bot_reply, error, checked_at FROM account_spambot_cache WHERE session_name = ?",
    )
    .get(sessionName);

const upsertSpambotCache = (sessionName, { status, summary = "", botReply = "", error = "" }) => {
  db.prepare(
    `
    INSERT INTO account_spambot_cache (session_name, status, summary, bot_reply, error, checked_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_name) DO UPDATE SET
      status = excluded.status,
      summary = excluded.summary,
      bot_reply = excluded.bot_reply,
      error = excluded.error,
      checked_at = excluded.checked_at
  `,
  ).run(sessionName, status, summary, botReply, error, nowIso());
};

const isSpambotRowStale = (row) => {
  if (!row?.checked_at) return true;
  const t = Date.parse(row.checked_at);
  if (Number.isNaN(t)) return true;
  return Date.now() - t > SPAMBOT_CACHE_TTL_MS;
};

const spambotPayloadForAccount = (sessionName, authorized, apiConfigured) => {
  if (!apiConfigured) {
    return {
      status: "na",
      summary: "Укажите Telegram API ID/HASH в настройках",
      checkedAt: null,
      stale: false,
      auto: true,
    };
  }
  if (!authorized) {
    return {
      status: "na",
      summary: "Сессия не авторизована — проверка @SpamBot недоступна",
      checkedAt: null,
      stale: false,
      auto: true,
    };
  }
  const row = readSpambotCacheRow(sessionName);
  if (!row) {
    return {
      status: "unknown",
      summary: "Ещё не проверялось. Нажмите «Проверить сессии».",
      checkedAt: null,
      stale: false,
      auto: true,
    };
  }
  const stale = isSpambotRowStale(row);
  if (row.status === "error") {
    return {
      status: "error",
      summary: row.error || "Ошибка проверки",
      botReply: row.bot_reply || "",
      checkedAt: row.checked_at,
      stale,
      auto: true,
    };
  }
  return {
    status: row.status,
    summary: row.summary || "",
    botReply: row.bot_reply || "",
    checkedAt: row.checked_at,
    stale,
    auto: true,
  };
};

async function runSpambotScriptOnce(sessionName) {
  const apiId = getSetting("telegram_api_id", "");
  const apiHash = getSetting("telegram_api_hash", "");
  if (!apiId || !apiHash) return { ok: false, error: "Нет API ID/HASH" };
  const proxyJson = telethonProxyJsonOrEmpty();
  return runPythonJson(rootDir, spambotScript, [
    "--api-id",
    String(apiId),
    "--api-hash",
    String(apiHash),
    "--session",
    String(sessionName),
    "--proxy-json",
    String(proxyJson),
  ]);
}

let spambotBgChain = Promise.resolve();

const queueSpambotAutoRefresh = (sessionNames) => {
  const unique = [...new Set(sessionNames.filter(Boolean))];
  if (!unique.length) return;
  spambotBgChain = spambotBgChain.then(() => runSpambotAutoRefreshLoop(unique));
};

async function runSpambotAutoRefreshLoop(sessionNames) {
  for (const sn of sessionNames) {
    const row = readSpambotCacheRow(sn);
    if (row && row.status !== "pending" && !isSpambotRowStale(row)) continue;
    try {
      const r = await runSpambotScriptOnce(sn);
      if (r?.ok) {
        upsertSpambotCache(sn, {
          status: String(r.status || "unknown"),
          summary: String(r.summary || ""),
          botReply: String(r.botReply || ""),
          error: "",
        });
        logEvent(`Авто @SpamBot: ${sn} (${r.status})`);
      } else {
        upsertSpambotCache(sn, {
          status: "error",
          summary: "",
          botReply: "",
          error: String(r?.error || "Проверка не выполнена"),
        });
      }
    } catch (e) {
      upsertSpambotCache(sn, {
        status: "error",
        summary: "",
        botReply: "",
        error: String(e?.message || e),
      });
    }
    await new Promise((res) => setTimeout(res, 900));
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ts: nowIso() });
});

app.get("/api/license/status", (_req, res) => {
  res.json({ ok: true, unlocked: Boolean(licenseState.unlocked) });
});

app.post("/api/license/unlock", async (req, res) => {
  const { password = "" } = req.body || {};
  const enteredKey = String(password || "").trim();
  let result = await runLicenseCheckRemote(String(password || ""));
  if (!result.ok) {
    // Fallback to local python checker if remote service unavailable.
    const local = runLicenseCheck(String(password || ""));
    if (local.ok) result = local;
  }
  if (!result.ok) {
    return res.status(401).json({ ok: false, unlocked: false, error: result.message });
  }
  licenseState.unlocked = true;
  setSetting("license_unlocked", "1");
  setSetting("license_revoked_at", "");
  if (result.expiresAt) setSetting("license_expires_at", result.expiresAt);
  const persistedKey = String(result.licenseKey || enteredKey).trim();
  if (persistedKey) {
    setSetting("license_active_key", persistedKey);
    setSetting("license_last_key", persistedKey);
    setSetting("license_key_masked", persistedKey.slice(-4));
  }
  if (result.boundIp) setSetting("license_bound_ip", result.boundIp);
  logEvent("Лицензия активирована");
  return res.json({ ok: true, unlocked: true });
});

app.post("/api/license/disable", async (req, res) => {
  const { adminKey = "", password = "" } = req.body || {};
  const expectedAdmin = String(process.env.SOFTPROG_LICENSE_ADMIN_KEY || "").trim();
  const hasAdminMatch = expectedAdmin && String(adminKey || "").trim() === expectedAdmin;
  const remoteCheck = await runLicenseCheckRemote(String(password || ""));
  const hasPasswordMatch = Boolean(remoteCheck.ok || runLicenseCheck(String(password || ""), true).ok);
  if (!hasAdminMatch && !hasPasswordMatch) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  licenseState.unlocked = false;
  setSetting("license_unlocked", "0");
  setSetting("license_revoked_at", nowIso());
  setSetting("license_expires_at", "");
  setSetting("license_key_masked", "");
  setSetting("license_active_key", "");
  setSetting("license_last_key", "");
  setSetting("license_bound_ip", "");
  logEvent("Лицензия отключена");
  return res.json({ ok: true, unlocked: false });
});

app.get("/api/settings", (_req, res) => {
  res.json({
    telegramApiId: getSetting("telegram_api_id", ""),
    telegramApiHash: getSetting("telegram_api_hash", ""),
    botToken: getSetting("bot_token", ""),
    telethonUseProxy: getSetting("telethon_use_proxy", "1") === "1",
    aiRewriteEnabled: getSetting("ai_rewrite_enabled", "0") === "1",
    aiProvider: getSetting("ai_provider", "gemini"),
    aiApiToken: getSetting("ai_api_token", ""),
  });
});

app.patch("/api/settings", (req, res) => {
  const { telegramApiId, telegramApiHash, botToken, telethonUseProxy, aiRewriteEnabled, aiProvider, aiApiToken } = req.body || {};
  if (telegramApiId !== undefined) setSetting("telegram_api_id", String(telegramApiId || ""));
  if (telegramApiHash !== undefined) setSetting("telegram_api_hash", String(telegramApiHash || ""));
  if (botToken !== undefined) setSetting("bot_token", String(botToken || "").trim());
  if (telethonUseProxy !== undefined) setSetting("telethon_use_proxy", telethonUseProxy ? "1" : "0");
  if (aiRewriteEnabled !== undefined) setSetting("ai_rewrite_enabled", aiRewriteEnabled ? "1" : "0");
  if (aiProvider !== undefined) setSetting("ai_provider", String(aiProvider || "gemini"));
  if (aiApiToken !== undefined) setSetting("ai_api_token", String(aiApiToken || ""));
  logEvent("Настройки Telegram API обновлены");
  res.json({ ok: true });
});

app.post("/api/telegram/auth/send-code", async (req, res) => {
  try {
    const { phone = "", sessionName = "sessions/main" } = req.body || {};
    const apiId = getSetting("telegram_api_id", "");
    const apiHash = getSetting("telegram_api_hash", "");
    if (!apiId || !apiHash) return res.status(400).json({ error: "Set API ID/HASH in Settings first" });
    if (!phone) return res.status(400).json({ error: "phone is required" });
    const proxyJson = telethonProxyJsonOrEmpty();

    const result = await runPythonJson(rootDir, authScript, [
      "send-code",
      "--api-id",
      String(apiId),
      "--api-hash",
      String(apiHash),
      "--session",
      String(sessionName),
      "--phone",
      String(phone),
      "--proxy-json",
      String(proxyJson),
    ]);
    if (!result.ok) return res.status(400).json(result);
    pendingAuth.set(String(sessionName), { phone: String(phone), phoneCodeHash: result.phone_code_hash });
    logEvent(`Telegram auth code requested for ${sessionName}`);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/api/telegram/auth/verify-code", async (req, res) => {
  try {
    const { sessionName = "sessions/main", code = "", password = "" } = req.body || {};
    const apiId = getSetting("telegram_api_id", "");
    const apiHash = getSetting("telegram_api_hash", "");
    if (!apiId || !apiHash) return res.status(400).json({ error: "Set API ID/HASH in Settings first" });
    if (!code) return res.status(400).json({ error: "code is required" });
    const proxyJson = telethonProxyJsonOrEmpty();

    const pending = pendingAuth.get(String(sessionName));
    if (!pending) return res.status(400).json({ error: "No pending auth. Request code first." });

    const result = await runPythonJson(rootDir, authScript, [
      "verify-code",
      "--api-id",
      String(apiId),
      "--api-hash",
      String(apiHash),
      "--session",
      String(sessionName),
      "--phone",
      pending.phone,
      "--code",
      String(code),
      "--phone-code-hash",
      pending.phoneCodeHash,
      "--password",
      String(password || ""),
      "--proxy-json",
      String(proxyJson),
    ]);
    if (result.ok) {
      pendingAuth.delete(String(sessionName));
      logEvent(`Telegram session authorized: ${sessionName}`);
      return res.json({ ok: true, authorized: true });
    }
    if (result.need_password) return res.status(409).json({ ok: false, needPassword: true });
    return res.status(400).json(result);
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
});

app.get("/api/proxies", (_req, res) => {
  const rows = db.prepare("SELECT * FROM proxies ORDER BY id DESC").all();
  res.json(rows.map(mapProxy));
});

app.post("/api/proxies/import", (req, res) => {
  const { lines = [], protocol = "HTTP/S" } = req.body || {};
  if (!Array.isArray(lines)) {
    return res.status(400).json({ error: "lines must be array" });
  }

  const parsed = lines.map((line) => parseProxyLine(String(line))).filter(Boolean);
  if (!parsed.length) return res.json({ inserted: 0 });

  const insert = db.prepare(`
    INSERT INTO proxies (host, port, login, pass, protocol, status, enabled, created_at)
    VALUES (@host, @port, @login, @pass, @protocol, 'unknown', 1, @created_at)
  `);
  const tx = db.transaction((items) => {
    for (const item of items) insert.run({ ...item, protocol, created_at: nowIso() });
  });
  tx(parsed);
  logEvent(`Импортировано прокси: ${parsed.length}`);
  return res.json({ inserted: parsed.length });
});

app.patch("/api/proxies/:id/toggle", (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT enabled FROM proxies WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "not found" });
  const next = row.enabled ? 0 : 1;
  db.prepare("UPDATE proxies SET enabled = ? WHERE id = ?").run(next, id);
  logEvent(`Прокси #${id} ${next ? "включен" : "отключен"}`);
  return res.json({ ok: true, enabled: Boolean(next) });
});

app.delete("/api/proxies/:id", (req, res) => {
  const id = Number(req.params.id);
  db.prepare("DELETE FROM proxies WHERE id = ?").run(id);
  logEvent(`Удален прокси #${id}`);
  return res.json({ ok: true });
});

app.post("/api/proxies/test-all", async (_req, res) => {
  const rows = db.prepare("SELECT id, host, port FROM proxies").all();
  for (const row of rows) {
    const result = await testProxyTcp(row.host, Number(row.port), 1600);
    db.prepare("UPDATE proxies SET status = ?, latency_ms = ?, last_checked_at = ? WHERE id = ?").run(
      result.ok ? "online" : "offline",
      result.latencyMs,
      nowIso(),
      row.id
    );
  }
  logEvent(`Проверка прокси завершена: ${rows.length}`);
  return res.json({ ok: true, tested: rows.length });
});

app.get("/api/proxies/:id/exit-ip", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = db
      .prepare("SELECT host, port, login, pass, protocol FROM proxies WHERE id = ?")
      .get(id);
    if (!row?.host || !row?.port) return res.status(404).json({ error: "Прокси не найден" });
    const proxyJson = JSON.stringify({
      host: row.host,
      port: Number(row.port),
      login: row.login || "",
      pass: row.pass || "",
      protocol: row.protocol || "HTTP/S",
    });
    const result = await runPythonJson(rootDir, proxyExitIpScript, ["--proxy-json", proxyJson]);
    if (!result?.ok) return res.status(502).json({ error: String(result?.error || "Не удалось получить IP") });
    return res.json({ ok: true, ip: String(result.ip || "") });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
});

const emptyProfileFields = () => ({
  phone: "",
  firstName: "",
  lastName: "",
  username: "",
  bio: "",
  authorized: false,
  profileError: null,
});

const phoneDigitsFromSessionName = (sessionName) => {
  const base = String(sessionName || "").startsWith("sessions/")
    ? String(sessionName).slice("sessions/".length)
    : String(sessionName || "");
  const digits = base.replace(/\D/g, "");
  if (digits.length >= 10 && digits.length <= 15) return digits;
  return "";
};

const enrichAccountsWithProfiles = async (accounts, apiId, apiHash) => {
  if (!apiId || !apiHash) {
    return accounts.map((a) => ({ ...a, ...emptyProfileFields() }));
  }
  const proxyJson = telethonProxyJsonOrEmpty();
  const profiles = await Promise.all(
    accounts.map((account) =>
      getAccountProfile({
        rootDir,
        scriptPath: profileScript,
        runPythonJson,
        sessionName: account.sessionName,
        apiId,
        apiHash,
        proxyJson,
      }),
    ),
  );
  if (profiles.some((p) => isLicenseErrorText(p?.error))) {
    forceLicenseRelock("license validation failed in parser");
  }
  return accounts.map((account, i) => {
    const prof = profiles[i];
    if (!prof.authorized) {
      return {
        ...account,
        ...emptyProfileFields(),
        profileError: prof.error || "profile unavailable",
      };
    }
    const apiPhone = String(prof.phone || "").replace(/^\++/, "").trim();
    const fallbackPhone = phoneDigitsFromSessionName(account.sessionName);
    return {
      ...account,
      phone: apiPhone || fallbackPhone,
      firstName: prof.firstName || "",
      lastName: prof.lastName || "",
      username: prof.username || "",
      bio: prof.bio || "",
      authorized: true,
      profileError: null,
    };
  });
};

app.get("/api/accounts", async (req, res) => {
  const accounts = listAccountsFromSessions();
  const lite = req.query.lite === "1" || req.query.lite === "true";
  const apiId = getSetting("telegram_api_id", "");
  const apiHash = getSetting("telegram_api_hash", "");
  const apiConfigured = Boolean(apiId && apiHash);
  if (lite) {
    res.json(
      accounts.map((a) => {
        const spambot = spambotPayloadForAccount(a.sessionName, Boolean(a.authorized), apiConfigured);
        const statusInfo = classifyAccountStatus(spambot, Boolean(a.authorized));
        const item = { ...a, spambot, ...statusInfo };
        return { ...item, displayLabel: accountDisplayLabel(item) };
      }),
    );
    return;
  }
  const enriched = await enrichAccountsWithProfiles(accounts, apiId, apiHash);
  if (!licenseState.unlocked) {
    return res.status(423).json({
      error: "Приложение заблокировано: введите лицензионный ключ",
      code: "LICENSE_REQUIRED",
    });
  }
  res.json(
    enriched.map((a) => {
      const spambot = spambotPayloadForAccount(a.sessionName, a.authorized, apiConfigured);
      const statusInfo = classifyAccountStatus(spambot, a.authorized);
      const item = { ...a, spambot, ...statusInfo };
      return { ...item, displayLabel: accountDisplayLabel(item) };
    }),
  );
});

app.get("/api/accounts/detailed", async (_req, res) => {
  const accounts = listAccountsFromSessions();
  const apiId = getSetting("telegram_api_id", "");
  const apiHash = getSetting("telegram_api_hash", "");
  const apiConfigured = Boolean(apiId && apiHash);
  const enriched = await enrichAccountsWithProfiles(accounts, apiId, apiHash);
  const withSpam = enriched.map((a) => {
    const spambot = spambotPayloadForAccount(a.sessionName, a.authorized, apiConfigured);
    const statusInfo = classifyAccountStatus(spambot, a.authorized);
    const item = { ...a, spambot, ...statusInfo };
    return { ...item, displayLabel: accountDisplayLabel(item) };
  });
  res.json(withSpam);
});

app.post("/api/accounts/import-archive", (req, res) => {
  try {
    const { archiveBase64 = "", fileName = "sessions.zip" } = req.body || {};
    if (!archiveBase64) return res.status(400).json({ error: "archiveBase64 is required" });
    const payload = String(archiveBase64).includes(",")
      ? String(archiveBase64).split(",", 2)[1]
      : String(archiveBase64);
    const zipBuffer = Buffer.from(payload, "base64");
    if (!zipBuffer.length) return res.status(400).json({ error: "Empty archive payload" });
    if (zipBuffer.length > 70 * 1024 * 1024) {
      return res.status(400).json({ error: "Archive is too large (max 70MB)" });
    }

    const tmpZipPath = path.join(dataDir, `sessions-upload-${Date.now()}.zip`);
    fs.writeFileSync(tmpZipPath, zipBuffer);

    const safeBase = (name) => {
      const base = String(name || "")
        .replace(/\\/g, "/")
        .split("/")
        .pop()
        ?.trim();
      if (!base) return "";
      if (!base.toLowerCase().endsWith(".session")) return "";
      const session = base.slice(0, -".session".length).trim();
      if (!session) return "";
      if (!/^[a-zA-Z0-9._+\-() ]+$/.test(session)) return "";
      return session;
    };

    const zip = new AdmZip(tmpZipPath);
    const entries = zip.getEntries();
    let imported = 0;
    let overwritten = 0;
    let skipped = 0;

    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const sessionBase = safeBase(entry.entryName);
      if (!sessionBase) {
        skipped += 1;
        continue;
      }
      const target = path.join(sessionsDir, `${sessionBase}.session`);
      if (fs.existsSync(target)) overwritten += 1;
      fs.writeFileSync(target, entry.getData());
      imported += 1;
    }

    try {
      fs.unlinkSync(tmpZipPath);
    } catch {}

    logEvent(
      `Импорт сессий из архива ${String(fileName || "sessions.zip")}: ${imported} добавлено, ${overwritten} перезаписано, ${skipped} пропущено`,
    );
    return res.json({ ok: true, imported, overwritten, skipped });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/api/accounts/import-archive-file", upload.single("archive"), (req, res) => {
  try {
    const file = req.file;
    const fileName = String(req.body?.fileName || file?.originalname || "sessions.zip");
    if (!file?.buffer?.length) return res.status(400).json({ error: "Archive file is required" });
    if (file.buffer.length > 70 * 1024 * 1024) {
      return res.status(400).json({ error: "Archive is too large (max 70MB)" });
    }

    const safeBase = (name) => {
      const base = String(name || "")
        .replace(/\\/g, "/")
        .split("/")
        .pop()
        ?.trim();
      if (!base) return "";
      if (!base.toLowerCase().endsWith(".session")) return "";
      const session = base.slice(0, -".session".length).trim();
      if (!session) return "";
      if (!/^[a-zA-Z0-9._+\-() ]+$/.test(session)) return "";
      return session;
    };

    const zip = new AdmZip(file.buffer);
    const entries = zip.getEntries();
    let imported = 0;
    let overwritten = 0;
    let skipped = 0;

    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const sessionBase = safeBase(entry.entryName);
      if (!sessionBase) {
        skipped += 1;
        continue;
      }
      const target = path.join(sessionsDir, `${sessionBase}.session`);
      if (fs.existsSync(target)) overwritten += 1;
      fs.writeFileSync(target, entry.getData());
      imported += 1;
    }

    logEvent(
      `Импорт сессий из архива ${String(fileName || "sessions.zip")}: ${imported} добавлено, ${overwritten} перезаписано, ${skipped} пропущено`,
    );
    return res.json({ ok: true, imported, overwritten, skipped });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
});

app.patch("/api/accounts/:sessionName/toggle", (req, res) => {
  const sessionName = req.params.sessionName;
  const found = db.prepare("SELECT enabled FROM accounts_state WHERE session_name = ?").get(sessionName);
  const next = found ? (found.enabled ? 0 : 1) : 0;

  db.prepare(`
    INSERT INTO accounts_state (session_name, enabled, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(session_name) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at
  `).run(sessionName, next, nowIso());

  logEvent(`Аккаунт ${sessionName} ${next ? "включен" : "отключен"}`);
  res.json({ ok: true, enabled: Boolean(next) });
});

app.delete("/api/accounts/:sessionName", (req, res) => {
  try {
    const sessionName = decodeURIComponent(req.params.sessionName || "");
    if (!sessionName.startsWith("sessions/")) return res.status(400).json({ error: "invalid session path" });
    const base = sessionName.slice("sessions/".length);
    if (!base || base.includes("/") || base.includes("\\")) return res.status(400).json({ error: "invalid session name" });

    const sessionFile = path.join(sessionsDir, `${base}.session`);
    const shmFile = `${sessionFile}-shm`;
    const walFile = `${sessionFile}-wal`;

    if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);
    if (fs.existsSync(shmFile)) fs.unlinkSync(shmFile);
    if (fs.existsSync(walFile)) fs.unlinkSync(walFile);

    db.prepare("DELETE FROM accounts_state WHERE session_name = ?").run(sessionName);
    db.prepare("DELETE FROM account_spambot_cache WHERE session_name = ?").run(sessionName);
    db.prepare("DELETE FROM account_profiles_cache WHERE session_name = ?").run(sessionName);
    logEvent(`Удален аккаунт ${sessionName}`);
    return res.json({ ok: true, deleted: true });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/api/accounts/verify", async (_req, res) => {
  try {
    const apiId = getSetting("telegram_api_id", "");
    const apiHash = getSetting("telegram_api_hash", "");
    if (!apiId || !apiHash) return res.status(400).json({ error: "Set Telegram API ID/HASH in settings" });

    const accounts = listAccountsFromSessions();
    const enriched = await enrichAccountsWithProfiles(accounts, apiId, apiHash);
    let authorized = 0;
    let failed = 0;
    for (const row of enriched) {
      if (row.authorized) authorized += 1;
      else failed += 1;
      upsertAccountProfileCache(row);
    }
    logEvent(`Проверка сессий: ${authorized} ok, ${failed} failed`);
    const authorizedSessions = enriched.filter((a) => a.authorized).map((a) => a.sessionName);
    for (const sessionName of authorizedSessions) {
      upsertSpambotCache(sessionName, {
        status: "pending",
        summary: "Проверяем через @SpamBot…",
        botReply: "",
        error: "",
      });
    }
    queueSpambotAutoRefresh(authorizedSessions);
    return res.json({ ok: true, total: accounts.length, authorized, failed });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
});

app.get("/api/accounts/:sessionName/service-code", async (req, res) => {
  try {
    const sessionName = decodeURIComponent(req.params.sessionName || "");
    if (!sessionName.startsWith("sessions/")) return res.status(400).json({ error: "invalid session path" });
    const apiId = getSetting("telegram_api_id", "");
    const apiHash = getSetting("telegram_api_hash", "");
    if (!apiId || !apiHash) return res.status(400).json({ error: "Set Telegram API ID/HASH in settings" });
    const proxyJson = telethonProxyJsonOrEmpty();

    const result = await runPythonJson(rootDir, messagesScript, [
      "history",
      "--api-id", String(apiId),
      "--api-hash", String(apiHash),
      "--session", String(sessionName),
      "--peer", "777000",
      "--limit", "15",
      "--proxy-json", String(proxyJson),
    ]);
    const messages = Array.isArray(result?.messages) ? result.messages : [];
    const source = messages.find((m) => /\d{4,8}/.test(String(m.text || "")));
    if (!source) return res.json({ ok: true, code: "", message: "Код в последних сообщениях не найден" });
    const match = String(source.text || "").match(/\b(\d{4,8})\b/);
    return res.json({
      ok: true,
      code: match?.[1] || "",
      text: String(source.text || ""),
      date: source.date || "",
    });
  } catch (err) {
    const message = String(err.message || err);
    try {
      const parsed = JSON.parse(message);
      return res.status(400).json({ error: String(parsed.error || message) });
    } catch {
      return res.status(500).json({ error: message });
    }
  }
});

app.get("/api/accounts/:sessionName/spambot-check", async (req, res) => {
  try {
    const sessionName = decodeURIComponent(req.params.sessionName || "");
    if (!sessionName.startsWith("sessions/")) return res.status(400).json({ error: "invalid session path" });
    const apiId = getSetting("telegram_api_id", "");
    const apiHash = getSetting("telegram_api_hash", "");
    if (!apiId || !apiHash) return res.status(400).json({ error: "Set Telegram API ID/HASH in settings" });
    const result = await runSpambotScriptOnce(sessionName);
    if (!result?.ok) {
      upsertSpambotCache(sessionName, {
        status: "error",
        summary: "",
        botReply: "",
        error: String(result?.error || "Проверка @SpamBot не выполнена"),
      });
      return res.status(400).json({
        ok: false,
        error: String(result?.error || "Проверка @SpamBot не выполнена"),
        authorized: Boolean(result?.authorized),
      });
    }
    upsertSpambotCache(sessionName, {
      status: String(result.status || "unknown"),
      summary: String(result.summary || ""),
      botReply: String(result.botReply || ""),
      error: "",
    });
    logEvent(`Проверка @SpamBot: ${sessionName} (${result.status || "?"})`);
    return res.json({
      ok: true,
      authorized: true,
      botReply: String(result.botReply || ""),
      summary: String(result.summary || ""),
      status: String(result.status || "unknown"),
    });
  } catch (err) {
    const message = String(err.message || err);
    try {
      const parsed = JSON.parse(message);
      return res.status(400).json({ error: String(parsed.error || message) });
    } catch {
      return res.status(500).json({ error: message });
    }
  }
});

app.get("/api/accounts/:sessionName/exit-ip", async (req, res) => {
  try {
    const sessionName = decodeURIComponent(req.params.sessionName || "");
    if (!sessionName.startsWith("sessions/")) return res.status(400).json({ error: "invalid session path" });
    const apiId = getSetting("telegram_api_id", "");
    const apiHash = getSetting("telegram_api_hash", "");
    if (!apiId || !apiHash) return res.status(400).json({ error: "Set Telegram API ID/HASH in settings" });
    const proxyJson = telethonProxyJsonOrEmpty();

    const result = await runPythonJson(rootDir, exitIpScript, [
      "--api-id",
      String(apiId),
      "--api-hash",
      String(apiHash),
      "--session",
      String(sessionName),
      "--proxy-json",
      String(proxyJson),
    ]);
    if (!result?.ok) {
      const code = String(result?.error || "").toLowerCase().includes("not authorized") ? 400 : 502;
      return res.status(code).json({ error: String(result?.error || "Не удалось получить IP") });
    }
    return res.json({
      ok: true,
      ip: String(result.ip || ""),
      country: String(result.country || ""),
      source: String(result.source || "telegram"),
    });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
});

app.get("/api/messages/dialogs", async (req, res) => {
  try {
    const sessionName = String(req.query.sessionName || "sessions/main");
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
    const apiId = getSetting("telegram_api_id", "");
    const apiHash = getSetting("telegram_api_hash", "");
    if (!apiId || !apiHash) return res.status(400).json({ error: "Set Telegram API ID/HASH in settings" });
    const proxyJson = telethonProxyJsonOrEmpty();
    const result = await runPythonJson(rootDir, messagesScript, [
      "dialogs",
      "--api-id", String(apiId),
      "--api-hash", String(apiHash),
      "--session", sessionName,
      "--limit", String(limit),
      "--proxy-json", String(proxyJson),
    ]);
    return res.json(result);
  } catch (err) {
    const message = String(err.message || err);
    try {
      const parsed = JSON.parse(message);
      return res.status(400).json({ error: String(parsed.error || message) });
    } catch {
      return res.status(500).json({ error: message });
    }
  }
});

app.get("/api/messages/history", async (req, res) => {
  try {
    const sessionName = String(req.query.sessionName || "sessions/main");
    const peer = String(req.query.peer || "").trim();
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
    if (!peer) return res.status(400).json({ error: "peer is required" });
    const apiId = getSetting("telegram_api_id", "");
    const apiHash = getSetting("telegram_api_hash", "");
    if (!apiId || !apiHash) return res.status(400).json({ error: "Set Telegram API ID/HASH in settings" });
    const proxyJson = telethonProxyJsonOrEmpty();
    const result = await runPythonJson(rootDir, messagesScript, [
      "history",
      "--api-id", String(apiId),
      "--api-hash", String(apiHash),
      "--session", sessionName,
      "--peer", peer,
      "--limit", String(limit),
      "--proxy-json", String(proxyJson),
    ]);
    return res.json(result);
  } catch (err) {
    const message = String(err.message || err);
    try {
      const parsed = JSON.parse(message);
      return res.status(400).json({ error: String(parsed.error || message) });
    } catch {
      return res.status(500).json({ error: message });
    }
  }
});

app.post("/api/messages/send", async (req, res) => {
  try {
    const { sessionName = "sessions/main", peer = "", message = "" } = req.body || {};
    if (!String(peer || "").trim()) return res.status(400).json({ error: "peer is required" });
    if (!String(message || "").trim()) return res.status(400).json({ error: "message is required" });
    const apiId = getSetting("telegram_api_id", "");
    const apiHash = getSetting("telegram_api_hash", "");
    if (!apiId || !apiHash) return res.status(400).json({ error: "Set Telegram API ID/HASH in settings" });
    const proxyJson = telethonProxyJsonOrEmpty();
    const result = await runPythonJson(rootDir, messagesScript, [
      "send",
      "--api-id", String(apiId),
      "--api-hash", String(apiHash),
      "--session", String(sessionName),
      "--peer", String(peer),
      "--message", String(message),
      "--proxy-json", String(proxyJson),
    ]);
    return res.json(result);
  } catch (err) {
    const message = String(err.message || err);
    try {
      const parsed = JSON.parse(message);
      return res.status(400).json({ error: String(parsed.error || message) });
    } catch {
      return res.status(500).json({ error: message });
    }
  }
});

app.patch("/api/accounts/:sessionName/profile", async (req, res) => {
  try {
    const sessionName = req.params.sessionName;
    const apiId = getSetting("telegram_api_id", "");
    const apiHash = getSetting("telegram_api_hash", "");
    if (!apiId || !apiHash) return res.status(400).json({ error: "Set Telegram API ID/HASH in settings" });
    const proxyJson = telethonProxyJsonOrEmpty();

    const { firstName, lastName, username, bio, photoBase64 = "", clearPhoto = false } = req.body || {};
    const args = [
      "set",
      "--api-id",
      String(apiId),
      "--api-hash",
      String(apiHash),
      "--session",
      String(sessionName),
      "--first-name",
      String(firstName ?? ""),
      "--last-name",
      String(lastName ?? ""),
      "--bio",
      String(bio ?? ""),
      "--username",
      String(username ?? ""),
    ];
    if (photoBase64) args.push("--photo-base64", String(photoBase64));
    if (clearPhoto) args.push("--clear-photo");
    args.push("--proxy-json", String(proxyJson));

    const result = await runPythonJson(rootDir, profileScript, args);
    if (!result?.ok) return res.status(400).json({ error: result?.error || "update failed" });
    logEvent(`Профиль аккаунта обновлен: ${sessionName}`);
    return res.json({ ok: true, profile: result.profile || null });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
});

const mapProfileStyleTemplateRow = (row) => ({
  id: row.id,
  name: row.name,
  firstName: row.first_name ?? "",
  lastName: row.last_name ?? "",
  username: row.username ?? "",
  bio: row.bio ?? "",
  photoBase64: row.photo_base64 ?? "",
  clearPhoto: Boolean(row.clear_photo),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

app.get("/api/profile-style-templates", (_req, res) => {
  const rows = db
    .prepare("SELECT * FROM profile_style_templates ORDER BY datetime(updated_at) DESC, id DESC")
    .all();
  res.json({ templates: rows.map(mapProfileStyleTemplateRow) });
});

app.post("/api/profile-style-templates", (req, res) => {
  try {
    const {
      name = "",
      firstName = "",
      lastName = "",
      username = "",
      bio = "",
      photoBase64 = "",
      clearPhoto = false,
    } = req.body || {};
    const n = String(name).trim();
    if (!n) return res.status(400).json({ error: "Укажите название шаблона" });
    const ts = nowIso();
    const ins = db.prepare(`
      INSERT INTO profile_style_templates
        (name, first_name, last_name, username, bio, photo_base64, clear_photo, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const r = ins.run(
      n,
      String(firstName ?? ""),
      String(lastName ?? ""),
      String(username ?? ""),
      String(bio ?? ""),
      String(photoBase64 ?? ""),
      clearPhoto ? 1 : 0,
      ts,
      ts,
    );
    const row = db.prepare("SELECT * FROM profile_style_templates WHERE id = ?").get(r.lastInsertRowid);
    logEvent(`Шаблон оформления профиля создан: ${n}`);
    res.json({ template: mapProfileStyleTemplateRow(row) });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
});

app.patch("/api/profile-style-templates/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Некорректный id" });
    const prev = db.prepare("SELECT * FROM profile_style_templates WHERE id = ?").get(id);
    if (!prev) return res.status(404).json({ error: "Шаблон не найден" });
    const b = req.body || {};
    const name = b.name !== undefined ? String(b.name).trim() : prev.name;
    if (!name) return res.status(400).json({ error: "Укажите название шаблона" });
    const firstName = b.firstName !== undefined ? String(b.firstName) : prev.first_name;
    const lastName = b.lastName !== undefined ? String(b.lastName) : prev.last_name;
    const username = b.username !== undefined ? String(b.username) : prev.username;
    const bio = b.bio !== undefined ? String(b.bio) : prev.bio;
    const photoBase64 = b.photoBase64 !== undefined ? String(b.photoBase64) : prev.photo_base64;
    const clearPhoto =
      b.clearPhoto !== undefined ? (b.clearPhoto ? 1 : 0) : prev.clear_photo;
    const ts = nowIso();
    db.prepare(`
      UPDATE profile_style_templates SET
        name = ?, first_name = ?, last_name = ?, username = ?, bio = ?,
        photo_base64 = ?, clear_photo = ?, updated_at = ?
      WHERE id = ?
    `).run(name, firstName, lastName, username, bio, photoBase64, clearPhoto, ts, id);
    const row = db.prepare("SELECT * FROM profile_style_templates WHERE id = ?").get(id);
    logEvent(`Шаблон оформления профиля обновлён: ${name}`);
    res.json({ template: mapProfileStyleTemplateRow(row) });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
});

app.delete("/api/profile-style-templates/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Некорректный id" });
    const row = db.prepare("SELECT name FROM profile_style_templates WHERE id = ?").get(id);
    if (!row) return res.status(404).json({ error: "Шаблон не найден" });
    db.prepare("DELETE FROM profile_style_templates WHERE id = ?").run(id);
    logEvent(`Шаблон оформления профиля удалён: ${row.name}`);
    res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/api/parsing/ingest", (req, res) => {
  const { rows = [] } = req.body || {};
  if (!Array.isArray(rows)) return res.status(400).json({ error: "rows must be array" });

  const insert = db.prepare(`
    INSERT INTO parsed_users (external_id, username, source, source_link, is_premium, created_at)
    VALUES (@external_id, @username, @source, @source_link, @is_premium, @created_at)
  `);

  const prepared = rows
    .map((row) => ({
      external_id: String(row.external_id || "").trim(),
      username: row.username ? String(row.username).trim() : null,
      source: row.source ? String(row.source).trim() : "chats",
      source_link: row.source_link ? String(row.source_link).trim() : null,
      is_premium: row.is_premium ? 1 : 0,
      created_at: row.created_at ? String(row.created_at) : nowIso(),
    }))
    .filter((r) => r.external_id);

  const tx = db.transaction((items) => {
    for (const item of items) insert.run(item);
  });
  tx(prepared);
  if (parsingJob.running && parsingJob.audiencePath && prepared.length) {
    appendAudienceUsers(
      parsingJob.audiencePath,
      prepared.map((r) => ({
        external_id: r.external_id,
        username: r.username,
        source: r.source,
        source_link: r.source_link,
        is_premium: r.is_premium,
        created_at: r.created_at,
      })),
    );
  }
  if (botParsingJob.running && botParsingJob.audiencePath && prepared.length) {
    const botAudienceRows = prepared
      .filter((r) => String(r.source || "") === "channel_members")
      .map((r) => {
        const unameRaw = String(r.username || "").trim();
        if (!unameRaw) return null;
        const username = unameRaw.startsWith("@") ? unameRaw : `@${unameRaw}`;
        return {
          external_id: "",
          username,
          source: r.source,
          source_link: r.source_link,
          is_premium: r.is_premium,
          created_at: r.created_at,
        };
      })
      .filter(Boolean);
    if (!botAudienceRows.length) {
      logEvent("Bot parsing ingest: no usernames to append into audience");
      return res.json({ inserted: prepared.length });
    }
    appendAudienceUsers(
      botParsingJob.audiencePath,
      botAudienceRows,
    );
  }
  logEvent(`Ingest parsed_users: ${prepared.length}`);
  res.json({ inserted: prepared.length });
});

app.get("/api/parsing/audiences", (_req, res) => {
  res.json({ audiences: listAudiences(dataDir) });
});

app.get("/api/parsing/audiences/:id/recipients", (req, res) => {
  const list = readAudienceRecipients(dataDir, req.params.id);
  res.json({ recipients: list, count: list.length });
});

app.post("/api/parsing/start", (req, res) => {
  const { sourceLink = "", periodDays = 30, premiumFilter = "all" } = req.body || {};
  const normalizedLink = String(sourceLink || "").trim();
  if (!normalizedLink) return res.status(400).json({ error: "sourceLink is required" });

  const period = Math.max(1, Math.min(365, Number(periodDays) || 30));
  const fromIso = new Date(Date.now() - period * 24 * 60 * 60 * 1000).toISOString();

  const conditions = ["created_at >= ?"];
  const params = [fromIso];

  if (premiumFilter === "premium") conditions.push("is_premium = 1");
  else if (premiumFilter === "non_premium") conditions.push("is_premium = 0");
  conditions.push("(source_link = ? OR source_link IS NULL)");
  params.push(normalizedLink);

  const whereSql = conditions.join(" AND ");
  const rows = db
    .prepare(
      `SELECT external_id, MAX(username) as username, MAX(source) as source, MAX(is_premium) as is_premium, MAX(created_at) as created_at
       FROM parsed_users
       WHERE ${whereSql}
       GROUP BY external_id
       ORDER BY MAX(created_at) DESC
       LIMIT 1000`
    )
    .all(...params);

  const resultCount = rows.length;
  const run = db
    .prepare(
      `INSERT INTO parsing_runs (source_link, source_mode, period_days, premium_filter, result_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .get(normalizedLink, "auto", period, premiumFilter, resultCount, nowIso());

  logEvent(`Парсинг: ${resultCount} уникальных за ${period}д (auto, ${premiumFilter})`);
  res.json({
    run,
    results: rows.map((r) => ({
      id: r.external_id,
      username: r.username || "",
      source: r.source === "chats" ? "Чаты" : "Обсуждения",
      isPremium: Boolean(r.is_premium),
      lastActivityAt: r.created_at,
    })),
  });
});

app.get("/api/parsing/results", (req, res) => {
  const sourceLink = String(req.query.sourceLink || "").trim();
  const premiumFilter = String(req.query.premiumFilter || "all");
  const periodDays = Math.max(1, Math.min(365, Number(req.query.periodDays) || 30));

  if (!sourceLink) return res.json({ results: [] });

  const fromIso = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();
  const conditions = ["created_at >= ?", "(source_link = ? OR source_link IS NULL)"];
  const params = [fromIso, sourceLink];

  if (premiumFilter === "premium") conditions.push("is_premium = 1");
  else if (premiumFilter === "non_premium") conditions.push("is_premium = 0");

  const rows = db
    .prepare(
      `SELECT external_id, MAX(username) as username, MAX(source) as source, MAX(is_premium) as is_premium, MAX(created_at) as created_at
       FROM parsed_users
       WHERE ${conditions.join(" AND ")}
       GROUP BY external_id
       ORDER BY MAX(created_at) DESC
       LIMIT 1000`
    )
    .all(...params);

  res.json({
    results: rows.map((r) => ({
      id: r.external_id,
      username: r.username || "",
      source:
        r.source === "chats"
          ? "Чаты"
          : r.source === "bot_admin" || r.source === "channel_members"
            ? "Подписчики канала"
            : "Обсуждения",
      isPremium: Boolean(r.is_premium),
      lastActivityAt: r.created_at,
    })),
  });
});

app.get("/api/parsing/live-results", (_req, res) => {
  if (!parsingJob.liveFile || !fs.existsSync(parsingJob.liveFile)) return res.json({ results: [] });
  const content = fs.readFileSync(parsingJob.liveFile, "utf-8");
  if (!content.trim()) return res.json({ results: [] });
  const lines = content.trim().split("\n").slice(-1000);
  const rows = [];
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line));
    } catch {}
  }
  res.json({ results: rows.reverse() });
});

app.post("/api/parsing/telethon/start", (req, res) => {
  if (parsingJob.running) return res.status(409).json({ error: "parsing job is already running" });

  const {
    apiId,
    apiHash,
    sessionName = "sessions/main",
    sourceLink = "",
    variant = "smart",
    periodDays = 30,
    premiumFilter = "all",
    joinWaitSeconds = 20,
  } = req.body || {};

  const effectiveApiId = apiId || getSetting("telegram_api_id", "");
  const effectiveApiHash = apiHash || getSetting("telegram_api_hash", "");
  const proxyJson = telethonProxyJsonOrEmpty();
  const safePeriodDays = Math.max(1, Math.min(365, Number(periodDays) || 30));
  const safeJoinWaitSeconds = Math.max(5, Math.min(600, Number(joinWaitSeconds) || 20));

  if (!effectiveApiId || !effectiveApiHash || !sourceLink) {
    return res.status(400).json({ error: "sourceLink and Telegram API creds are required (set them in Settings)" });
  }

  parsingJob.running = true;
  parsingJob.pid = null;
  parsingJob.startedAt = nowIso();
  parsingJob.finishedAt = null;
  parsingJob.status = "running";
  parsingJob.progress = 5;
  parsingJob.logs = [];
  parsingJob.error = null;
  parsingJob.stopRequested = false;
  parsingJob.sourceLink = sourceLink;
  parsingJob.liveFile = path.join(rootDir, "data", `parsing-live-${Date.now()}.jsonl`);
  parsingJob.audienceDir = null;
  parsingJob.audiencePath = null;
  try {
    const started = startAudienceFolder(dataDir, {
      sourceLink: String(sourceLink || `channel_id_${channelId}`).trim(),
      periodDays: safePeriodDays,
      premiumFilter: String(premiumFilter || "all"),
      variant: String(variant || "smart"),
      startedAt: parsingJob.startedAt,
    });
    parsingJob.audienceDir = started.dirName;
    parsingJob.audiencePath = started.fullPath;
    pushJobLog(`Папка аудитории: ${started.dirName}`);
  } catch (e) {
    pushJobLog(`Папка аудитории не создана: ${String(e.message || e)}`);
  }
  try {
    fs.writeFileSync(parsingJob.liveFile, "", "utf-8");
  } catch {
    parsingJob.liveFile = null;
  }
  pushJobLog("Запуск Telethon-парсера...");

  const args = [
    "-u",
    parserScript,
    "--api-id",
    String(effectiveApiId),
    "--api-hash",
    String(effectiveApiHash),
    "--session",
    String(sessionName),
    "--source-link",
    String(sourceLink),
    "--variant",
    String(variant),
    "--days",
    String(safePeriodDays),
    "--premium-filter",
    String(premiumFilter),
    "--join-wait-seconds",
    String(safeJoinWaitSeconds),
    "--proxy-json",
    String(proxyJson),
    "--backend-url",
    TELETHON_BACKEND_URL,
    "--live-file",
    String(parsingJob.liveFile || ""),
  ];

  const proc = spawn(resolvePythonExecutable(), args, {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
    windowsHide: process.platform === "win32",
  });
  parsingJob.pid = proc.pid || null;
  logEvent(`Telethon job started for ${sourceLink}`);

  proc.stdout.on("data", (chunk) => {
    const lines = String(chunk).split("\n").map((s) => s.trim()).filter(Boolean);
    for (const line of lines) {
      pushJobLog(line);
      if (line.toLowerCase().includes("connected")) parsingJob.progress = Math.max(parsingJob.progress, 15);
      if (line.toLowerCase().includes("authorized")) parsingJob.progress = Math.max(parsingJob.progress, 30);
      if (line.toLowerCase().includes("scanning chat")) parsingJob.progress = Math.max(parsingJob.progress, 45);
      if (line.toLowerCase().includes("scanning discussions")) parsingJob.progress = Math.max(parsingJob.progress, 65);
      if (line.toLowerCase().includes("sending rows")) parsingJob.progress = Math.max(parsingJob.progress, 80);
      if (line.toLowerCase().includes("collected unique users")) parsingJob.progress = 85;
      if (line.toLowerCase().includes("inserted to backend")) parsingJob.progress = 95;
    }
  });

  proc.stderr.on("data", (chunk) => {
    const lines = String(chunk).split("\n").map((s) => s.trim()).filter(Boolean);
    let licenseErrorSeen = false;
    for (const line of lines) {
      if (isLicenseErrorText(line)) {
        licenseErrorSeen = true;
        continue;
      }
      pushJobLog(`ERR: ${line}`);
    }
    if (licenseErrorSeen) {
      forceLicenseRelock("license validation failed in parser");
      pushJobLog("ERR: Лицензия не активна. Введите ключ снова.");
    }
  });

  proc.on("close", (code, signal) => {
    parsingJob.running = false;
    parsingJob.finishedAt = nowIso();
    const userStop = parsingJob.stopRequested;
    parsingJob.stopRequested = false;
    let finalStatus;
    if (userStop || signal) {
      finalStatus = "stopped";
      parsingJob.error = null;
      parsingJob.progress = 0;
    } else {
      parsingJob.progress = code === 0 ? 100 : parsingJob.progress;
      finalStatus = code === 0 ? "done" : "error";
      if (code !== 0) parsingJob.error = `Python parser exited with code ${code}`;
    }
    parsingJob.status = finalStatus;
    if (parsingJob.audiencePath) {
      try {
        finalizeAudienceFolder(parsingJob.audiencePath, finalStatus);
      } catch {
        /* ignore */
      }
      if (parsingJob.audienceDir) parsingJob.lastAudienceDir = parsingJob.audienceDir;
      parsingJob.audiencePath = null;
      parsingJob.audienceDir = null;
    }
    logEvent(
      signal
        ? `Telethon job stopped (${sourceLink})`
        : code === 0
          ? `Telethon job finished successfully (${sourceLink})`
          : `Telethon job failed (${sourceLink}), code=${code}`
    );
  });

  res.json({ ok: true, pid: parsingJob.pid, status: parsingJob.status });
});

app.get("/api/parsing/telethon/status", (_req, res) => {
  let liveCount = 0;
  if (parsingJob.liveFile && fs.existsSync(parsingJob.liveFile)) {
    const content = fs.readFileSync(parsingJob.liveFile, "utf-8");
    if (content.trim()) liveCount = content.trim().split("\n").length;
  }
  res.json({
    running: parsingJob.running,
    pid: parsingJob.pid,
    status: parsingJob.status,
    progress: parsingJob.progress,
    startedAt: parsingJob.startedAt,
    finishedAt: parsingJob.finishedAt,
    sourceLink: parsingJob.sourceLink,
    audienceDir: parsingJob.audienceDir || parsingJob.lastAudienceDir,
    liveCount,
    error: parsingJob.error,
    logs: parsingJob.logs.slice(0, 80),
  });
});

app.post("/api/parsing/telethon/stop", (_req, res) => {
  if (!parsingJob.running || !parsingJob.pid) return res.json({ ok: true, stopped: false });
  try {
    parsingJob.stopRequested = true;
    process.kill(parsingJob.pid, "SIGTERM");
    parsingJob.running = false;
    parsingJob.status = "stopped";
    parsingJob.finishedAt = nowIso();
    pushJobLog("Остановлено пользователем.");
    logEvent("Telethon job stopped by user");
    return res.json({ ok: true, stopped: true });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

app.post("/api/parsing/bot/start", async (req, res) => {
  if (botParsingJob.running) return res.status(409).json({ error: "bot parsing job is already running" });

  const { apiId, apiHash, botToken = "", target = "", channelId = "", limit = 0 } = req.body || {};
  const effectiveApiId = apiId || getSetting("telegram_api_id", "");
  const effectiveApiHash = apiHash || getSetting("telegram_api_hash", "");
  const effectiveBotToken = String(botToken || getSetting("bot_token", "")).trim();
  const proxyJson = telethonProxyJsonOrEmpty();
  const safeLimit = Number(limit) > 0 ? Math.max(1, Math.min(50000, Number(limit))) : 0;

  if (!effectiveApiId || !effectiveApiHash || !effectiveBotToken || (!target && !channelId)) {
    return res
      .status(400)
      .json({ error: "Нужны botToken, Telegram API creds и target или channelId." });
  }

  botParsingJob.running = true;
  botParsingJob.pid = null;
  botParsingJob.startedAt = nowIso();
  botParsingJob.finishedAt = null;
  botParsingJob.status = "running";
  botParsingJob.progress = 5;
  botParsingJob.logs = [];
  botParsingJob.error = null;
  botParsingJob.stopRequested = false;
  botParsingJob.sourceLink = target || `channel_id:${channelId}`;
  botParsingJob.liveFile = path.join(rootDir, "data", `parsing-bot-live-${Date.now()}.jsonl`);
  botParsingJob.audienceDir = null;
  botParsingJob.audiencePath = null;
  try {
    const audienceSource = await buildAudienceSourceFromChat(
      effectiveBotToken,
      channelId,
      String(target || `channel_id_${channelId}`).trim(),
    );
    const started = startAudienceFolder(dataDir, {
      sourceLink: audienceSource,
      periodDays: 0,
      premiumFilter: "all",
      variant: "bot_admin",
      startedAt: botParsingJob.startedAt,
    });
    botParsingJob.audienceDir = started.dirName;
    botParsingJob.audiencePath = started.fullPath;
    pushBotParsingLog(`Папка аудитории: ${started.dirName}`);
  } catch (e) {
    pushBotParsingLog(`Папка аудитории не создана: ${String(e.message || e)}`);
  }
  try {
    fs.writeFileSync(botParsingJob.liveFile, "", "utf-8");
  } catch {
    botParsingJob.liveFile = null;
  }
  pushBotParsingLog("Запуск парсинга подписчиков через bot token...");

  const args = [
    "-u",
    botParserScript,
    "--api-id",
    String(effectiveApiId),
    "--api-hash",
    String(effectiveApiHash),
    "--bot-token",
    String(effectiveBotToken),
    "--target",
    String(target),
    "--channel-id",
    String(channelId || ""),
    "--limit",
    String(safeLimit),
    "--proxy-json",
    String(proxyJson),
    "--backend-url",
    TELETHON_BACKEND_URL,
    "--live-file",
    String(botParsingJob.liveFile || ""),
  ];

  const proc = spawn(resolvePythonExecutable(), args, {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
    windowsHide: process.platform === "win32",
  });
  botParsingJob.pid = proc.pid || null;
  logEvent(`Bot parser job started for ${target}`);

  proc.stdout.on("data", (chunk) => {
    const lines = String(chunk)
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const line of lines) {
      pushBotParsingLog(line);
      if (line.toLowerCase().includes("authorized")) botParsingJob.progress = Math.max(botParsingJob.progress, 25);
      if (line.toLowerCase().includes("resolved")) botParsingJob.progress = Math.max(botParsingJob.progress, 40);
      if (line.toLowerCase().includes("batch inserted")) botParsingJob.progress = Math.max(botParsingJob.progress, 75);
      if (line.toLowerCase().includes("collected unique users")) botParsingJob.progress = 90;
      if (line.toLowerCase().includes("inserted to backend")) botParsingJob.progress = 95;
    }
  });

  proc.stderr.on("data", (chunk) => {
    const lines = String(chunk)
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const line of lines) pushBotParsingLog(`ERR: ${line}`);
  });

  proc.on("close", (code, signal) => {
    botParsingJob.running = false;
    botParsingJob.finishedAt = nowIso();
    const userStop = botParsingJob.stopRequested;
    botParsingJob.stopRequested = false;
    let finalStatus;
    if (userStop || signal) {
      finalStatus = "stopped";
      botParsingJob.error = null;
      botParsingJob.progress = 0;
    } else {
      botParsingJob.progress = code === 0 ? 100 : botParsingJob.progress;
      finalStatus = code === 0 ? "done" : "error";
      if (code !== 0) botParsingJob.error = `Python bot parser exited with code ${code}`;
    }
    botParsingJob.status = finalStatus;
    if (botParsingJob.audiencePath) {
      try {
        finalizeAudienceFolder(botParsingJob.audiencePath, finalStatus);
      } catch {
        /* ignore */
      }
      if (botParsingJob.audienceDir) botParsingJob.lastAudienceDir = botParsingJob.audienceDir;
      botParsingJob.audiencePath = null;
      botParsingJob.audienceDir = null;
    }
  });

  res.json({ ok: true, pid: botParsingJob.pid, status: botParsingJob.status });
});

app.get("/api/parsing/bot/status", (_req, res) => {
  let liveCount = 0;
  if (botParsingJob.liveFile && fs.existsSync(botParsingJob.liveFile)) {
    const content = fs.readFileSync(botParsingJob.liveFile, "utf-8");
    if (content.trim()) liveCount = content.trim().split("\n").length;
  }
  res.json({
    running: botParsingJob.running,
    pid: botParsingJob.pid,
    status: botParsingJob.status,
    progress: botParsingJob.progress,
    startedAt: botParsingJob.startedAt,
    finishedAt: botParsingJob.finishedAt,
    sourceLink: botParsingJob.sourceLink,
    audienceDir: botParsingJob.audienceDir || botParsingJob.lastAudienceDir,
    liveCount,
    error: botParsingJob.error,
    logs: botParsingJob.logs.slice(0, 80),
  });
});

app.get("/api/parsing/bot/live-results", (_req, res) => {
  if (!botParsingJob.liveFile || !fs.existsSync(botParsingJob.liveFile)) return res.json({ results: [] });
  const content = fs.readFileSync(botParsingJob.liveFile, "utf-8");
  if (!content.trim()) return res.json({ results: [] });
  const lines = content.trim().split("\n").slice(-1000);
  const rows = [];
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line));
    } catch {}
  }
  res.json({ results: rows.reverse() });
});

app.post("/api/parsing/bot/stop", (_req, res) => {
  if (!botParsingJob.running || !botParsingJob.pid) return res.json({ ok: true, stopped: false });
  try {
    botParsingJob.stopRequested = true;
    process.kill(botParsingJob.pid, "SIGTERM");
    botParsingJob.running = false;
    botParsingJob.status = "stopped";
    botParsingJob.finishedAt = nowIso();
    pushBotParsingLog("Остановлено пользователем.");
    return res.json({ ok: true, stopped: true });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

app.post("/api/bot-invites/create", async (req, res) => {
  try {
    const {
      botToken = "",
      chatId = "",
      knownChatTitle = "",
      name = "",
      index = 1,
      expireDate = "",
      memberLimit = 0,
      createsJoinRequest = false,
    } = req.body || {};
    const effectiveBotToken = String(botToken || getSetting("bot_token", "")).trim();
    if (!effectiveBotToken || !chatId) return res.status(400).json({ error: "Нужны botToken (в настройках) и канал" });
    const cidIn = String(chatId).trim();
    const known = String(knownChatTitle || "").trim();
    let resolvedChatId = cidIn;
    let chatTitle = "";
    if (known && /^-?\d+$/.test(cidIn)) {
      resolvedChatId = cidIn;
      chatTitle = known;
    } else {
      const r = await resolveChatForInvite(effectiveBotToken, cidIn);
      resolvedChatId = r.chat_id;
      chatTitle = r.chat_title;
    }
    const finalName = String(name || "").trim() || autoInviteName({ chatTitle, index });
    const payload = {
      chat_id: resolvedChatId,
      name: finalName,
      creates_join_request: Boolean(createsJoinRequest),
    };
    const expireTs = Number(expireDate || 0);
    const mLimit = Number(memberLimit || 0);
    if (Number.isFinite(expireTs) && expireTs > 0) payload.expire_date = expireTs;
    if (Number.isFinite(mLimit) && mLimit > 0) payload.member_limit = Math.max(1, Math.min(99999, mLimit));
    const result = await botApiCall(effectiveBotToken, "createChatInviteLink", payload);
    saveInviteLinkRow({
      invite_link: normalizeInviteLink(result?.invite_link || ""),
      bot_name: tokenAlias(effectiveBotToken),
      chat_id: resolvedChatId,
      chat_title: chatTitle,
      name: String(result?.name || finalName),
      creates_join_request: Boolean(result?.creates_join_request),
      expire_date: result?.expire_date || null,
      member_limit: result?.member_limit || null,
    });
    logEvent(`Bot invite created for chat ${resolvedChatId} (${chatTitle || "no title"})`);
    return res.json({
      ok: true,
      invite: result,
      resolved: { chat_id: resolvedChatId, chat_title: chatTitle },
    });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/api/bot-invites/sync", async (req, res) => {
  try {
    const { botToken = "", limit = 100 } = req.body || {};
    const effectiveBotToken = String(botToken || getSetting("bot_token", "")).trim();
    if (!effectiveBotToken) return res.status(400).json({ error: "Нужен botToken (в настройках)" });
    const botName = tokenAlias(effectiveBotToken);
    const offsetRow = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(`bot_updates_offset_${botName}`);
    const offset = Number(offsetRow?.value || 0) || 0;
    const updates = await botApiCall(effectiveBotToken, "getUpdates", {
      offset,
      timeout: 0,
      allowed_updates: ["message", "chat_member", "chat_join_request"],
      limit: Math.max(1, Math.min(100, Number(limit) || 100)),
    });
    let maxUpdateId = offset;
    let joinsAdded = 0;
    for (const u of Array.isArray(updates) ? updates : []) {
      const updateId = Number(u?.update_id || 0);
      if (updateId > maxUpdateId) maxUpdateId = updateId;
      const already = db
        .prepare("SELECT 1 FROM bot_updates_seen WHERE bot_name = ? AND update_id = ? LIMIT 1")
        .get(botName, updateId);
      if (already) continue;
      db.prepare("INSERT INTO bot_updates_seen (bot_name, update_id, created_at) VALUES (?, ?, ?)").run(botName, updateId, nowIso());
      const candidates = [];
      if (u?.message?.invite_link && Array.isArray(u?.message?.new_chat_members)) {
        const il = normalizeInviteLink(u.message.invite_link?.invite_link ?? u.message.invite_link);
        for (const member of u.message.new_chat_members) {
          candidates.push({
            inviteLink: il,
            userId: member?.id,
            chatId: u?.message?.chat?.id,
            user: member || {},
          });
        }
      }
      if (u?.chat_member?.invite_link && u?.chat_member?.new_chat_member?.user?.id) {
        const il = normalizeInviteLink(u.chat_member.invite_link?.invite_link ?? u.chat_member.invite_link);
        candidates.push({
          inviteLink: il,
          userId: u.chat_member.new_chat_member.user.id,
          chatId: u?.chat_member?.chat?.id,
          user: u?.chat_member?.new_chat_member?.user || {},
        });
      }
      for (const c of candidates) {
        if (!c.inviteLink || !c.userId) continue;
        if (bumpInviteJoin({ ...c, updateId, botName })) joinsAdded += 1;
      }
    }
    const nextOffset = maxUpdateId > 0 ? maxUpdateId + 1 : offset;
    setSetting(`bot_updates_offset_${botName}`, String(nextOffset));
    return res.json({ ok: true, updates: Array.isArray(updates) ? updates.length : 0, joinsAdded, nextOffset });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/api/bot-invites/refresh-meta", async (req, res) => {
  try {
    const { botToken = "", profileLimit = 200, titleLimit = 100 } = req.body || {};
    const effectiveBotToken = String(botToken || getSetting("bot_token", "")).trim();
    if (!effectiveBotToken) return res.status(400).json({ error: "Нужен botToken (в настройках)" });
    const result = await refreshInviteMetadata(effectiveBotToken, { profileLimit, titleLimit });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/api/bot-invites/delete-link", async (req, res) => {
  try {
    const { botToken = "", inviteLink = "" } = req.body || {};
    const effectiveBotToken = String(botToken || getSetting("bot_token", "")).trim();
    const il = normalizeInviteLink(inviteLink);
    if (!effectiveBotToken || !il) return res.status(400).json({ error: "Нужны botToken и inviteLink" });
    const row = db.prepare("SELECT invite_link, chat_id FROM bot_invite_links WHERE invite_link = ? LIMIT 1").get(il);
    if (!row) return res.status(404).json({ error: "Ссылка не найдена" });
    const result = await revokeAndDeleteInviteLinks(effectiveBotToken, [row]);
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/api/bot-invites/delete-channels", async (req, res) => {
  try {
    const { botToken = "", chatIds = [], mode = "selected" } = req.body || {};
    const effectiveBotToken = String(botToken || getSetting("bot_token", "")).trim();
    if (!effectiveBotToken) return res.status(400).json({ error: "Нужен botToken (в настройках)" });
    let rows = [];
    if (String(mode) === "all") {
      rows = db.prepare("SELECT invite_link, chat_id FROM bot_invite_links").all();
    } else {
      const ids = Array.isArray(chatIds) ? chatIds.map((x) => String(x || "").trim()).filter(Boolean) : [];
      if (!ids.length) return res.status(400).json({ error: "Передайте chatIds для selected режима" });
      const placeholders = ids.map(() => "?").join(",");
      rows = db.prepare(`SELECT invite_link, chat_id FROM bot_invite_links WHERE chat_id IN (${placeholders})`).all(...ids);
    }
    const result = await revokeAndDeleteInviteLinks(effectiveBotToken, rows);
    return res.json({ ok: true, linksFound: rows.length, ...result });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
});

app.get("/api/bot/me", async (req, res) => {
  try {
    const token = String(getSetting("bot_token", "")).trim();
    if (!token) return res.json({ ok: true, configured: false, username: "" });
    const me = await botApiCall(token, "getMe", {});
    return res.json({
      ok: true,
      configured: true,
      username: String(me?.username || ""),
      id: String(me?.id || ""),
    });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
});

app.get("/api/bot-invites", (req, res) => {
  const chatId = String(req.query.chatId || "").trim();
  const botName = String(req.query.botName || "").trim();
  const where = [];
  const params = [];
  if (chatId) {
    where.push("chat_id = ?");
    params.push(chatId);
  }
  if (botName) {
    where.push("bot_name = ?");
    params.push(botName);
  }
  const sql = `SELECT invite_link, bot_name, chat_id, chat_title, name, creates_join_request, expire_date, member_limit, join_count, created_at, updated_at
               FROM bot_invite_links
               ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
               ORDER BY updated_at DESC LIMIT 500`;
  const rows = db.prepare(sql).all(...params);
  res.json({
    invites: rows.map((r) => ({
      ...r,
      creates_join_request: Boolean(r.creates_join_request),
      join_count: Number(r.join_count) || 0,
    })),
  });
});

app.get("/api/bot-invites/joins", (req, res) => {
  const chatId = String(req.query.chatId || "").trim();
  const inviteLinkRaw = String(req.query.inviteLink || "").trim();
  const inviteLink = normalizeInviteLink(inviteLinkRaw);
  const where = [];
  const params = [];
  // Ссылка однозначно задаёт вступления; не комбинируем с chat_id (иначе расхождение ID гасит выборку).
  if (inviteLink) {
    where.push("invite_link = ?");
    params.push(inviteLink);
  } else if (chatId) {
    where.push("chat_id = ?");
    params.push(chatId);
  }
  const sql = `SELECT invite_link, user_id, chat_id, username, first_name, last_name, is_premium, joined_at
               FROM bot_invite_joins
               ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
               ORDER BY joined_at DESC
               LIMIT 1000`;
  const rows = db.prepare(sql).all(...params);
  const totalByChannel = db
    .prepare(
      `SELECT j.chat_id,
              COUNT(*) as total,
              (SELECT b.chat_title FROM bot_invite_links b
               WHERE b.chat_id = j.chat_id AND TRIM(COALESCE(b.chat_title, '')) <> ''
               ORDER BY b.updated_at DESC LIMIT 1) AS chat_title
       FROM bot_invite_joins j
       GROUP BY j.chat_id`,
    )
    .all();
  const totalByInvite = db
    .prepare(
      `SELECT invite_link, COUNT(*) as total
       FROM bot_invite_joins
       GROUP BY invite_link`,
    )
    .all();
  res.json({
    joins: rows.map((r) => ({
      ...r,
      is_premium: Boolean(r.is_premium),
    })),
    totals: {
      byChannel: totalByChannel,
      byInvite: totalByInvite,
    },
  });
});

app.post("/api/mailing/ingest", (req, res) => {
  const { rows = [] } = req.body || {};
  if (!Array.isArray(rows)) return res.status(400).json({ error: "rows must be array" });
  const insert = db.prepare(`INSERT INTO outbound_messages (session_name, recipient, error_text, status, created_at) VALUES (@session_name, @recipient, @error_text, @status, @created_at)`);
  const tx = db.transaction((items) => { for (const item of items) insert.run(item); });
  tx(rows);
  res.json({ inserted: rows.length });
});

app.get("/api/mailing/sent-recipients", (_req, res) => {
  const rows = db
    .prepare("SELECT DISTINCT recipient FROM outbound_messages WHERE status = 'sent' AND recipient IS NOT NULL AND recipient <> ''")
    .all();
  const recipients = rows.map((r) => String(r.recipient || "").trim()).filter(Boolean);
  res.json({ recipients, count: recipients.length });
});

app.post("/api/mailing/telethon/start", (req, res) => {
  if (mailingJob.running) return res.status(409).json({ error: "mailing already running" });
  const {
    sessionName = "sessions/main",
    sessionNames = [],
    message = "",
    recipients = [],
    delayMinMs = 400,
    delayMaxMs = 900,
    mailingType = "direct",
    joinRequestBehavior = "skip",
    joinWaitSeconds = 180,
    withMedia = false,
    mediaBase64 = "",
    mediaName = "media.bin",
    aiRewriteEnabled = false,
    aiProvider = "",
    tacticsPreset = "careful_dm",
  } = req.body || {};
  const allowedTactics = new Set(["fast", "balanced", "careful_dm"]);
  const safeTactics = allowedTactics.has(String(tacticsPreset)) ? String(tacticsPreset) : "careful_dm";
  const apiId = getSetting("telegram_api_id", ""); const apiHash = getSetting("telegram_api_hash", "");
  const effectiveAiEnabled = Boolean(aiRewriteEnabled || getSetting("ai_rewrite_enabled", "0") === "1");
  const effectiveAiProvider = String(aiProvider || getSetting("ai_provider", "gemini") || "gemini");
  const aiApiToken = String(getSetting("ai_api_token", "") || "");
  const proxyJson = telethonProxyJsonOrEmpty();
  if (!apiId || !apiHash) return res.status(400).json({ error: "Set Telegram API ID/HASH in settings" });
  if (!message.trim() || !Array.isArray(recipients) || recipients.length === 0) return res.status(400).json({ error: "message and recipients required" });
  if (withMedia && !mediaBase64) return res.status(400).json({ error: "Media is enabled, but file is missing" });
  if (effectiveAiEnabled && !aiApiToken) return res.status(400).json({ error: "AI unique rewrite enabled, but API token is missing in Settings" });
  const finalSessions = Array.isArray(sessionNames) && sessionNames.length ? sessionNames : [sessionName];

  let mediaPath = null;
  if (mediaBase64) {
    try {
      let payload = String(mediaBase64);
      if (payload.includes(",")) payload = payload.slice(payload.indexOf(",") + 1);
      const safeExt = path.extname(String(mediaName || "media.bin")).slice(0, 10) || ".bin";
      mediaPath = path.join(rootDir, "data", `mailing-media-${Date.now()}${safeExt}`);
      fs.writeFileSync(mediaPath, Buffer.from(payload, "base64"));
    } catch (err) {
      return res.status(400).json({ error: `Invalid media file payload: ${String(err.message || err)}` });
    }
  }
  mailingJob.running = true;
  mailingJob.pid = null;
  mailingJob.status = "running";
  mailingJob.progress = 0;
  mailingJob.logs = [];
  mailingJob.error = null;
  mailingJob.audienceTotal = recipients.length;
  mailingJob.liveFile = path.join(rootDir, "data", `mailing-live-${Date.now()}.jsonl`);
  mailingJob.mediaPath = mediaPath;
  try { fs.writeFileSync(mailingJob.liveFile, "", "utf-8"); } catch {}
  pushMailLog("Запуск Telethon-рассылки...");
  if (mailingJob.mediaPath) pushMailLog(`Медиа прикреплено: ${mediaName || path.basename(mailingJob.mediaPath)}`);
  else pushMailLog("Режим: без медиа");

  const args = [
    "-u",
    mailingScript, "--api-id", String(apiId), "--api-hash", String(apiHash), "--sessions-json", JSON.stringify(finalSessions),
    "--message", String(message), "--recipients-json", JSON.stringify(recipients), "--delay-min-ms", String(delayMinMs),
    "--delay-max-ms", String(delayMaxMs), "--mailing-type", String(mailingType), "--join-request-behavior", String(joinRequestBehavior),
    "--join-wait-seconds", String(joinWaitSeconds), "--media-path", String(mailingJob.mediaPath || ""),
    "--ai-rewrite-enabled", effectiveAiEnabled ? "1" : "0",
    "--ai-provider", String(effectiveAiProvider),
    "--ai-api-token", String(aiApiToken),
    "--proxy-json", String(proxyJson),
    "--backend-url", TELETHON_BACKEND_URL, "--live-file", String(mailingJob.liveFile || ""),
    "--tactics-preset", safeTactics,
  ];
  const proc = spawn(resolvePythonExecutable(), args, {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
    windowsHide: process.platform === "win32",
  });
  mailingJob.pid = proc.pid || null;
  proc.stdout.on("data", (c) => {
    const lines = String(c).split("\n").map((s) => s.trim()).filter(Boolean);
    for (const line of lines) {
      pushMailLog(line);
    }
  });
  proc.stderr.on("data", (c) => {
    const lines = String(c).split("\n").map((s) => s.trim()).filter(Boolean);
    for (const line of lines) pushMailLog(`ERR: ${line}`);
  });
  proc.on("close", (code, signal) => {
    mailingJob.running = false;
    if (signal) {
      mailingJob.status = "stopped";
      mailingJob.error = null;
      const live = aggregateMailingLiveFile(mailingJob.liveFile);
      mailingJob.progress =
        mailingJob.audienceTotal > 0
          ? Math.min(100, Math.round((live.processed / mailingJob.audienceTotal) * 100))
          : 0;
    } else {
      mailingJob.status = code === 0 ? "done" : "error";
      if (code === 0) {
        mailingJob.progress = 100;
      } else {
        const liveEnd = aggregateMailingLiveFile(mailingJob.liveFile);
        mailingJob.progress =
          mailingJob.audienceTotal > 0
            ? Math.min(100, Math.round((liveEnd.processed / mailingJob.audienceTotal) * 100))
            : mailingJob.progress;
        mailingJob.error = `Python mailer exited with code ${code}`;
      }
    }
    if (mailingJob.mediaPath && fs.existsSync(mailingJob.mediaPath)) {
      try { fs.unlinkSync(mailingJob.mediaPath); } catch {}
    }
    mailingJob.mediaPath = null;
  });
  res.json({ ok: true, status: mailingJob.status });
});

app.get("/api/mailing/telethon/status", (_req, res) => {
  const live = aggregateMailingLiveFile(mailingJob.liveFile);
  const audienceTotal = mailingJob.audienceTotal || 0;
  let progress = mailingJob.progress;
  if (audienceTotal > 0) {
    progress = Math.min(100, Math.round((live.processed / audienceTotal) * 100));
  }
  if (!mailingJob.running && mailingJob.status === "done") {
    progress = 100;
  }
  const dayAgg = db
    .prepare(
      `SELECT COUNT(*) as total, SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) as sent, SUM(CASE WHEN status IN ('failed','error') THEN 1 ELSE 0 END) as failed FROM outbound_messages WHERE created_at >= datetime('now','-1 day')`,
    )
    .get();
  res.json({
    ...mailingJob,
    progress,
    stats: {
      audienceTotal,
      processed: live.processed,
      sent: live.sent,
      failed: live.failed,
      dayTotal: dayAgg?.total || 0,
      daySent: dayAgg?.sent || 0,
      dayFailed: dayAgg?.failed || 0,
    },
    logs: mailingJob.logs.slice(0, 80),
  });
});

app.post("/api/mailing/telethon/stop", (_req, res) => {
  if (!mailingJob.running || !mailingJob.pid) return res.json({ ok: true, stopped: false });
  try {
    process.kill(mailingJob.pid, "SIGTERM");
    mailingJob.running = false;
    mailingJob.status = "stopped";
    const liveStop = aggregateMailingLiveFile(mailingJob.liveFile);
    mailingJob.progress =
      mailingJob.audienceTotal > 0
        ? Math.min(100, Math.round((liveStop.processed / mailingJob.audienceTotal) * 100))
        : 0;
    if (mailingJob.mediaPath && fs.existsSync(mailingJob.mediaPath)) {
      try { fs.unlinkSync(mailingJob.mediaPath); } catch {}
    }
    mailingJob.mediaPath = null;
    pushMailLog("Остановлено пользователем.");
    return res.json({ ok: true, stopped: true });
  }
  catch (err) { return res.status(500).json({ error: String(err) }); }
});

app.post("/api/reactions/telethon/start", (req, res) => {
  if (reactionsJob.running) return res.status(409).json({ error: "reactions already running" });
  const { sessionName = "sessions/main", sessionNames = [], chatLink = "", emoji = "👍", days = 30, joinWaitSeconds = 15 } = req.body || {};
  const apiId = getSetting("telegram_api_id", "");
  const apiHash = getSetting("telegram_api_hash", "");
  const proxyJson = telethonProxyJsonOrEmpty();
  if (!apiId || !apiHash) return res.status(400).json({ error: "Set Telegram API ID/HASH in settings" });
  if (!chatLink.trim()) return res.status(400).json({ error: "chatLink is required" });
  const allAccountSessions = listAccountsFromSessions()
    .map((a) => String(a?.sessionName || "").trim())
    .filter(Boolean);
  const requestedSessions = Array.isArray(sessionNames)
    ? sessionNames.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  const finalSessions = [...new Set(requestedSessions.length ? requestedSessions : (allAccountSessions.length ? allAccountSessions : [String(sessionName || "sessions/main").trim()]))];

  reactionsJob.running = true;
  reactionsJob.pid = null;
  reactionsJob.status = "running";
  reactionsJob.progress = 3;
  reactionsJob.logs = [];
  reactionsJob.error = null;
  pushReactionsLog("Запуск реакций...");

  const args = [
    "-u",
    reactionsScript,
    "--api-id", String(apiId),
    "--api-hash", String(apiHash),
    "--session", String(finalSessions[0] || sessionName),
    "--sessions-json", JSON.stringify(finalSessions),
    "--chat-link", String(chatLink),
    "--emoji", String(emoji || "👍"),
    "--days", String(Math.max(1, Number(days) || 30)),
    "--join-wait-seconds", String(Math.max(0, Number(joinWaitSeconds) || 0)),
    "--proxy-json", String(proxyJson),
  ];
  const proc = spawn(resolvePythonExecutable(), args, {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
    windowsHide: process.platform === "win32",
  });
  reactionsJob.pid = proc.pid || null;
  proc.stdout.on("data", (c) => {
    const lines = String(c).split("\n").map((s) => s.trim()).filter(Boolean);
    for (const line of lines) {
      pushReactionsLog(line);
      if (line.toLowerCase().includes("reacted")) reactionsJob.progress = Math.min(95, reactionsJob.progress + 2);
    }
  });
  proc.stderr.on("data", (c) => {
    const lines = String(c).split("\n").map((s) => s.trim()).filter(Boolean);
    for (const line of lines) pushReactionsLog(`ERR: ${line}`);
  });
  proc.on("close", (code, signal) => {
    reactionsJob.running = false;
    if (signal) {
      reactionsJob.status = "stopped";
      reactionsJob.error = null;
      reactionsJob.progress = 0;
    } else {
      reactionsJob.status = code === 0 ? "done" : "error";
      reactionsJob.progress = code === 0 ? 100 : reactionsJob.progress;
      if (code !== 0) reactionsJob.error = `Python reactions exited with code ${code}`;
    }
  });
  res.json({ ok: true, status: reactionsJob.status });
});

app.get("/api/reactions/telethon/status", (_req, res) => {
  res.json({ ...reactionsJob, logs: reactionsJob.logs.slice(0, 80) });
});

app.post("/api/reactions/telethon/stop", (_req, res) => {
  if (!reactionsJob.running || !reactionsJob.pid) return res.json({ ok: true, stopped: false });
  try {
    process.kill(reactionsJob.pid, "SIGTERM");
    reactionsJob.running = false;
    reactionsJob.status = "stopped";
    reactionsJob.progress = 0;
    pushReactionsLog("Остановлено пользователем.");
    return res.json({ ok: true, stopped: true });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

app.get("/api/parsing/runs", (_req, res) => {
  const rows = db.prepare("SELECT * FROM parsing_runs ORDER BY id DESC LIMIT 20").all();
  res.json(rows);
});

app.get("/api/dashboard", (_req, res) => {
  const accounts = listAccountsFromSessions();
  const accountsTotal = accounts.length;
  const accountsActive = accounts.filter((a) => a.enabled).length;

  const proxyAgg = db
    .prepare(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END) as online,
        SUM(CASE WHEN status = 'offline' THEN 1 ELSE 0 END) as offline,
        SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as enabled
       FROM proxies`
    )
    .get();

  const parsedCount = db.prepare("SELECT COUNT(*) as c FROM parsed_users").get().c || 0;
  const messagesTotal = db.prepare("SELECT COUNT(*) as c FROM outbound_messages").get().c || 0;
  const messagesErrors =
    db.prepare("SELECT COUNT(*) as c FROM outbound_messages WHERE status IN ('error','failed')").get().c || 0;

  const deliveryRate = messagesTotal > 0 ? ((messagesTotal - messagesErrors) / messagesTotal) * 100 : 0;

  const events = db
    .prepare("SELECT message, created_at FROM system_events ORDER BY id DESC LIMIT 8")
    .all()
    .map((e) => {
      const t = new Date(e.created_at);
      const hh = String(t.getHours()).padStart(2, "0");
      const mm = String(t.getMinutes()).padStart(2, "0");
      return `${hh}:${mm} • ${e.message}`;
    });

  const lastProxyCheck = db.prepare("SELECT MAX(last_checked_at) as ts FROM proxies").get().ts;

  res.json({
    kpi: {
      accountsActive,
      accountsTotal,
      contactsCollected: parsedCount,
      messagesTotal,
      proxiesOnline: proxyAgg?.online || 0,
      proxiesTotal: proxyAgg?.total || 0,
      proxiesOffline: proxyAgg?.offline || 0,
    },
    efficiency: {
      deliveryRate,
      responseRate: 0,
    },
    modules: {
      parsing: { ok: true, text: "Готов", extra: "ожидание задач" },
      mailing: { ok: true, text: "Готов", extra: "активной кампании нет" },
      proxyChecker: {
        ok: true,
        text: "Готов",
        extra: lastProxyCheck ? `последняя проверка: ${new Date(lastProxyCheck).toLocaleString()}` : "проверок пока не было",
      },
      database: { ok: true, text: "Работает", extra: "SQLite подключена" },
    },
    events,
    generatedAt: nowIso(),
  });
});

app.post("/api/database/reset", (req, res) => {
  try {
    const { confirm, includeProxies } = req.body || {};
    if (confirm !== "СБРОС") {
      return res.status(400).json({ error: 'Укажите confirm: "СБРОС" в теле запроса' });
    }
    const wipeProxies = Boolean(includeProxies);
    const run = db.transaction(() => {
      db.prepare("DELETE FROM parsed_users").run();
      db.prepare("DELETE FROM parsing_runs").run();
      db.prepare("DELETE FROM outbound_messages").run();
      db.prepare("DELETE FROM system_events").run();
      db.prepare("DELETE FROM accounts_state").run();
      db.prepare("DELETE FROM profile_style_templates").run();
      db.prepare("DELETE FROM account_spambot_cache").run();
      db.prepare("DELETE FROM account_profiles_cache").run();
      db.prepare("DELETE FROM bot_invite_links").run();
      db.prepare("DELETE FROM bot_invite_joins").run();
      db.prepare("DELETE FROM bot_updates_seen").run();
      if (wipeProxies) db.prepare("DELETE FROM proxies").run();
    });
    run();
    db.prepare(
      "DELETE FROM sqlite_sequence WHERE name IN ('parsed_users','parsing_runs','outbound_messages','system_events','profile_style_templates','bot_invite_joins')",
    ).run();
    if (wipeProxies) db.prepare("DELETE FROM sqlite_sequence WHERE name = 'proxies'").run();
    try {
      db.exec("VACUUM");
    } catch {}
    try {
      db.pragma("wal_checkpoint(FULL)");
    } catch {}
    logEvent(`Сброс SQLite: таблицы данных очищены, счётчики сброшены${wipeProxies ? "; прокси удалены" : ""}`);
    return res.json({ ok: true, includeProxies: wipeProxies });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
});

app.get("/api/database/audiences", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT source_link,
              COUNT(*) as profiles_count,
              SUM(CASE WHEN TRIM(COALESCE(username, '')) <> '' THEN 1 ELSE 0 END) AS with_username,
              SUM(CASE WHEN is_premium = 1 THEN 1 ELSE 0 END) AS premium_count,
              MAX(created_at) AS last_profile_at
       FROM parsed_users
       GROUP BY source_link
       ORDER BY last_profile_at DESC`,
    )
    .all();
  const runs = db
    .prepare(
      `SELECT source_link, COUNT(*) AS runs_count, MAX(created_at) AS last_run_at
       FROM parsing_runs
       GROUP BY source_link`,
    )
    .all();
  const runMap = new Map(runs.map((r) => [String(r.source_link || ""), r]));
  const bySource = new Map();
  for (const r of rows) {
    const key = String(r.source_link || "");
    const rr = runMap.get(key) || {};
    bySource.set(key, {
      source_link: key,
      audience_id: "",
      profiles_count: Number(r.profiles_count) || 0,
      with_username: Number(r.with_username) || 0,
      premium_count: Number(r.premium_count) || 0,
      last_profile_at: r.last_profile_at || null,
      runs_count: Number(rr.runs_count) || 0,
      last_run_at: rr.last_run_at || null,
      folder_user_count: 0,
      folder_status: "",
    });
  }

  const folders = listAudiences(dataDir);
  for (const a of folders) {
    const source = String(a.sourceLink || "").trim();
    if (!source) continue;
    const existing = bySource.get(source);
    if (existing) {
      existing.audience_id = String(a.id || existing.audience_id || "");
      existing.folder_user_count = Number(a.userCount) || 0;
      existing.folder_status = String(a.status || "");
      if (!existing.last_profile_at) existing.last_profile_at = String(a.startedAt || "") || null;
      continue;
    }
    const rr = runMap.get(source) || {};
    bySource.set(source, {
      source_link: source,
      audience_id: String(a.id || ""),
      profiles_count: 0,
      with_username: 0,
      premium_count: 0,
      last_profile_at: String(a.startedAt || "") || null,
      runs_count: Number(rr.runs_count) || 0,
      last_run_at: rr.last_run_at || null,
      folder_user_count: Number(a.userCount) || 0,
      folder_status: String(a.status || ""),
    });
  }

  const audiences = Array.from(bySource.values()).sort((a, b) =>
    String(b.last_profile_at || b.last_run_at || "").localeCompare(String(a.last_profile_at || a.last_run_at || "")),
  );
  return res.json({ audiences });
});

app.get("/api/database/profiles", (req, res) => {
  const audience = String(req.query.audience || "").trim();
  const q = String(req.query.q || "").trim();
  const limit = Math.max(1, Math.min(2000, Number(req.query.limit) || 300));
  const where = [];
  const params = [];
  if (audience) {
    where.push("source_link = ?");
    params.push(audience);
  }
  if (q) {
    where.push("(external_id LIKE ? OR username LIKE ? OR source LIKE ? OR source_link LIKE ?)");
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  const sql = `SELECT id, external_id, username, source, source_link, is_premium, created_at
               FROM parsed_users
               ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
               ORDER BY id DESC
               LIMIT ?`;
  const rows = db.prepare(sql).all(...params, limit);
  return res.json({
    profiles: rows.map((r) => ({ ...r, is_premium: Boolean(r.is_premium) })),
  });
});

app.get("/api/database/account-profiles", (req, res) => {
  const q = String(req.query.q || "").trim();
  const limit = Math.max(1, Math.min(2000, Number(req.query.limit) || 500));
  const where = [];
  const params = [];
  if (q) {
    where.push("(session_name LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR phone LIKE ?)");
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  const sql = `SELECT session_name, first_name, last_name, phone, authorized, updated_at
               FROM account_profiles_cache
               ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
               ORDER BY datetime(updated_at) DESC, session_name ASC
               LIMIT ?`;
  const rows = db.prepare(sql).all(...params, limit);
  return res.json({
    profiles: rows.map((r) => ({ ...r, authorized: Boolean(r.authorized) })),
  });
});

app.patch("/api/database/account-profiles/:sessionName", (req, res) => {
  try {
    const sessionName = decodeURIComponent(req.params.sessionName || "");
    if (!sessionName) return res.status(400).json({ error: "sessionName is required" });
    const { first_name = "", last_name = "", phone = "", authorized = false } = req.body || {};
    const exists = db.prepare("SELECT 1 FROM account_profiles_cache WHERE session_name = ? LIMIT 1").get(sessionName);
    if (!exists) return res.status(404).json({ error: "Профиль аккаунта не найден" });
    db.prepare(
      `UPDATE account_profiles_cache
       SET first_name = ?, last_name = ?, phone = ?, authorized = ?, updated_at = ?
       WHERE session_name = ?`,
    ).run(
      String(first_name || "").trim(),
      String(last_name || "").trim(),
      String(phone || "").trim(),
      authorized ? 1 : 0,
      nowIso(),
      sessionName,
    );
    logEvent(`Редактирование account_profiles_cache: ${sessionName}`);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/api/database/account-profiles/delete", (req, res) => {
  try {
    const { sessionNames = [], all = false } = req.body || {};
    let removed = 0;
    if (all) {
      removed = db.prepare("DELETE FROM account_profiles_cache").run().changes || 0;
    } else {
      const names = Array.isArray(sessionNames) ? sessionNames.map((x) => String(x || "").trim()).filter(Boolean) : [];
      if (!names.length) return res.status(400).json({ error: "Передайте sessionNames или all=true" });
      const placeholders = names.map(() => "?").join(",");
      removed = db.prepare(`DELETE FROM account_profiles_cache WHERE session_name IN (${placeholders})`).run(...names).changes || 0;
    }
    logEvent(`Удаление account_profiles_cache: ${removed}`);
    return res.json({ ok: true, removed });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
});

app.patch("/api/database/profiles/:id", (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    const { username = "", source = "", source_link = "", is_premium = false } = req.body || {};
    if (!id) return res.status(400).json({ error: "Некорректный id" });
    const exists = db.prepare("SELECT id FROM parsed_users WHERE id = ? LIMIT 1").get(id);
    if (!exists) return res.status(404).json({ error: "Профиль не найден" });
    db.prepare(
      `UPDATE parsed_users
       SET username = ?, source = ?, source_link = ?, is_premium = ?
       WHERE id = ?`,
    ).run(String(username || "").trim(), String(source || "").trim(), String(source_link || "").trim(), is_premium ? 1 : 0, id);
    logEvent(`Редактирование профиля parsed_users id=${id}`);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/api/database/profiles/delete", (req, res) => {
  try {
    const { ids = [], audience = "", all = false } = req.body || {};
    let removed = 0;
    if (all) {
      removed = db.prepare("DELETE FROM parsed_users").run().changes || 0;
    } else if (Array.isArray(ids) && ids.length) {
      const cleanIds = ids.map((x) => Number(x || 0)).filter((x) => x > 0);
      if (!cleanIds.length) return res.status(400).json({ error: "Пустой список ids" });
      const placeholders = cleanIds.map(() => "?").join(",");
      removed = db.prepare(`DELETE FROM parsed_users WHERE id IN (${placeholders})`).run(...cleanIds).changes || 0;
    } else if (String(audience || "").trim()) {
      removed = db.prepare("DELETE FROM parsed_users WHERE source_link = ?").run(String(audience).trim()).changes || 0;
    } else {
      return res.status(400).json({ error: "Передайте ids, audience или all=true" });
    }
    logEvent(`Удаление профилей parsed_users: ${removed}`);
    return res.json({ ok: true, removed });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/api/database/audiences/delete", (req, res) => {
  try {
    const { sourceLinks = [], all = false } = req.body || {};
    const tx = db.transaction(() => {
      if (all) {
        const profiles = db.prepare("DELETE FROM parsed_users").run().changes || 0;
        const runs = db.prepare("DELETE FROM parsing_runs").run().changes || 0;
        return { profiles, runs };
      }
      const links = Array.isArray(sourceLinks) ? sourceLinks.map((x) => String(x || "").trim()).filter(Boolean) : [];
      if (!links.length) throw new Error("Передайте sourceLinks или all=true");
      const placeholders = links.map(() => "?").join(",");
      const profiles = db.prepare(`DELETE FROM parsed_users WHERE source_link IN (${placeholders})`).run(...links).changes || 0;
      const runs = db.prepare(`DELETE FROM parsing_runs WHERE source_link IN (${placeholders})`).run(...links).changes || 0;
      return { profiles, runs };
    });
    const out = tx();

    let foldersRemoved = 0;
    const audiences = listAudiences(dataDir);
    const toDeleteIds = [];
    if (all) {
      for (const a of audiences) toDeleteIds.push(String(a.id || ""));
    } else {
      const linksSet = new Set(
        (Array.isArray(sourceLinks) ? sourceLinks : []).map((x) => String(x || "").trim()).filter(Boolean),
      );
      for (const a of audiences) {
        if (linksSet.has(String(a.sourceLink || ""))) toDeleteIds.push(String(a.id || ""));
      }
    }
    for (const id of toDeleteIds) {
      const p = path.join(dataDir, "parsed_audiences", id);
      try {
        if (fs.existsSync(p)) {
          fs.rmSync(p, { recursive: true, force: true });
          foldersRemoved += 1;
        }
      } catch {
        // ignore FS errors, DB cleanup already done
      }
    }

    logEvent(`Удаление аудиторий: профили=${out.profiles}, запуски=${out.runs}, папки=${foldersRemoved}`);
    return res.json({ ok: true, ...out, foldersRemoved });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
});

app.get("/api/database/logs", (req, res) => {
  const q = String(req.query.q || "").trim();
  const limit = Math.max(1, Math.min(2000, Number(req.query.limit) || 500));
  const where = [];
  const params = [];
  if (q) {
    where.push("message LIKE ?");
    params.push(`%${q}%`);
  }
  const sql = `SELECT id, message, created_at FROM system_events
               ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
               ORDER BY id DESC LIMIT ?`;
  const rows = db.prepare(sql).all(...params, limit);
  return res.json({ logs: rows });
});

app.post("/api/database/logs/delete", (req, res) => {
  try {
    const { ids = [], all = false } = req.body || {};
    let removed = 0;
    if (all) {
      removed = db.prepare("DELETE FROM system_events").run().changes || 0;
    } else if (Array.isArray(ids) && ids.length) {
      const cleanIds = ids.map((x) => Number(x || 0)).filter((x) => x > 0);
      if (!cleanIds.length) return res.status(400).json({ error: "Пустой список ids" });
      const placeholders = cleanIds.map(() => "?").join(",");
      removed = db.prepare(`DELETE FROM system_events WHERE id IN (${placeholders})`).run(...cleanIds).changes || 0;
    } else {
      return res.status(400).json({ error: "Передайте ids или all=true" });
    }
    return res.json({ ok: true, removed });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
});

app.get("/api/database", (_req, res) => {
  const tableNames = [
    "proxies",
    "accounts_state",
    "parsed_users",
    "parsing_runs",
    "outbound_messages",
    "system_events",
    "profile_style_templates",
    "account_spambot_cache",
    "account_profiles_cache",
  ];
  const tableStats = tableNames.map((name) => {
    const count = db.prepare(`SELECT COUNT(*) as c FROM ${name}`).get().c || 0;
    return { table: name, rows: count };
  });

  const fileStats = fs.existsSync(dbPath) ? fs.statSync(dbPath) : null;
  const sizeBytes = fileStats?.size || 0;

  const pragma = db.prepare("PRAGMA page_count").get();
  const pragmaSize = db.prepare("PRAGMA page_size").get();
  const approxBytes = (pragma?.page_count || 0) * (pragmaSize?.page_size || 0);

  const recentEvents = db
    .prepare("SELECT id, message, created_at FROM system_events ORDER BY id DESC LIMIT 12")
    .all();

  res.json({
    file: {
      path: dbPath,
      sizeBytes,
      approxBytes,
      updatedAt: fileStats ? new Date(fileStats.mtimeMs).toISOString() : null,
    },
    totals: {
      rows: tableStats.reduce((sum, t) => sum + t.rows, 0),
      tables: tableStats.length,
    },
    tables: tableStats,
    recentEvents,
    health: {
      writable: true,
      journalMode: db.prepare("PRAGMA journal_mode").get().journal_mode,
      foreignKeys: db.prepare("PRAGMA foreign_keys").get().foreign_keys,
    },
    generatedAt: nowIso(),
  });
});

if (serveStatic) {
  const indexHtml = path.join(staticRoot, "index.html");
  if (!fs.existsSync(indexHtml)) {
    console.warn(
      `[static] ${indexHtml} not found — run "npm run build" before production start.`,
    );
  } else {
    app.use(
      express.static(staticRoot, {
        index: false,
        maxAge: "1h",
      }),
    );
    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      if (req.path.startsWith("/api")) return next();
      res.sendFile(indexHtml);
    });
    app.use((req, res) => {
      if (req.path.startsWith("/api")) {
        return res.status(404).json({ error: "Not found" });
      }
      res.status(404).type("text/plain").send("Not found");
    });
  }
}

app.listen(PORT, () => {
  const mode =
    serveStatic && fs.existsSync(path.join(staticRoot, "index.html")) ? "api+static" : "api";
  console.log(`Server (${mode}) on http://localhost:${PORT}`);
});
