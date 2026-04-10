# -*- coding: utf-8 -*-
import argparse
import asyncio
import json
import os
import shutil
import tempfile
import re
from datetime import datetime, timedelta, timezone
from telethon import TelegramClient
from telethon.errors import ChatWriteForbiddenError, FloodWaitError, RPCError, InviteHashExpiredError, InviteHashInvalidError
from telethon.tl import types
from telethon.tl.custom.message import Message
from telethon.tl.functions.messages import SendReactionRequest, ImportChatInviteRequest, GetDiscussionMessageRequest
from telethon.tl.functions.channels import GetFullChannelRequest
from telethon.tl.types import Channel
from proxy_utils import build_telethon_proxy
from license_guard import ensure_license_valid

ensure_license_valid()

def parse_args():
    p = argparse.ArgumentParser(description='Put reactions: one per unique user')
    p.add_argument('--api-id', type=int, required=True)
    p.add_argument('--api-hash', type=str, required=True)
    p.add_argument('--session', type=str, default='sessions/main')
    p.add_argument('--sessions-json', type=str, default='[]')
    p.add_argument('--chat-link', type=str, required=True)
    p.add_argument('--emoji', type=str, default='👍')
    p.add_argument('--days', type=int, default=30)
    p.add_argument('--join-wait-seconds', type=int, default=15)
    p.add_argument('--proxy-json', type=str, default='')
    return p.parse_args()

def utc_now():
    return datetime.now(tz=timezone.utc)

def _extract_invite_hash(link: str) -> str:
    s = str(link or '').strip()
    if not s:
        return ''
    # https://t.me/+AAAA... or https://t.me/joinchat/AAAA...
    m = re.search(r"(?:t\.me/|\b)(?:\+|joinchat/)([A-Za-z0-9_-]+)", s)
    return str(m.group(1)) if m else ''

def _extract_public_post(link: str):
    s = str(link or '').strip()
    if not s:
        return None
    # https://t.me/channel/123 or t.me/channel/123
    m = re.search(r"(?:https?://)?t\.me/([A-Za-z0-9_]{4,})/(\d+)(?:\?.*)?$", s)
    if not m:
        return None
    return {'username': m.group(1), 'msg_id': int(m.group(2))}

def _is_private_c_post(link: str) -> bool:
    s = str(link or '').strip()
    return bool(re.search(r"(?:https?://)?t\.me/c/\d+/\d+", s))

def _extract_public_username(link: str) -> str:
    s = str(link or '').strip()
    if not s:
        return ''
    # https://t.me/username or t.me/username?foo=bar
    m = re.search(r"(?:https?://)?t\.me/([A-Za-z0-9_]{4,})(?:\?.*)?$", s)
    return str(m.group(1)) if m else ''

def _is_reaction_forbidden_text(text: str) -> bool:
    t = str(text or '').lower()
    return (
        "you can't write in this chat" in t
        or "chat_write_forbidden" in t
        or "you're banned from sending messages" in t
        or "forbidden" in t and "sendreactionrequest" in t
    )

async def _maybe_join_by_invite(client: TelegramClient, link: str) -> None:
    h = _extract_invite_hash(link)
    if not h:
        return
    try:
        print('Инвайт-ссылка обнаружена. Пробую вступить в закрытый чат...', flush=True)
        await client(ImportChatInviteRequest(hash=h))
        print('Вступление выполнено (или уже были участником).', flush=True)
    except (InviteHashExpiredError, InviteHashInvalidError) as exc:
        raise RuntimeError("Инвайт-ссылка недействительна или истекла. Сгенерируйте новую ссылку и попробуйте снова.") from exc
    except Exception as exc:
        # Often Telegram replies "requested to join" (join request) — it's not an error, but membership isn't immediate.
        txt = str(exc)
        if "requested to join" in txt.lower() or "successfully requested to join" in txt.lower():
            print('Заявка на вступление отправлена. Жду применения прав...', flush=True)
            return
        # If already a participant or invite expired/invalid - get_entity will clarify later.
        print(f'Предупреждение: не удалось вступить по инвайту автоматически: {exc}', flush=True)

async def _get_entity_with_wait(client: TelegramClient, link: str, max_wait_seconds: int):
    """
    After join-by-invite Telegram may apply membership with delay (or require admin approval).
    We retry a few times with backoff to avoid failing immediately.
    """
    max_wait = max(0, int(max_wait_seconds or 0))
    if max_wait <= 0:
        return await client.get_entity(link)
    # total delay ~ 0 + 1 + 2 + 3 + 4 + ...
    delays = [0.0, 1.0, 2.0, 3.0, 4.0, 6.0, 8.0, 10.0]
    last_exc = None
    elapsed = 0.0
    for d in delays:
        try:
            if d > 0:
                await asyncio.sleep(d)
                elapsed += float(d)
            return await client.get_entity(link)
        except Exception as exc:
            last_exc = exc
            msg = str(exc).lower()
            if isinstance(exc, (InviteHashExpiredError, InviteHashInvalidError)):
                raise RuntimeError("Инвайт-ссылка недействительна или истекла. Сгенерируйте новую ссылку и попробуйте снова.") from exc
            if "not part of" in msg or "join the group" in msg:
                if elapsed >= max_wait:
                    raise RuntimeError("Заявка на вступление отправлена, но доступ ещё не выдан. Подождите подтверждения администратора и повторите позже.") from exc
                print(f'Жду вступление... прошло {elapsed:.0f}/{max_wait} сек', flush=True)
                continue
            raise
    raise last_exc if last_exc else RuntimeError("Не удалось получить entity после ожидания")

