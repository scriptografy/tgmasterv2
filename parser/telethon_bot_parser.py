import argparse
import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List
import json
import os
import requests
from telethon import TelegramClient
from telethon.errors import RPCError
from telethon.tl.functions.channels import GetParticipantsRequest
from telethon.tl.types import InputPeerChannel
from telethon.tl.types import ChannelParticipantsSearch
from telethon.tl.types import Channel
from telethon.tl.types import PeerChannel
from telethon.tl.types import User
from proxy_utils import build_telethon_proxy
from license_guard import ensure_license_valid

ensure_license_valid()


@dataclass
class ParsedUser:
    external_id: str
    username: str
    source: str
    source_link: str
    is_premium: bool
    created_at: str


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Telegram channel members parser (bot token) on Telethon")
    p.add_argument("--api-id", type=int, required=True, help="Telegram API ID")
    p.add_argument("--api-hash", type=str, required=True, help="Telegram API HASH")
    p.add_argument("--bot-token", type=str, required=True, help="Bot token")
    p.add_argument("--target", type=str, default="", help="Channel target (@username or link)")
    p.add_argument("--channel-id", type=str, default="", help="Channel id: -100..., 100..., or raw id")
    p.add_argument("--limit", type=int, default=0, help="0 = no overall limit")
    p.add_argument("--alphabet-scan", type=int, default=1, help="1=scan by alphabet+digits queries")
    p.add_argument("--backend-url", type=str, default="http://localhost:8787", help="Backend base URL")
    p.add_argument("--live-file", type=str, default="", help="Optional JSONL file for live UI updates")
    p.add_argument("--proxy-json", type=str, default="", help="Optional proxy config JSON")
    return p.parse_args()


