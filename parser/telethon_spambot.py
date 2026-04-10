import argparse
import asyncio
import json
import os
import shutil
import tempfile

from telethon import TelegramClient
from proxy_utils import build_telethon_proxy
from license_guard import ensure_license_valid

ensure_license_valid()


def json_print(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def summarize_spambot_reply(text: str) -> tuple:
    """(status: ok|limited|blocked|unknown, summary_ru)"""
    raw = (text or "").strip()
    if not raw:
        return (
            "unknown",
            "Ответ от @SpamBot не пришёл. Подождите минуту и проверьте снова (или откройте чат с @SpamBot вручную в Telegram).",
        )
    t = raw.lower()
    if any(
        x in t
        for x in (
            "good news",
            "no limits",
            "нет ограничений",
            "нет ограничение",
            "всё в порядке",
            "все в порядке",
            "nothing is limiting",
            "не ограничен",
        )
    ):
        return ("ok", "По ответу @SpamBot: явных ограничений на отправку сообщений не указано.")
    if any(
        x in t
        for x in (
            "banned",
            "permanently",
            "навсегда",
            "заблокирован",
            "блокиров",
            "blocked forever",
        )
    ):
        return (
            "blocked",
            "По ответу @SpamBot: аккаунт выглядит как заблокированный/жестко ограниченный.",
        )
    if any(
        x in t
        for x in (
            "limited",
            "ограничен",
            "restrict",
            "cannot write",
            "не можете писать",
            "can't write",
            "spam",
            "спам",
            "blocked",
            "заблокирован",
            "banned",
            "навсегда",
            "forever",
        )
    ):
        return (
            "limited",
            "По ответу @SpamBot: возможны ограничения на переписку или жалобы. Сократите рассылки, увеличьте паузы, дождитесь снятия ограничений.",
        )
    return ("unknown", "Ниже — полный ответ @SpamBot; прочитайте текст бота.")


async def check_spambot(session_name: str, api_id: int, api_hash: str, proxy_json: str):
    src_file = f"{session_name}.session"
    if not os.path.exists(src_file):
        return {"ok": False, "authorized": False, "error": f"Файл сессии не найден: {src_file}"}
    rt_dir = tempfile.mkdtemp(prefix="telethon_spambot_")
    rt_base = os.path.join(rt_dir, "session")
    rt_file = f"{rt_base}.session"
    shutil.copy2(src_file, rt_file)
    client = TelegramClient(rt_base, api_id, api_hash, proxy=build_telethon_proxy(proxy_json))
    try:
        await client.connect()
        if not await client.is_user_authorized():
            return {"ok": False, "authorized": False, "error": "Сессия не авторизована"}
        await client.get_entity("SpamBot")
        await client.send_message("SpamBot", "/start")
        await asyncio.sleep(2.8)
        messages = await client.get_messages("SpamBot", limit=12)
        reply = ""
        for m in messages:
            if m and not getattr(m, "out", False) and getattr(m, "message", None):
                reply = str(m.message).strip()
                break
        status, summary = summarize_spambot_reply(reply)
        return {
            "ok": True,
            "authorized": True,
            "botReply": reply,
            "summary": summary,
            "status": status,
        }
    except Exception as exc:
        err = str(exc)
        low = err.lower()
        if "too many requests" in low or "flood" in low:
            return {
                "ok": False,
                "authorized": True,
                "error": "Слишком частые запросы к Telegram. Подождите несколько минут и повторите проверку @SpamBot.",
            }
        return {"ok": False, "authorized": True, "error": err}
    finally:
        try:
            await client.disconnect()
        except Exception:
            pass
        if os.path.exists(rt_file):
            shutil.copy2(rt_file, src_file)
        shutil.rmtree(rt_dir, ignore_errors=True)


async def run():
    p = argparse.ArgumentParser(description="Проверка ограничений через официального бота @SpamBot")
    p.add_argument("--api-id", type=int, required=True)
    p.add_argument("--api-hash", type=str, required=True)
    p.add_argument("--session", type=str, required=True)
    p.add_argument("--proxy-json", type=str, default="")
    args = p.parse_args()
    result = await check_spambot(args.session, args.api_id, args.api_hash, args.proxy_json)
    json_print(result)


if __name__ == "__main__":
    asyncio.run(run())