async def _linked_discussion_entity(client: TelegramClient, channel_entity):
    """
    For a broadcast channel, returns the linked discussion chat entity if configured.
    """
    full = await client(GetFullChannelRequest(channel=channel_entity))
    linked_id = getattr(getattr(full, 'full_chat', None), 'linked_chat_id', None)
    if not linked_id:
        return None
    # linked_chat_id refers to the discussion group/supergroup
    try:
        return await client.get_entity(int(linked_id))
    except Exception:
        return None

async def _resolve_target(client: TelegramClient, chat_link: str, join_wait_seconds: int):
    """
    Returns (entity, iter_kwargs, pretty_label)
    - If chat_link is a post link, resolves linked discussion thread and iterates only that thread.
    - If chat_link is an invite link, tries to join first.
    """
    if _is_private_c_post(chat_link):
        raise RuntimeError(
            "Ссылка вида t.me/c/... — это приватный пост. Для обсуждений нужен доступ к каналу и access_hash. "
            "Укажите ссылку на чат обсуждений (группу) или публичную ссылку на пост (t.me/<username>/<id>)."
        )
    post = _extract_public_post(chat_link)
    if post:
        channel = await client.get_entity(post['username'])
        resp = await client(GetDiscussionMessageRequest(peer=channel, msg_id=int(post['msg_id'])))
        # Pick the discussion-side message (peer != channel)
        disc_msg = None
        for m in list(getattr(resp, 'messages', []) or []):
            try:
                if getattr(m, 'peer_id', None) and getattr(m.peer_id, 'channel_id', None) != getattr(channel, 'id', None):
                    disc_msg = m
                    break
            except Exception:
                continue
        if not disc_msg:
            raise RuntimeError("У этого поста нет обсуждений (или обсуждения отключены/недоступны).")
        disc_entity = await client.get_entity(disc_msg.peer_id)
        return disc_entity, {'reply_to': int(disc_msg.id)}, f'обсуждения поста {post["username"]}/{post["msg_id"]}'

    # Invite links: auto-join (private chats/channels/groups)
    if _extract_invite_hash(chat_link):
        await _maybe_join_by_invite(client, chat_link)
        entity = await _get_entity_with_wait(client, chat_link, int(join_wait_seconds or 0))
        # If invite leads to a broadcast channel, try to switch to its linked discussion chat automatically
        if isinstance(entity, Channel) and bool(getattr(entity, "broadcast", False)):
            disc = await _linked_discussion_entity(client, entity)
            if disc is not None:
                return disc, {}, f'обсуждения канала (через инвайт) {chat_link}'
        return entity, {}, str(chat_link)

    # Public channel link: do NOT auto-join. If it's a broadcast channel, use linked discussion chat.
    username = _extract_public_username(chat_link)
    if username:
        entity = await client.get_entity(username)
        if isinstance(entity, Channel) and bool(getattr(entity, "broadcast", False)):
            disc = await _linked_discussion_entity(client, entity)
            if disc is None:
                raise RuntimeError("У канала не настроены обсуждения (linked chat). Укажи ссылку на чат обсуждений вручную.")
            return disc, {}, f'обсуждения канала {username}'
        return entity, {}, str(chat_link)

    # Fallback: ids, @username, etc.
    entity = await client.get_entity(chat_link)
    if isinstance(entity, Channel) and bool(getattr(entity, "broadcast", False)):
        disc = await _linked_discussion_entity(client, entity)
        if disc is not None:
            return disc, {}, f'обсуждения канала {chat_link}'
    return entity, {}, str(chat_link)

