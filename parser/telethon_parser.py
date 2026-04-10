import argparse
import asyncio
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import AsyncIterable, Dict, List
import os
import shutil
import tempfile
import json
import requests
from telethon import TelegramClient
from telethon.errors import InviteRequestSentError, MsgIdInvalidError, PeerIdInvalidError, UserAlreadyParticipantError
from telethon.tl.functions.channels import GetFullChannelRequest
from telethon.tl.functions.messages import ImportChatInviteRequest
from telethon.tl.custom.message import Message
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

def iso_utc(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Telegram parser on Telethon')
    parser.add_argument('--api-id', type=int, required=True, help='Telegram API ID')
    parser.add_argument('--api-hash', type=str, required=True, help='Telegram API HASH')
    parser.add_argument('--session', type=str, required=True, help='Path/name for Telethon session file')
    parser.add_argument('--source-link', type=str, required=True, help='Source chat/channel link')
    parser.add_argument('--source-mode', type=str, default='both', choices=['both'], help='Reserved: auto mode only')
    parser.add_argument('--days', type=int, default=30, help='Activity period in days')
    parser.add_argument('--variant', type=str, default='smart', choices=['smart', 'chat_authors', 'discussion_authors', 'all_recent', 'premium_active', 'ids_only'], help='Parsing strategy variant')
    parser.add_argument('--premium-filter', type=str, default='all', choices=['all', 'premium', 'non_premium'], help='Premium filter')
    parser.add_argument('--backend-url', type=str, default='http://localhost:8787', help='Backend base URL')
    parser.add_argument('--live-file', type=str, default='', help='Optional JSONL file for live UI updates')
    parser.add_argument('--proxy-json', type=str, default='', help='Optional proxy config JSON')
    parser.add_argument('--join-wait-seconds', type=int, default=20, help='Wait seconds after join request')
    return parser.parse_args()

def parse_invite_hash(source_link: str) -> str:
    s = (source_link or '').strip()
    if not s:
        return ''
    if 't.me/+' in s:
        return s.split('t.me/+', 1)[1].split('?', 1)[0].split('/', 1)[0].strip()
    if 'joinchat/' in s:
        return s.split('joinchat/', 1)[1].split('?', 1)[0].split('/', 1)[0].strip()
    return ''

async def ensure_entity(client: TelegramClient, source_link: str, join_wait_seconds: int):
    try:
        return await client.get_entity(source_link)
    except ValueError:
        invite_hash = parse_invite_hash(source_link)
        if not invite_hash:
            raise
        print('Source is invite link, trying to join...', flush=True)
        try:
            await client(ImportChatInviteRequest(invite_hash))
            print('Joined by invite link', flush=True)
        except UserAlreadyParticipantError:
            print('Already in target by invite link', flush=True)
        except InviteRequestSentError:
            wait_s = max(1, int(join_wait_seconds or 20))
            print(f'Join request sent, waiting {wait_s}s...', flush=True)
            await asyncio.sleep(wait_s)
        return await client.get_entity(source_link)

async def resolve_discussion_entity(client: TelegramClient, source_entity):
    try:
        full = await client(GetFullChannelRequest(source_entity))
        linked_chat_id = getattr(getattr(full, 'full_chat', None), 'linked_chat_id', None)
        if not linked_chat_id:
            return source_entity
        linked = await client.get_entity(linked_chat_id)
        print('Linked discussion chat resolved', flush=True)
        return linked
    except Exception:
        return source_entity

def premium_match(user: User, premium_filter: str) -> bool:
    is_premium = bool(getattr(user, 'premium', False))
    if premium_filter == 'premium':
        return is_premium
    if premium_filter == 'non_premium':
        return not is_premium
    return True

def build_row(user: User, source: str, source_link: str, created_at: datetime) -> ParsedUser:
    username = f'@{user.username}' if getattr(user, 'username', None) else ''
    return ParsedUser(external_id=str(user.id), username=username, source=source, source_link=source_link, is_premium=bool(getattr(user, 'premium', False)), created_at=iso_utc(created_at))

async def iter_chat_users(client: TelegramClient, entity, from_dt: datetime, premium_filter: str, source_link: str, sender_cache: Dict[int, User], ids_only: bool, source_kind: str='chats') -> AsyncIterable[ParsedUser]:
    seen: Dict[int, ParsedUser] = {}
    async for msg in client.iter_messages(entity, reverse=False):
        if not isinstance(msg, Message):
            continue
        if not msg.date:
            continue
        msg_dt = msg.date.astimezone(timezone.utc)
        if msg_dt < from_dt:
            break
        if not msg.sender_id:
            continue
        sender = sender_cache.get(msg.sender_id)
        if sender is None:
            sender = await msg.get_sender()
            if isinstance(sender, User):
                sender_cache[msg.sender_id] = sender
        if not isinstance(sender, User):
            continue
        if not premium_match(sender, premium_filter):
            continue
        if sender.id not in seen:
            row = build_row(sender, source_kind, source_link, msg_dt)
            if ids_only:
                row.username = ''
            seen[sender.id] = row
            yield seen[sender.id]

async def iter_discussion_users(client: TelegramClient, entity, from_dt: datetime, premium_filter: str, source_link: str, sender_cache: Dict[int, User], ids_only: bool) -> AsyncIterable[ParsedUser]:
    seen: Dict[int, ParsedUser] = {}
    posts_scanned = 0
    async for post in client.iter_messages(entity, reverse=False):
        if not post or not post.id or (not post.date):
            continue
        if post.date.astimezone(timezone.utc) < from_dt:
            break
        posts_scanned += 1
        if posts_scanned > 200:
            break
        try:
            async for reply in client.iter_messages(entity, reply_to=post.id):
                if not reply or not reply.date or (not reply.sender_id):
                    continue
                reply_dt = reply.date.astimezone(timezone.utc)
                if reply_dt < from_dt:
                    continue
                sender = sender_cache.get(reply.sender_id)
                if sender is None:
                    sender = await reply.get_sender()
                    if isinstance(sender, User):
                        sender_cache[reply.sender_id] = sender
                if not isinstance(sender, User):
                    continue
                if not premium_match(sender, premium_filter):
                    continue
                if sender.id not in seen:
                    row = build_row(sender, 'discussions', source_link, reply_dt)
                    if ids_only:
                        row.username = ''
                    seen[sender.id] = row
                    yield seen[sender.id]
        except (PeerIdInvalidError, MsgIdInvalidError):
            print(f'Skip post {post.id}: discussion thread unavailable', flush=True)
            continue

def send_to_backend(backend_url: str, rows: List[ParsedUser]) -> int:
    payload = {'rows': [{'external_id': row.external_id, 'username': row.username, 'source': row.source, 'source_link': row.source_link, 'is_premium': row.is_premium, 'created_at': row.created_at} for row in rows]}
    res = requests.post(f"{backend_url.rstrip('/')}/api/parsing/ingest", json=payload, timeout=30)
    res.raise_for_status()
    return int(res.json().get('inserted', 0))

def append_live_rows(live_file: str, rows: List[ParsedUser]) -> None:
    if not live_file or not rows:
        return
    os.makedirs(os.path.dirname(live_file), exist_ok=True)
    with open(live_file, 'a', encoding='utf-8') as f:
        for row in rows:
            f.write(json.dumps({'id': row.external_id, 'username': row.username, 'source': 'Чаты' if row.source == 'chats' else 'Обсуждения', 'isPremium': row.is_premium, 'lastActivityAt': row.created_at}, ensure_ascii=False) + '\n')

async def main() -> None:
    args = parse_args()
    from_dt = datetime.now(tz=timezone.utc) - timedelta(days=max(1, args.days))
    print(f'Parser started for {args.source_link}', flush=True)
    print(f'Join wait configured: {max(1, int(args.join_wait_seconds or 20))}s', flush=True)
    session_base = args.session
    source_session_file = f'{session_base}.session'
    runtime_dir = tempfile.mkdtemp(prefix='telethon_runtime_')
    runtime_base = os.path.join(runtime_dir, 'session')
    runtime_session_file = f'{runtime_base}.session'
    if os.path.exists(source_session_file):
        shutil.copy2(source_session_file, runtime_session_file)
    else:
        raise RuntimeError(f'Session file not found: {source_session_file}')
    client = TelegramClient(runtime_base, args.api_id, args.api_hash, proxy=build_telethon_proxy(args.proxy_json))
    try:
        await client.connect()
        print('Connected to Telegram', flush=True)
        if not await client.is_user_authorized():
            raise RuntimeError("Session is not authorized. Add a pre-authorized Telethon session file to 'sessions' and select it in the interface.")
        print('Session is authorized', flush=True)
        entity = await ensure_entity(client, args.source_link, args.join_wait_seconds)
        print('Source entity resolved', flush=True)
        discussion_entity = await resolve_discussion_entity(client, entity)
        collected: Dict[str, ParsedUser] = {}
        sender_cache: Dict[int, User] = {}
        pending_batch: List[ParsedUser] = []
        inserted_total = 0
        effective_premium_filter = 'premium' if args.variant == 'premium_active' else args.premium_filter
        ids_only = args.variant == 'ids_only'
        scan_chat = args.variant in ('smart', 'chat_authors', 'all_recent', 'premium_active', 'ids_only')
        scan_discussions = args.variant in ('smart', 'discussion_authors', 'all_recent', 'premium_active', 'ids_only')

        def maybe_flush(force: bool=False) -> None:
            nonlocal inserted_total, pending_batch
            if not pending_batch:
                return
            if not force and len(pending_batch) < 10:
                return
            inserted = send_to_backend(args.backend_url, pending_batch)
            append_live_rows(args.live_file, pending_batch)
            inserted_total += inserted
            print(f'Batch inserted: {inserted} (total inserted: {inserted_total})', flush=True)
            pending_batch = []
        if scan_chat:
            print('Scanning chat messages...', flush=True)
            async for row in iter_chat_users(client, entity, from_dt, effective_premium_filter, args.source_link, sender_cache, ids_only):
                if row.external_id in collected:
                    continue
                collected[row.external_id] = row
                pending_batch.append(row)
                maybe_flush(force=False)
            print(f'Collected from chats: {len(collected)}', flush=True)
        if scan_discussions:
            if getattr(discussion_entity, 'id', None) != getattr(entity, 'id', None):
                print('Scanning linked discussion chat (all messages)...', flush=True)
                async for row in iter_chat_users(client, discussion_entity, from_dt, effective_premium_filter, args.source_link, sender_cache, ids_only, 'discussions'):
                    if row.external_id in collected:
                        continue
                    collected[row.external_id] = row
                    pending_batch.append(row)
                    maybe_flush(force=False)
            else:
                print('Scanning discussions from post replies...', flush=True)
                async for row in iter_discussion_users(client, discussion_entity, from_dt, effective_premium_filter, args.source_link, sender_cache, ids_only):
                    if row.external_id in collected:
                        continue
                    collected[row.external_id] = row
                    pending_batch.append(row)
                    maybe_flush(force=False)
            print(f'Collected total after discussions: {len(collected)}', flush=True)
        maybe_flush(force=True)
        print(f'Collected unique users: {len(collected)}', flush=True)
        print(f'Inserted to backend: {inserted_total}', flush=True)
        print('Parser finished', flush=True)
    finally:
        await client.disconnect()
        if os.path.exists(runtime_session_file):
            shutil.copy2(runtime_session_file, source_session_file)
        shutil.rmtree(runtime_dir, ignore_errors=True)

asyncio.run(main())
