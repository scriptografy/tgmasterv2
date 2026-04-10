import argparse
import asyncio
import json
import os
import shutil
import tempfile

import requests
from telethon import TelegramClient
from telethon.tl.functions.account import GetAuthorizationsRequest

from proxy_utils import build_requests_proxies, build_telethon_proxy
from license_guard import ensure_license_valid

ensure_license_valid()


def json_print(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def auth_ip(a):
    return str(getattr(a, "ip", None) or "").strip()


def pick_authorization(authorizations, api_id):
    if not authorizations:
        return None
    with_ip = [a for a in authorizations if auth_ip(a)]
    for a in authorizations:
        if getattr(a, "current", False) and auth_ip(a):
            return a
    same = [a for a in with_ip if int(getattr(a, "api_id", 0) or 0) == int(api_id)]
    pool = same if same else with_ip
    if pool:
        return max(pool, key=lambda x: int(getattr(x, "date_active", 0) or 0))
    for a in authorizations:
        if getattr(a, "current", False):
            return a
    return authorizations[0]


def http_exit_ip(proxy_json: str):
    proxies = build_requests_proxies(proxy_json)
    r = requests.get("https://api.ipify.org?format=json", timeout=18, proxies=proxies)
    r.raise_for_status()
    data = r.json()
    ip = str(data.get("ip") or "").strip()
    if not ip:
        raise RuntimeError("ipify пустой ответ")
    return ip


async def run():
    p = argparse.ArgumentParser()
    p.add_argument("--api-id", type=int, required=True)
    p.add_argument("--api-hash", type=str, required=True)
    p.add_argument("--session", type=str, required=True)
    p.add_argument("--proxy-json", type=str, default="")
    args = p.parse_args()

    src_file = f"{args.session}.session"
    if not os.path.exists(src_file):
        json_print({"ok": False, "error": f"Session not found: {src_file}"})
        return

    rt_dir = tempfile.mkdtemp(prefix="telethon_exit_ip_")
    rt_base = os.path.join(rt_dir, "session")
    rt_file = f"{rt_base}.session"
    shutil.copy2(src_file, rt_file)
    client = TelegramClient(rt_base, args.api_id, args.api_hash, proxy=build_telethon_proxy(args.proxy_json))
    try:
        await client.connect()
        if not await client.is_user_authorized():
            json_print({"ok": False, "error": "Session is not authorized"})
            return

        res = await client(GetAuthorizationsRequest())
        if not res.authorizations:
            json_print({"ok": False, "error": "Telegram вернул пустой список сессий"})
            return

        chosen = pick_authorization(res.authorizations, args.api_id)
        ip = auth_ip(chosen) if chosen else ""
        country = str(getattr(chosen, "country", None) or "").strip() if chosen else ""

        source = "telegram"
        if not ip:
            try:
                ip = http_exit_ip(args.proxy_json)
                source = "http_exit"
                country = ""
            except Exception as http_exc:
                json_print(
                    {
                        "ok": False,
                        "error": (
                            "В ответе Telegram для сессий нет поля IP (часто у текущего клиента оно пустое). "
                            f"Запасной запрос тоже не удался: {http_exc}"
                        ),
                    }
                )
                return

        json_print({"ok": True, "ip": ip, "country": country, "source": source})
    except Exception as exc:
        json_print({"ok": False, "error": str(exc)})
    finally:
        try:
            await client.disconnect()
        except Exception:
            pass
        if os.path.exists(rt_file):
            shutil.copy2(rt_file, src_file)
        shutil.rmtree(rt_dir, ignore_errors=True)


asyncio.run(run())
