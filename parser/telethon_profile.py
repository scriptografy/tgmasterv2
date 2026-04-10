import argparse
import asyncio
import base64
import json
import os
import shutil
import tempfile
from telethon import TelegramClient
from telethon import utils as tl_utils
from telethon.tl.functions.account import UpdateProfileRequest, UpdateUsernameRequest
from telethon.tl.functions.photos import DeletePhotosRequest
from telethon.tl.functions.photos import UploadProfilePhotoRequest
from telethon.tl.functions.users import GetFullUserRequest
from proxy_utils import build_telethon_proxy
from license_guard import ensure_license_valid

ensure_license_valid()

def parse_args():
    p = argparse.ArgumentParser(description='Telethon profile helper')
    sub = p.add_subparsers(dest='cmd', required=True)
    g = sub.add_parser('get')
    g.add_argument('--api-id', type=int, required=True)
    g.add_argument('--api-hash', type=str, required=True)
    g.add_argument('--session', type=str, required=True)
    g.add_argument('--proxy-json', type=str, default='')
    s = sub.add_parser('set')
    s.add_argument('--api-id', type=int, required=True)
    s.add_argument('--api-hash', type=str, required=True)
    s.add_argument('--session', type=str, required=True)
    s.add_argument('--first-name', type=str, default=None)
    s.add_argument('--last-name', type=str, default=None)
    s.add_argument('--bio', type=str, default=None)
    s.add_argument('--username', type=str, default=None)
    s.add_argument('--photo-base64', type=str, default='')
    s.add_argument('--clear-photo', action='store_true')
    s.add_argument('--proxy-json', type=str, default='')
    return p.parse_args()

def json_print(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)

def normalize_username(value):
    return (value or '').strip().lstrip('@').lower()

async def read_profile_payload(session_name, api_id, api_hash, proxy_json):
    """Один аккаунт: только чтение профиля (без set). Возвращает словарь с полями ok, authorized, profile, error."""
    src_file = f'{session_name}.session'
    if not os.path.exists(src_file):
        return {'ok': False, 'authorized': False, 'error': f'Session not found: {src_file}', 'profile': None}
    rt_dir = tempfile.mkdtemp(prefix='telethon_profile_')
    rt_base = os.path.join(rt_dir, 'session')
    rt_file = f'{rt_base}.session'
    shutil.copy2(src_file, rt_file)
    client = TelegramClient(rt_base, api_id, api_hash, proxy=build_telethon_proxy(proxy_json))
    try:
        await client.connect()
        if not await client.is_user_authorized():
            return {'ok': False, 'authorized': False, 'error': 'Session is not authorized', 'profile': None}
        me = await client.get_me()
        full = await client(GetFullUserRequest('me'))
        about = ''
        if full and getattr(full, 'full_user', None):
            about = getattr(full.full_user, 'about', '') or ''
        prof = {
            'id': me.id,
            'phone': me.phone or '',
            'firstName': me.first_name or '',
            'lastName': me.last_name or '',
            'username': me.username or '',
            'bio': about,
        }
        return {'ok': True, 'authorized': True, 'error': None, 'profile': prof}
    except Exception as exc:
        return {'ok': False, 'authorized': False, 'error': str(exc), 'profile': None}
    finally:
        try:
            await client.disconnect()
        except Exception:
            pass
        if os.path.exists(rt_file):
            shutil.copy2(rt_file, src_file)
        shutil.rmtree(rt_dir, ignore_errors=True)

def print_get_result(payload):
    if payload['ok'] and payload.get('authorized') and payload.get('profile') is not None:
        json_print({'ok': True, 'authorized': True, 'profile': payload['profile']})
        return
    err = payload.get('error') or 'profile read failed'
    if 'Session not found' in err:
        json_print({'ok': False, 'error': err})
        return
    if payload.get('authorized') is False and 'Session is not authorized' in err:
        json_print({'ok': False, 'authorized': False, 'error': err})
        return
    json_print({'ok': False, 'error': err})

async def run():
    args = parse_args()

    if args.cmd == 'get':
        payload = await read_profile_payload(args.session, args.api_id, args.api_hash, args.proxy_json)
        print_get_result(payload)
        return

    src_file = f'{args.session}.session'
    if not os.path.exists(src_file):
        json_print({'ok': False, 'error': f'Session not found: {src_file}'})
        return
    rt_dir = tempfile.mkdtemp(prefix='telethon_profile_')
    rt_base = os.path.join(rt_dir, 'session')
    rt_file = f'{rt_base}.session'
    shutil.copy2(src_file, rt_file)
    client = TelegramClient(rt_base, args.api_id, args.api_hash, proxy=build_telethon_proxy(args.proxy_json))
    photo_tmp = ''
    try:
        await client.connect()
        if not await client.is_user_authorized():
            json_print({'ok': False, 'authorized': False, 'error': 'Session is not authorized'})
            return
        me_before = await client.get_me()
        full_before = await client(GetFullUserRequest('me'))
        before_about = ''
        if full_before and getattr(full_before, 'full_user', None):
            before_about = getattr(full_before.full_user, 'about', '') or ''
        next_first = (args.first_name or '').strip() if args.first_name is not None else me_before.first_name or ''
        next_last = (args.last_name or '').strip() if args.last_name is not None else me_before.last_name or ''
        next_bio = (args.bio or '').strip() if args.bio is not None else before_about
        current_first = me_before.first_name or ''
        current_last = me_before.last_name or ''
        current_bio = before_about
        if next_first != current_first or next_last != current_last:
            await client(UpdateProfileRequest(first_name=next_first, last_name=next_last))
        if next_bio != current_bio:
            await client(UpdateProfileRequest(about=next_bio))
        if args.username is not None:
            clean_username = normalize_username(args.username)
            current_username = normalize_username(me_before.username or '')
            if clean_username != current_username:
                await client(UpdateUsernameRequest(clean_username or ''))
        if args.clear_photo:
            photos = await client.get_profile_photos('me', limit=1)
            if photos:
                input_photos = [tl_utils.get_input_photo(p) for p in photos if p]
                if input_photos:
                    await client(DeletePhotosRequest(id=input_photos))
        if args.photo_base64:
            data = args.photo_base64
            if ',' in data:
                data = data.split(',', 1)[1]
            raw = base64.b64decode(data)
            photo_tmp = os.path.join(rt_dir, 'upload.jpg')
            with open(photo_tmp, 'wb') as f:
                f.write(raw)
            uploaded = await client.upload_file(photo_tmp)
            await client(UploadProfilePhotoRequest(file=uploaded))
        me = await client.get_me()
        full = await client(GetFullUserRequest('me'))
        about = ''
        if full and getattr(full, 'full_user', None):
            about = getattr(full.full_user, 'about', '') or ''
        json_print({'ok': True, 'authorized': True, 'profile': {'id': me.id, 'phone': me.phone or '', 'firstName': me.first_name or '', 'lastName': me.last_name or '', 'username': me.username or '', 'bio': about}})
    except Exception as exc:
        json_print({'ok': False, 'error': str(exc)})
    finally:
        try:
            await client.disconnect()
        except Exception:
            pass
        if os.path.exists(rt_file):
            shutil.copy2(rt_file, src_file)
        if photo_tmp and os.path.exists(photo_tmp):
            os.remove(photo_tmp)
        shutil.rmtree(rt_dir, ignore_errors=True)

asyncio.run(run())