async def main():
    args = parse_args()
    sessions = []
    try:
        payload = json.loads(args.sessions_json or '[]')
        if isinstance(payload, list):
            sessions = [str(x).strip() for x in payload if str(x).strip()]
    except Exception:
        sessions = []
    if not sessions and str(args.session or '').strip():
        sessions = [str(args.session).strip()]
    sessions = list(dict.fromkeys(sessions))
    if not sessions:
        raise RuntimeError('No sessions provided')

    from_dt = utc_now() - timedelta(days=max(1, int(args.days or 30)))
    rt_root = tempfile.mkdtemp(prefix='telethon_reactions_')
    clients = []
    for i, sn in enumerate(sessions):
        source_file = f'{sn}.session'
        if not os.path.exists(source_file):
            print(f'Skip session {sn}: file not found', flush=True)
            continue
        rt_dir = os.path.join(rt_root, f's{i}')
        os.makedirs(rt_dir, exist_ok=True)
        rt_base = os.path.join(rt_dir, 'session')
        rt_file = f'{rt_base}.session'
        shutil.copy2(source_file, rt_file)
        client = TelegramClient(rt_base, args.api_id, args.api_hash, proxy=build_telethon_proxy(args.proxy_json))
        clients.append({
            'session': sn,
            'source_file': source_file,
            'rt_file': rt_file,
            'client': client,
            'entity': None,
            'iter_kwargs': {},
            'blocked': False,
            'ready': False,
        })
    if not clients:
        raise RuntimeError('No valid session files found')

    reacted_users = set()
    reacted = 0
    scanned = 0
    rr_cursor = 0
    try:
        label = ''
        for item in clients:
            client = item['client']
            session_name = item['session']
            try:
                await client.connect()
                if not await client.is_user_authorized():
                    print(f'Skip session {session_name}: not authorized', flush=True)
                    item['blocked'] = True
                    continue
                entity, iter_kwargs, local_label = await _resolve_target(client, args.chat_link, int(args.join_wait_seconds or 0))
                item['entity'] = entity
                item['iter_kwargs'] = iter_kwargs or {}
                item['ready'] = True
                label = label or local_label
                print(f'Session ready: {session_name}', flush=True)
            except Exception as exc:
                item['blocked'] = True
                print(f'Skip session {session_name}: {exc}', flush=True)

        ready_items = [x for x in clients if x.get('ready') and not x.get('blocked')]
        if not ready_items:
            raise RuntimeError('Нет доступных аккаунтов для реакций (вступите в чат/проверьте ограничения аккаунтов).')

        source_item = ready_items[0]
        print(f'Reactions job started for {label or args.chat_link}. Accounts: {len(ready_items)}', flush=True)
        async for msg in source_item['client'].iter_messages(source_item['entity'], reverse=False, **(source_item['iter_kwargs'] or {})):
            if not isinstance(msg, Message) or not msg.id or (not msg.date):
                continue
            scanned += 1
            msg_dt = msg.date.astimezone(timezone.utc)
            if msg_dt < from_dt:
                break
            if not msg.sender_id:
                continue
            if msg.sender_id in reacted_users:
                continue
            available = [x for x in clients if x.get('ready') and not x.get('blocked')]
            if not available:
                print('Остановка: все аккаунты недоступны для реакций (ограничения Telegram).', flush=True)
                break
            delivered = False
            for _ in range(len(available)):
                current = available[rr_cursor % len(available)]
                rr_cursor += 1
                c = current['client']
                sn = current['session']
                try:
                    await c(SendReactionRequest(
                        peer=current['entity'],
                        msg_id=msg.id,
                        reaction=[types.ReactionEmoji(emoticon=args.emoji)],
                        big=False,
                        add_to_recent=False,
                    ))
                    reacted_users.add(msg.sender_id)
                    reacted += 1
                    delivered = True
                    print(f'Reacted {reacted} -> msg {msg.id} user {msg.sender_id} ({sn})', flush=True)
                    break
                except ChatWriteForbiddenError:
                    current['blocked'] = True
                    print(f'Аккаунт {sn} исключен: нет прав на реакции в этом чате.', flush=True)
                    continue
                except FloodWaitError as exc:
                    wait_seconds = int(getattr(exc, 'seconds', 0) or 0)
                    if wait_seconds <= 0:
                        wait_seconds = 60
                    current['blocked'] = True
                    print(f'Аккаунт {sn} временно исключен из-за FloodWait ({wait_seconds} сек). Переключаюсь на другой.', flush=True)
                    continue
                except RPCError as exc:
                    text = str(exc)
                    if _is_reaction_forbidden_text(text):
                        current['blocked'] = True
                        print(f'Аккаунт {sn} исключен: Telegram запретил реакции/сообщения в чате.', flush=True)
                        continue
                    if 'A wait of' in text and 'is required' in text:
                        current['blocked'] = True
                        print(f'Аккаунт {sn} временно исключен из-за флуд-лимита. Переключаюсь на другой.', flush=True)
                        continue
                    print(f'Skip msg {msg.id} ({sn}): {exc}', flush=True)
                except Exception as exc:
                    print(f'Skip msg {msg.id} ({sn}): {exc}', flush=True)
            if not delivered:
                continue
        print(f'Finished. Scanned: {scanned}, reacted: {reacted}', flush=True)
    finally:
        for item in clients:
            try:
                await item['client'].disconnect()
            except Exception:
                pass
            try:
                if os.path.exists(item['rt_file']):
                    shutil.copy2(item['rt_file'], item['source_file'])
            except Exception:
                pass
        shutil.rmtree(rt_root, ignore_errors=True)

asyncio.run(main())
