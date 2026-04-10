import argparse
import json
import os
import sqlite3
import socket
from datetime import datetime, timezone


def _parse_dt(value: str) -> datetime:
    fixed = str(value).strip().replace("Z", "+00:00")
    dt = datetime.fromisoformat(fixed)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _check_db_license(password: str, check_only: bool = False) -> dict:
    db_path = os.path.join(os.getcwd(), "data", "app.db")
    if not os.path.exists(db_path):
        return {"ok": False, "message": "База лицензий не найдена"}

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        cur = conn.cursor()
        _ensure_usage_columns(cur)
        cur.execute(
            """
            SELECT license_key, status, expires_at, max_activations, activations_count
            FROM licenses
            WHERE license_key = ?
            LIMIT 1
            """,
            (password,),
        )
        row = cur.fetchone()
        if not row:
            return {"ok": False, "message": "Неверный лицензионный ключ"}

        status = str(row["status"] or "").strip().lower()
        if status != "active":
            return {"ok": False, "message": "Лицензия не активна"}

        expires_at = _parse_dt(str(row["expires_at"] or ""))
        now = datetime.now(tz=timezone.utc)
        if expires_at <= now:
            cur.execute(
                "UPDATE licenses SET status = ?, updated_at = ? WHERE license_key = ?",
                ("expired", now.isoformat(), password),
            )
            conn.commit()
            return {"ok": False, "message": "Срок лицензии истек"}

        if not check_only:
            max_activations = int(row["max_activations"] or 1)
            activations_count = int(row["activations_count"] or 0)
            if activations_count >= max_activations:
                return {"ok": False, "message": "Превышен лимит активаций"}

            cur.execute(
                """
                UPDATE licenses
                SET activations_count = activations_count + 1, updated_at = ?
                WHERE license_key = ?
                """,
                (now.isoformat(), password),
            )
            conn.commit()
        return {
            "ok": True,
            "message": "Лицензия валидна" if check_only else "Лицензия активирована",
            "expires_at": expires_at.isoformat(),
            "license_key": password,
            "bound_ip": _get_local_ip(),
        }
    finally:
        conn.close()


def _get_local_ip() -> str:
    # Resolve outbound interface IP without external HTTP requests.
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        ip = sock.getsockname()[0]
        return str(ip or "").strip()
    except OSError:
        return "127.0.0.1"
    finally:
        sock.close()


def _ensure_usage_columns(cur: sqlite3.Cursor) -> None:
    cur.execute("PRAGMA table_info(licenses)")
    cols = {str(row[1]) for row in cur.fetchall()}
    if "usage_count" not in cols:
        cur.execute("ALTER TABLE licenses ADD COLUMN usage_count INTEGER NOT NULL DEFAULT 0")
    if "last_used_at" not in cols:
        cur.execute("ALTER TABLE licenses ADD COLUMN last_used_at TEXT")


def main():
    p = argparse.ArgumentParser(description="License checker")
    p.add_argument("--password", type=str, default="")
    p.add_argument("--check-only", action="store_true")
    args = p.parse_args()
    password = str(args.password or "").strip()
    payload = _check_db_license(password, check_only=bool(args.check_only))

    print(json.dumps(payload, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
