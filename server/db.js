import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const rootDir = path.resolve(process.cwd());
const dataDir = path.join(rootDir, "data");
const sessionsDir = path.join(rootDir, "sessions");

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });

const dbPath = path.join(dataDir, "app.db");
const db = new Database(dbPath);

const hasColumn = (table, column) => {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((r) => r.name === column);
};

db.exec(`
  CREATE TABLE IF NOT EXISTS proxies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    login TEXT DEFAULT '',
    pass TEXT DEFAULT '',
    protocol TEXT NOT NULL DEFAULT 'HTTP/S',
    status TEXT NOT NULL DEFAULT 'unknown',
    enabled INTEGER NOT NULL DEFAULT 1,
    latency_ms INTEGER,
    last_checked_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts_state (
    session_name TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS parsed_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT NOT NULL,
    username TEXT,
    source TEXT,
    source_link TEXT,
    is_premium INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

if (!hasColumn("parsed_users", "source_link")) {
  db.exec(`ALTER TABLE parsed_users ADD COLUMN source_link TEXT;`);
}
if (!hasColumn("parsed_users", "is_premium")) {
  db.exec(`ALTER TABLE parsed_users ADD COLUMN is_premium INTEGER NOT NULL DEFAULT 0;`);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS parsing_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_link TEXT NOT NULL,
    source_mode TEXT NOT NULL,
    period_days INTEGER NOT NULL,
    premium_filter TEXT NOT NULL,
    result_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS outbound_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_name TEXT,
    recipient TEXT,
    error_text TEXT,
    status TEXT NOT NULL DEFAULT 'sent',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

if (!hasColumn("outbound_messages", "session_name")) db.exec(`ALTER TABLE outbound_messages ADD COLUMN session_name TEXT;`);
if (!hasColumn("outbound_messages", "recipient")) db.exec(`ALTER TABLE outbound_messages ADD COLUMN recipient TEXT;`);
if (!hasColumn("outbound_messages", "error_text")) db.exec(`ALTER TABLE outbound_messages ADD COLUMN error_text TEXT;`);

db.exec(`
  CREATE TABLE IF NOT EXISTS system_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS account_spambot_cache (
    session_name TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'unknown',
    summary TEXT NOT NULL DEFAULT '',
    bot_reply TEXT NOT NULL DEFAULT '',
    error TEXT NOT NULL DEFAULT '',
    checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS account_profiles_cache (
    session_name TEXT PRIMARY KEY,
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    authorized INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS profile_style_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    username TEXT NOT NULL DEFAULT '',
    bio TEXT NOT NULL DEFAULT '',
    photo_base64 TEXT NOT NULL DEFAULT '',
    clear_photo INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS bot_invite_links (
    invite_link TEXT PRIMARY KEY,
    bot_name TEXT NOT NULL DEFAULT '',
    chat_id TEXT NOT NULL DEFAULT '',
    chat_title TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    creates_join_request INTEGER NOT NULL DEFAULT 0,
    expire_date INTEGER,
    member_limit INTEGER,
    join_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

if (!hasColumn("bot_invite_links", "chat_title")) db.exec(`ALTER TABLE bot_invite_links ADD COLUMN chat_title TEXT NOT NULL DEFAULT '';`);

db.exec(`
  CREATE TABLE IF NOT EXISTS bot_invite_joins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invite_link TEXT NOT NULL,
    user_id TEXT NOT NULL,
    chat_id TEXT NOT NULL DEFAULT '',
    update_id INTEGER,
    joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(invite_link, user_id)
  );
`);

if (!hasColumn("bot_invite_joins", "username")) db.exec(`ALTER TABLE bot_invite_joins ADD COLUMN username TEXT DEFAULT '';`);
if (!hasColumn("bot_invite_joins", "first_name")) db.exec(`ALTER TABLE bot_invite_joins ADD COLUMN first_name TEXT DEFAULT '';`);
if (!hasColumn("bot_invite_joins", "last_name")) db.exec(`ALTER TABLE bot_invite_joins ADD COLUMN last_name TEXT DEFAULT '';`);
if (!hasColumn("bot_invite_joins", "is_premium")) db.exec(`ALTER TABLE bot_invite_joins ADD COLUMN is_premium INTEGER NOT NULL DEFAULT 0;`);

db.exec(`
  CREATE TABLE IF NOT EXISTS bot_updates_seen (
    bot_name TEXT NOT NULL,
    update_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (bot_name, update_id)
  );
`);

export { db, dbPath, dataDir, sessionsDir };
