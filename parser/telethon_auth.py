import argparse
import json
import sys
from telethon import TelegramClient
from telethon.errors import SessionPasswordNeededError
from proxy_utils import build_telethon_proxy
from license_guard import ensure_license_valid

ensure_license_valid()

def parse_args():
    parser = argparse.ArgumentParser(description='Telethon auth helper')
    sub = parser.add_subparsers(dest='cmd', required=True)
    send = sub.add_parser('send-code')
    send.add_argument('--api-id', type=int, required=True)
    send.add_argument('--api-hash', type=str, required=True)
    send.add_argument('--session', type=str, required=True)
    send.add_argument('--phone', type=str, required=True)
    send.add_argument('--proxy-json', type=str, default='')
    verify = sub.add_parser('verify-code')
    verify.add_argument('--api-id', type=int, required=True)
    verify.add_argument('--api-hash', type=str, required=True)
    verify.add_argument('--session', type=str, required=True)
    verify.add_argument('--phone', type=str, required=True)
    verify.add_argument('--code', type=str, required=True)
    verify.add_argument('--phone-code-hash', type=str, required=True)
    verify.add_argument('--password', type=str, default='')
    verify.add_argument('--proxy-json', type=str, default='')
    return parser.parse_args()

async def send_code(args):
    client = TelegramClient(args.session, args.api_id, args.api_hash, proxy=build_telethon_proxy(args.proxy_json))
    await client.connect()
    try:
        result = await client.send_code_request(args.phone)
        print(json.dumps({'ok': True, 'phone_code_hash': result.phone_code_hash}))
    finally:
        await client.disconnect()

async def verify_code(args):
    client = TelegramClient(args.session, args.api_id, args.api_hash, proxy=build_telethon_proxy(args.proxy_json))
    await client.connect()
    try:
        try:
            await client.sign_in(phone=args.phone, code=args.code, phone_code_hash=args.phone_code_hash)
            print(json.dumps({'ok': True, 'authorized': True}))
            return
        except SessionPasswordNeededError:
            if not args.password:
                print(json.dumps({'ok': False, 'need_password': True}))
                return
            await client.sign_in(password=args.password)
            print(json.dumps({'ok': True, 'authorized': True, 'used_password': True}))
    finally:
        await client.disconnect()

def main():
    import asyncio
    args = parse_args()
    try:
        if args.cmd == 'send-code':
            asyncio.run(send_code(args))
        else:
            asyncio.run(verify_code(args))
    except Exception as exc:
        print(json.dumps({'ok': False, 'error': str(exc)}))
        sys.exit(1)

main()
