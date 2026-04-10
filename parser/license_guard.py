import os
import sqlite3
import socket
import json
import urllib.error
import urllib.request
from datetime import datetime, timezone

DEFAULT_LICENSE_API_URL = "http://5.42.122.59:8090"


def ensure_license_valid() -> None:
    """
    Hard stop for any parser script if license is not active.
    Reads local SQLite app settings (shared with server).
    """
    if os.getenv("SOFTPROG_DISABLE_LICENSE") == "1":
        return
    db_path = os.path.join(os.getcwd(), "data", "app.db")
    if not os.path.exists(db_path):
        raise RuntimeError("License storage not found")
    conn = sqlite3.connect(db_path)
    try:
        cur = conn.cursor()
        cur.execute("SELECT value FROM app_settings WHERE key = 'license_unlocked' LIMIT 1")
        row = cur.fetchone()
        unlocked = bool(row and str(row[0]) == "1")
        cur.execute("SELECT value FROM app_settings WHERE key = 'license_revoked_at' LIMIT 1")
        revoked = cur.fetchone()
        revoked_at = str(revoked[0]).strip() if revoked and revoked[0] is not None else ""
        cur.execute("SELECT value FROM app_settings WHERE key = 'license_expires_at' LIMIT 1")
        expires_row = cur.fetchone()
        expires_at_raw = str(expires_row[0]).strip() if expires_row and expires_row[0] is not None else ""
        cur.execute("SELECT value FROM app_settings WHERE key = 'license_bound_ip' LIMIT 1")
        ip_row = cur.fetchone()
        bound_ip = str(ip_row[0]).strip() if ip_row and ip_row[0] is not None else ""
        cur.execute("SELECT value FROM app_settings WHERE key = 'license_active_key' LIMIT 1")
        key_row = cur.fetchone()
        active_key = str(key_row[0]).strip() if key_row and key_row[0] is not None else ""
    finally:
        conn.close()
    expired = False
    if expires_at_raw:
        try:
            dt = datetime.fromisoformat(expires_at_raw.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            expired = dt.astimezone(timezone.utc) <= datetime.now(tz=timezone.utc)
        except ValueError:
            expired = True

    current_ip = _get_local_ip()
    ip_mismatch = bool(bound_ip) and bound_ip != current_ip

    if not unlocked or revoked_at or expired or ip_mismatch:
        raise RuntimeError("License is not active")
    _ensure_remote_license_active(active_key)
    _bump_usage_counter(db_path, active_key)
    _send_usage_ping(active_key, db_path)


def _get_local_ip() -> str:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        ip = sock.getsockname()[0]
        return str(ip or "").strip()
    except OSError:
        return "127.0.0.1"
    finally:
        sock.close()


def _bump_usage_counter(db_path: str, license_key: str) -> None:
    if not license_key:
        return
    conn = sqlite3.connect(db_path)
    try:
        cur = conn.cursor()
        if not _table_exists(cur, "licenses"):
            return
        _ensure_usage_columns(cur)
        now = datetime.now(tz=timezone.utc).isoformat()
        cur.execute(
            """
            UPDATE licenses
            SET usage_count = COALESCE(usage_count, 0) + 1,
                last_used_at = ?,
                updated_at = COALESCE(updated_at, ?)
            WHERE license_key = ?
            """,
            (now, now, license_key),
        )
        conn.commit()
    finally:
        conn.close()


def _ensure_usage_columns(cur: sqlite3.Cursor) -> None:
    cur.execute("PRAGMA table_info(licenses)")
    cols = {str(row[1]) for row in cur.fetchall()}
    if "usage_count" not in cols:
        cur.execute("ALTER TABLE licenses ADD COLUMN usage_count INTEGER NOT NULL DEFAULT 0")
    if "last_used_at" not in cols:
        cur.execute("ALTER TABLE licenses ADD COLUMN last_used_at TEXT")


def _table_exists(cur: sqlite3.Cursor, table_name: str) -> bool:
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1", (table_name,))
    return cur.fetchone() is not None


def _send_usage_ping(license_key: str, db_path: str) -> None:
    if not license_key:
        return
    usage_url = str(os.getenv("SOFTPROG_LICENSE_USAGE_URL", DEFAULT_LICENSE_API_URL)).strip().rstrip("/")
    if not usage_url:
        return
    api_key = str(os.getenv("SOFTPROG_LICENSE_API_KEY", "")).strip()
    if not api_key:
        return
    metrics = _collect_soft_metrics(db_path)
    endpoint = f"{usage_url}/licenses/{license_key}/usage/ping"
    payload = metrics
    data = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["X-API-Key"] = api_key
    req = urllib.request.Request(
        endpoint,
        data=data,
        method="POST",
        headers=headers,
    )
    try:
        with urllib.request.urlopen(req, timeout=1.5):
            pass
    except Exception:
        # Usage sync must not block parser execution.
        pass


def _ensure_remote_license_active(license_key: str) -> None:
    if not license_key:
        raise RuntimeError("License key not set")
    usage_url = str(os.getenv("SOFTPROG_LICENSE_USAGE_URL", DEFAULT_LICENSE_API_URL)).strip().rstrip("/")
    if not usage_url:
        return
    api_key = str(os.getenv("SOFTPROG_LICENSE_API_KEY", "")).strip()
    endpoint = f"{usage_url}/licenses/{license_key}"
    headers = {"X-API-Key": api_key} if api_key else {}
    req = urllib.request.Request(endpoint, method="GET", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=2.0) as response:
            raw = response.read().decode("utf-8", errors="ignore")
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403, 404):
            raise RuntimeError("License is not active") from exc
        raise RuntimeError("License server unavailable") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError("License server unavailable") from exc
    except Exception as exc:
        raise RuntimeError("License validation failed") from exc
    try:
        payload = json.loads(raw or "{}")
    except json.JSONDecodeError as exc:
        raise RuntimeError("License validation returned invalid JSON") from exc
    status = str(payload.get("status", "")).strip().lower()
    if status != "active":
        raise RuntimeError("License is not active")


def _collect_soft_metrics(db_path: str) -> dict:
    conn = sqlite3.connect(db_path)
    try:
        cur = conn.cursor()
        parsed_count = _safe_count(cur, "SELECT COUNT(*) FROM parsed_users")
        sent_count = _safe_count(cur, "SELECT COUNT(*) FROM outbound_messages")
        accounts_count = _safe_count(cur, "SELECT COUNT(*) FROM account_profiles_cache")
        success_count = _safe_count(cur, "SELECT COUNT(*) FROM outbound_messages WHERE status = 'sent'")
        error_count = _safe_count(cur, "SELECT COUNT(*) FROM outbound_messages WHERE status IN ('failed','error')")
        return {
            "parsed_count": parsed_count,
            "sent_count": sent_count,
            "accounts_count": accounts_count,
            "success_count": success_count,
            "error_count": error_count,
        }
    finally:
        conn.close()


def _safe_count(cur: sqlite3.Cursor, query: str) -> int:
    try:
        cur.execute(query)
        row = cur.fetchone()
        return int(row[0] or 0) if row else 0
    except sqlite3.Error:
        return 0