def iso_utc(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def send_to_backend(backend_url: str, rows: List[ParsedUser]) -> int:
    payload = {
        "rows": [
            {
                "external_id": row.external_id,
                "username": row.username,
                "source": row.source,
                "source_link": row.source_link,
                "is_premium": row.is_premium,
                "created_at": row.created_at,
            }
            for row in rows
        ]
    }
    res = requests.post(f"{backend_url.rstrip('/')}/api/parsing/ingest", json=payload, timeout=30)
    res.raise_for_status()
    return int(res.json().get("inserted", 0))


def append_live_rows(live_file: str, rows: List[ParsedUser]) -> None:
    if not live_file or not rows:
        return
    os.makedirs(os.path.dirname(live_file), exist_ok=True)
    with open(live_file, "a", encoding="utf-8") as f:
        for row in rows:
            f.write(
                json.dumps(
                    {
                        "id": row.external_id,
                        "username": row.username,
                        "source": "Бот-админ",
                        "isPremium": row.is_premium,
                        "lastActivityAt": row.created_at,
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )


def normalize_channel_id(raw: str) -> int:
    s = str(raw or "").strip()
    if not s:
        return 0
    if s.startswith("-100"):
        s = s[4:]
    if s.startswith("+"):
        s = s[1:]
    try:
        return abs(int(s))
    except Exception:
        return 0


def load_channel_access_cache() -> Dict[str, Dict[str, str]]:
    p = os.path.join(os.getcwd(), "data", "channel_access_cache.json")
    try:
        if not os.path.exists(p):
            return {}
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def save_channel_access_cache(cache: Dict[str, Dict[str, str]]) -> None:
    p = os.path.join(os.getcwd(), "data", "channel_access_cache.json")
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)


def remember_channel_access(entity: Channel) -> None:
    try:
        cid = int(getattr(entity, "id", 0) or 0)
        ah = int(getattr(entity, "access_hash", 0) or 0)
        if cid <= 0 or ah == 0:
            return
        cache = load_channel_access_cache()
        cache[str(cid)] = {
            "access_hash": str(ah),
            "username": str(getattr(entity, "username", "") or ""),
            "title": str(getattr(entity, "title", "") or ""),
            "updated_at": datetime.now(tz=timezone.utc).isoformat(),
        }
        save_channel_access_cache(cache)
    except Exception:
        return


async def main() -> None:
    args = parse_args()
    raw_limit = int(args.limit or 0)
    safe_limit = 0 if raw_limit <= 0 else max(1, min(50000, raw_limit))
    alphabet_scan = bool(int(args.alphabet_scan or 1))
    print("Channel members parser started", flush=True)
    print(f"Target: {args.target or '(none)'}", flush=True)
    print(f"Channel ID: {args.channel_id or '(none)'}", flush=True)
    print(f"Limit: {'unlimited' if safe_limit == 0 else safe_limit}", flush=True)

    client = TelegramClient("bot_admin_parser_runtime", args.api_id, args.api_hash, proxy=build_telethon_proxy(args.proxy_json))
    try:
        await client.start(bot_token=args.bot_token)
        me = await client.get_me()
        print(f"Bot authorized: {getattr(me, 'username', '') or getattr(me, 'id', '')}", flush=True)
        normalized_id = normalize_channel_id(args.channel_id)
        try:
            if normalized_id > 0:
                try:
                    entity = await client.get_entity(PeerChannel(normalized_id))
                except Exception:
                    try:
                        entity = await client.get_entity(int(f"-100{normalized_id}"))
                    except Exception:
                        cache = load_channel_access_cache()
                        c = cache.get(str(normalized_id)) or {}
                        ah_raw = c.get("access_hash")
                        if ah_raw:
                            entity = await client.get_entity(InputPeerChannel(normalized_id, int(ah_raw)))
                        else:
                            raise RuntimeError(
                                "Не удалось открыть канал только по ID: для MTProto нужен access_hash. "
                                "Сделайте 1 запуск с @username/ссылкой этого канала, после чего ID будет работать из кэша."
                            )
            elif str(args.target or "").strip():
                entity = await client.get_entity(args.target)
            else:
                raise RuntimeError("Укажите target или channel_id")
        except RPCError as e:
            raise RuntimeError(
                "Не удалось открыть канал для бота. "
                "Можно указывать channel_id в форматах -100..., 100... или raw id; "
                "либо публичный @username/ссылку. "
                f"Ошибка: {e}"
            ) from e
        print("Source entity resolved", flush=True)
        if isinstance(entity, Channel):
            remember_channel_access(entity)
        if not isinstance(entity, Channel):
            raise RuntimeError("Источник должен быть именно каналом Telegram.")
        if not bool(getattr(entity, "broadcast", False)):
            raise RuntimeError("Указан не канал подписчиков (это чат/обсуждения). Укажите ссылку на канал.")

        now = iso_utc(datetime.now(tz=timezone.utc))
        seen: Dict[int, ParsedUser] = {}
        batch: List[ParsedUser] = []
        inserted_total = 0
        alphabet_queries = list("abcdefghijklmnopqrstuvwxyz") + list("абвгдеёжзийклмнопрстуфхцчшщъыьэюя") + list("0123456789")
        print(
            f"Scan mode: {'alphabet+digits' if alphabet_scan else 'plain'}; queries={len(alphabet_queries) if alphabet_scan else 1}",
            flush=True,
        )

        async def scan_with_query(query: str) -> None:
            nonlocal batch, inserted_total
            offset = 0
            page_limit = 100
            while True:
                if safe_limit > 0 and len(seen) >= safe_limit:
                    return
                try:
                    result = await client(
                        GetParticipantsRequest(
                            channel=entity,
                            filter=ChannelParticipantsSearch(query),
                            offset=offset,
                            limit=page_limit,
                            hash=0,
                        )
                    )
                except RPCError as e:
                    print(f"Skip query '{query}': {e}", flush=True)
                    return
                users_page = [u for u in result.users if isinstance(u, User) and not bool(getattr(u, "bot", False))]
                if not users_page:
                    return
                for user in users_page:
                    if user.id in seen:
                        continue
                    row = ParsedUser(
                        external_id=str(user.id),
                        username=f"@{user.username}" if getattr(user, "username", None) else "",
                        source="channel_members",
                    source_link=args.target,
                        is_premium=bool(getattr(user, "premium", False)),
                        created_at=now,
                    )
                    seen[user.id] = row
                    batch.append(row)
                    if safe_limit > 0 and len(seen) >= safe_limit:
                        break
                if len(batch) >= 50:
                    inserted = send_to_backend(args.backend_url, batch)
                    append_live_rows(args.live_file, batch)
                    inserted_total += inserted
                    print(f"Batch inserted: {inserted} (total: {inserted_total})", flush=True)
                    batch = []
                if len(result.users) < page_limit:
                    return
                offset += len(result.users)
                await asyncio.sleep(0.15)

        if alphabet_scan:
            # First pass without search captures users missed by prefix search in some channel types.
            await scan_with_query("")
            for q in alphabet_queries:
                if safe_limit > 0 and len(seen) >= safe_limit:
                    break
                print(f"Search query: '{q}'", flush=True)
                await scan_with_query(q)
        else:
            await scan_with_query("")

        if batch:
            inserted = send_to_backend(args.backend_url, batch)
            append_live_rows(args.live_file, batch)
            inserted_total += inserted
            print(f"Batch inserted: {inserted} (total: {inserted_total})", flush=True)

        print(f"Collected unique users: {len(seen)}", flush=True)
        print(f"Inserted to backend: {inserted_total}", flush=True)
        print("Channel members parser finished", flush=True)
    finally:
        await client.disconnect()


asyncio.run(main())
