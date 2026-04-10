import argparse
import asyncio
import json
import os
import shutil
import tempfile
from datetime import datetime, timezone
from telethon import TelegramClient
from telethon.errors import MsgIdInvalidError
from telethon.tl.types import Channel, InputPeerChannel, InputPeerChat, InputPeerUser, User
from proxy_utils import build_telethon_proxy
from license_guard import ensure_license_valid

ensure_license_valid()

def now_iso():
    return datetime.now(tz=timezone.utc).isoformat()

def parse_args():
    p = argparse.ArgumentParser(description='Telethon messages browser')
    p.add_argument('cmd', choices=['dialogs', 'history', 'send'])
    p.add_argument('--api-id', type=int, required=True)
    p.add_argument('--api-hash', type=str, required=True)
    p.add_argument('--session', type=str, required=True)
    p.add_argument('--peer', type=str, default='')
    p.add_argument('--message', type=str, default='')
    p.add_argument('--limit', type=int, default=50)
    p.add_argument('--proxy-json', type=str, default='')
    return p.parse_args()

def display_name(entity) -> str:
    if int(getattr(entity, 'id', 0) or 0) == 777000:
        return 'Telegram'
    title = getattr(entity, 'title', None)
    if title:
        return str(title)
    first = str(getattr(entity, 'first_name', '') or '').strip()
    last = str(getattr(entity, 'last_name', '') or '').strip()
    full = f'{first} {last}'.strip()
    if full:
        return full
    username = getattr(entity, 'username', None)
    if username:
        return f'@{username}'
    return str(getattr(entity, 'id', 'unknown'))

def peer_key(entity) -> str:
    ent_id = int(getattr(entity, 'id', 0) or 0)
    access_hash = int(getattr(entity, 'access_hash', 0) or 0)
    cls_name = entity.__class__.__name__.lower()
    if 'user' in cls_name:
        return f'user:{ent_id}:{access_hash}'
    if 'channel' in cls_name:
        return f'channel:{ent_id}:{access_hash}'
    return f'chat:{ent_id}'

async def resolve_peer(client: TelegramClient, raw_peer: str):
    value = str(raw_peer or '').strip()
    if not value:
        raise RuntimeError('peer is required')
    if value.startswith('@') or 't.me/' in value:
        return await client.get_entity(value)
    if value.startswith('user:'):
        parts = value.split(':')
        if len(parts) >= 3:
            return InputPeerUser(user_id=int(parts[1]), access_hash=int(parts[2]))
    if value.startswith('channel:'):
        parts = value.split(':')
        if len(parts) >= 3:
            return InputPeerChannel(channel_id=int(parts[1]), access_hash=int(parts[2]))
    if value.startswith('chat:'):
        parts = value.split(':')
        if len(parts) >= 2:
            return InputPeerChat(chat_id=int(parts[1]))
    if value.lstrip('-').isdigit():
        return await client.get_entity(int(value))
    return await client.get_entity(value)

async def run():
    args = parse_args()
    src_file = f'{args.session}.session'
    if not os.path.exists(src_file):
        return {'ok': False, 'error': f'Session file not found: {src_file}'}
    rt_dir = tempfile.mkdtemp(prefix='telethon_messages_')
    rt_base = os.path.join(rt_dir, 'session')
    rt_file = f'{rt_base}.session'
    shutil.copy2(src_file, rt_file)
    client = TelegramClient(rt_base, args.api_id, args.api_hash, proxy=build_telethon_proxy(args.proxy_json), receive_updates=False)
    try:
        await client.connect()
        if not await client.is_user_authorized():
            return {'ok': False, 'error': 'Session is not authorized'}
        me = await client.get_me()
        me_id = int(getattr(me, 'id', 0) or 0)
        if args.cmd == 'dialogs':
            limit = max(1, min(200, int(args.limit or 50)))
            items = []
            async for d in client.iter_dialogs(limit=limit):
                entity = d.entity
                entity_id = int(getattr(entity, 'id', 0) or 0)
                is_service = entity_id == 777000
                has_username = bool(getattr(entity, 'username', None))
                is_channel = bool(getattr(d, 'is_channel', False))
                is_group = bool(getattr(d, 'is_group', False))
                is_user = bool(getattr(d, 'is_user', False))
                is_broadcast = isinstance(entity, Channel) and bool(getattr(entity, 'broadcast', False))
                is_megagroup = isinstance(entity, Channel) and bool(getattr(entity, 'megagroup', False))
                if is_service:
                    dialog_type = 'service'
                elif is_group or is_megagroup:
                    dialog_type = 'group'
                elif is_broadcast or is_channel:
                    dialog_type = 'channel'
                elif is_user:
                    dialog_type = 'user'
                else:
                    dialog_type = 'other'
                items.append({'peer': peer_key(entity), 'title': display_name(entity), 'username': getattr(entity, 'username', None) or '', 'unreadCount': int(getattr(d, 'unread_count', 0) or 0), 'isUser': isinstance(entity, User), 'isPublic': has_username, 'isPrivate': not has_username, 'dialogType': dialog_type, 'isService': is_service})
            return {'ok': True, 'dialogs': items}
        if args.cmd == 'history':
            if not args.peer:
                return {'ok': False, 'error': 'peer is required'}
            limit = max(1, min(200, int(args.limit or 50)))
            entity = await resolve_peer(client, args.peer)
            messages = []
            async for m in client.iter_messages(entity, limit=limit):
                sender = await m.get_sender()
                sender_id = int(getattr(sender, 'id', 0) or 0) if sender else 0
                is_self = bool(sender_id and me_id and (sender_id == me_id))
                messages.append({'id': int(m.id), 'text': str(m.message or ''), 'date': m.date.astimezone(timezone.utc).isoformat() if m.date else now_iso(), 'out': is_self, 'isSelf': is_self, 'senderName': display_name(sender) if sender else ''})
            messages.reverse()
            return {'ok': True, 'messages': messages}
        if args.cmd == 'send':
            if not args.peer:
                return {'ok': False, 'error': 'peer is required'}
            text = str(args.message or '').strip()
            if not text:
                return {'ok': False, 'error': 'message is required'}
            entity = await resolve_peer(client, args.peer)
            sent = await client.send_message(entity, text)
            return {'ok': True, 'message': {'id': int(getattr(sent, 'id', 0) or 0), 'text': str(getattr(sent, 'message', '') or text), 'date': sent.date.astimezone(timezone.utc).isoformat() if getattr(sent, 'date', None) else now_iso(), 'out': True, 'isSelf': True, 'senderName': 'Вы'}}
    except Exception as exc:
        text = str(exc)
        if 'MsgIdDecreaseRetryError' in text or 'GetDifferenceRequest' in text:
            return {'ok': False, 'error': 'Temporary Telegram sync issue. Please retry once.'}
        if isinstance(exc, MsgIdInvalidError):
            return {'ok': False, 'error': 'Temporary Telegram sync issue. Please retry once.'}
        return {'ok': False, 'error': text}
    finally:
        await client.disconnect()
        if os.path.exists(rt_file):
            shutil.copy2(rt_file, src_file)
        shutil.rmtree(rt_dir, ignore_errors=True)

result = asyncio.run(run())
print(json.dumps(result, ensure_ascii=False))
raise SystemExit(0 if result.get('ok') else 1)
