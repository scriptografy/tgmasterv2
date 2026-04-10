import argparse
import asyncio
import json
import os
import random
import re
import shutil
import tempfile
import time
from datetime import datetime, timezone
import requests
from telethon import TelegramClient
from telethon.errors import FloodWaitError, InviteRequestSentError, UserAlreadyParticipantError
from telethon.tl.functions.channels import JoinChannelRequest
from telethon.tl.functions.messages import ImportChatInviteRequest
from proxy_utils import build_telethon_proxy
from ai_unique import rewrite_text
from license_guard import ensure_license_valid

ensure_license_valid()

def now_iso():
    return datetime.now(tz=timezone.utc).isoformat()

def parse_args():
    p = argparse.ArgumentParser(description='Telethon mailing sender')
    p.add_argument('--api-id', type=int, required=True)
    p.add_argument('--api-hash', type=str, required=True)
    p.add_argument('--session', type=str, default='')
    p.add_argument('--sessions-json', type=str, default='[]')
    p.add_argument('--message', type=str, required=True)
    p.add_argument('--recipients-json', type=str, required=True)
    p.add_argument('--delay-min-ms', type=int, default=400)
    p.add_argument('--delay-max-ms', type=int, default=900)
    p.add_argument('--mailing-type', type=str, default='direct')
    p.add_argument('--join-request-behavior', type=str, default='skip')
    p.add_argument('--join-wait-seconds', type=int, default=180)
    p.add_argument('--media-path', type=str, default='')
    p.add_argument('--ai-rewrite-enabled', type=str, default='0')
    p.add_argument('--ai-provider', type=str, default='gemini')
    p.add_argument('--ai-api-token', type=str, default='')
    p.add_argument('--proxy-json', type=str, default='')
    p.add_argument('--backend-url', type=str, default='http://localhost:8787')
    p.add_argument('--live-file', type=str, default='')
    p.add_argument(
        '--tactics-preset',
        type=str,
        default='careful_dm',
        choices=('fast', 'balanced', 'careful_dm'),
        help='Тактика пауз: fast — равномерная задержка; balanced — «человеческие» паузы + набор; careful_dm — то же + интервал на аккаунт + перерывы (для ЛС)',
    )
    return p.parse_args()

def append_live(live_file, payload):
    if not live_file:
        return
    os.makedirs(os.path.dirname(live_file), exist_ok=True)
    with open(live_file, 'a', encoding='utf-8') as f:
        f.write(json.dumps(payload, ensure_ascii=False) + '\n')

def ingest(backend_url, rows):
    requests.post(f"{backend_url.rstrip('/')}/api/mailing/ingest", json={'rows': rows}, timeout=20).raise_for_status()


def normalize_recipient(value):
    v = str(value or '').strip()
    if not v:
        return ''
    if v.startswith('@'):
        return '@' + v[1:].strip().lower()
    return v


def fetch_already_sent_recipients(backend_url):
    try:
        r = requests.get(f"{backend_url.rstrip('/')}/api/mailing/sent-recipients", timeout=20)
        r.raise_for_status()
        payload = r.json() if r.content else {}
        items = payload.get('recipients') if isinstance(payload, dict) else []
        if not isinstance(items, list):
            return set()
        return {normalize_recipient(x) for x in items if normalize_recipient(x)}
    except Exception:
        return set()

def parse_invite_hash(target):
    value = str(target or '').strip()
    if 't.me/+' in value:
        return value.split('t.me/+', 1)[1].split('?', 1)[0].strip('/')
    if 'joinchat/' in value:
        return value.split('joinchat/', 1)[1].split('?', 1)[0].strip('/')
    return ''

def resolve_tactics_preset(preset: str, mailing_type: str):
    """Параметры тактики отправки (снижение FloodWait и жалоб в ЛС)."""
    p = str(preset or 'balanced').strip().lower()
    tactics = {
        'delay_pattern': 'human',
        'session_gap_sec': 0.0,
        'typing_before_send': False,
        'burst_every': 0,
        'burst_pause_min_sec': 0.0,
        'burst_pause_max_sec': 0.0,
    }
    if p == 'fast':
        tactics['delay_pattern'] = 'uniform'
    elif p == 'balanced':
        tactics['delay_pattern'] = 'human'
        tactics['typing_before_send'] = mailing_type == 'direct'
    elif p == 'careful_dm':
        tactics['delay_pattern'] = 'human'
        tactics['session_gap_sec'] = 12.0
        tactics['typing_before_send'] = mailing_type == 'direct'
        tactics['burst_every'] = 18
        tactics['burst_pause_min_sec'] = 45.0
        tactics['burst_pause_max_sec'] = 120.0
    else:
        tactics['typing_before_send'] = mailing_type == 'direct'
    if mailing_type != 'direct':
        tactics['typing_before_send'] = False
    return tactics


def human_delay_seconds(delay_min_ms: int, delay_max_ms: int, pattern: str, flood_mult: float = 1.0) -> float:
    lo = max(0.05, float(delay_min_ms) / 1000.0)
    hi = max(lo, float(delay_max_ms) / 1000.0)
    if pattern == 'uniform':
        sec = random.uniform(lo, hi)
    else:
        mode = (lo + hi) / 2.0
        sec = random.triangular(lo, hi, mode)
        if random.random() < 0.11:
            sec += random.uniform(2.5, 11.0)
        if random.random() < 0.035:
            sec += random.uniform(14.0, 48.0)
    return sec * max(1.0, flood_mult)


async def wait_session_gap(session_name: str, gap_sec: float, last_send: dict):
    if gap_sec <= 0:
        return
    prev = last_send.get(session_name)
    if prev is None:
        return
    elapsed = time.monotonic() - prev
    if elapsed < gap_sec:
        await asyncio.sleep(gap_sec - elapsed)


async def typing_before_message(client, recipient, enabled: bool, text: str, has_media: bool = False):
    if not enabled:
        await asyncio.sleep(random.uniform(0.05, 0.35))
        return
    raw = str(text or '')
    if not raw.strip() and has_media:
        raw = 'x' * 28
    duration = min(4.2, max(0.7, len(raw) / 38.0))
    duration *= random.uniform(0.85, 1.25)
    try:
        async with client.action(recipient, 'typing'):
            await asyncio.sleep(duration)
    except Exception:
        await asyncio.sleep(min(duration, 2.0))


def humanize_mailing_error(exc) -> str:
    """Краткое объяснение на русском для логов и пользователя."""
    s = str(exc)
    low = s.lower()
    if 'too many requests' in low or ('flood' in low and 'wait' in low):
        return (
            'Telegram отклонил отправку: слишком много запросов подряд. '
            'Сделайте паузу 20–60 минут, увеличьте задержки между сообщениями, '
            'используйте несколько аккаунтов. Проверьте ограничения через бота @SpamBot (вкладка «Аккаунты»).'
        )
    if 'peeridinvalid' in low or 'username not occupied' in low:
        return 'Получатель не найден: неверный @username, ID или пользователь удалён.'
    if 'user is deactivated' in low or 'user_deactivated' in low:
        return 'Аккаунт получателя удалён или деактивирован.'
    if 'you blocked user' in low or 'user is blocked' in low:
        return 'Нельзя написать этому пользователю (блок или запрет на сообщения).'
    if 'chat_write_forbidden' in low or 'write forbidden' in low:
        return 'В этот чат писать нельзя (нет прав или чат только для чтения).'
    if 'slowmode' in low or 'slow mode' in low:
        return 'В чате включён медленный режим — подождите перед следующей отправкой.'
    if 'session is not authorized' in low or 'authkey' in low:
        return 'Сессия не авторизована — заново войдите в аккаунт.'
    if len(s) > 220:
        return s[:217] + '...'
    return s


def apply_spintax_once(text):
    value = str(text or '')
    pattern = re.compile('\\{([^{}]+)\\}')
    while True:
        match = pattern.search(value)
        if not match:
            break
        options = [o.strip() for o in match.group(1).split('|') if o.strip()]
        replacement = random.choice(options) if options else ''
        value = value[:match.start()] + replacement + value[match.end():]
    return value

async def ensure_joined(client, target, behavior, wait_seconds):
    invite_hash = parse_invite_hash(target)
    attempts = max(1, int(wait_seconds / 15)) if behavior == 'wait' else 1
    for attempt in range(1, attempts + 1):
        try:
            if invite_hash:
                await client(ImportChatInviteRequest(invite_hash))
            else:
                await client(JoinChannelRequest(target))
            return (True, 'joined')
        except UserAlreadyParticipantError:
            return (True, 'already_joined')
        except InviteRequestSentError:
            if behavior == 'skip':
                return (False, 'join_request_pending_skipped')
            if attempt >= attempts:
                return (False, 'join_request_pending_timeout')
            await asyncio.sleep(15)
        except FloodWaitError as exc:
            wait_s = int(getattr(exc, 'seconds', 0) or 30)
            await asyncio.sleep(wait_s + 1)
        except Exception as exc:
            return (False, f'join_failed: {exc}')
    return (False, 'join_not_confirmed')

async def main():
    args = parse_args()
    recipients = json.loads(args.recipients_json)
    original_recipients_count = len(recipients) if isinstance(recipients, list) else 0
    sessions = json.loads(args.sessions_json or '[]')
    if not isinstance(recipients, list):
        raise RuntimeError('recipients-json must be a list')
    if not isinstance(sessions, list):
        raise RuntimeError('sessions-json must be a list')
    if not sessions and args.session:
        sessions = [args.session]
    if not sessions:
        raise RuntimeError('No sessions provided')
    use_ai = str(args.ai_rewrite_enabled or '0') == '1'
    ai_provider = str(args.ai_provider or 'gemini').strip().lower()
    ai_token = str(args.ai_api_token or '').strip()
    already_sent = fetch_already_sent_recipients(args.backend_url)
    recipients = [r for r in recipients if normalize_recipient(r) not in already_sent]
    skipped_known = max(0, original_recipients_count - len(recipients))
    if not recipients:
        print('Новых получателей нет: все из списка уже были успешно доставлены ранее.', flush=True)
        return

    if use_ai:
        print(f'Уникализация текста (AI): включена ({ai_provider})', flush=True)
    else:
        print('Уникализация текста (AI): выключена', flush=True)
    clients = []
    temp_dirs = []
    print(
        f'Рассылка запущена. К отправке: {len(recipients)}, уже доставлялись ранее: {max(0, skipped_known)}, аккаунтов: {len(sessions)}',
        flush=True,
    )
    for session in sessions:
        src_file = f'{session}.session'
        if not os.path.exists(src_file):
            print(f'Пропуск: файл сессии не найден — {src_file}', flush=True)
            continue
        rt_dir = tempfile.mkdtemp(prefix='telethon_mailing_')
        temp_dirs.append((session, src_file, rt_dir))
        rt_base = os.path.join(rt_dir, 'session')
        rt_file = f'{rt_base}.session'
        shutil.copy2(src_file, rt_file)
        client = TelegramClient(rt_base, args.api_id, args.api_hash, proxy=build_telethon_proxy(args.proxy_json))
        await client.connect()
        if not await client.is_user_authorized():
            await client.disconnect()
            print(f'Пропуск: сессия не авторизована — {session}', flush=True)
            continue
        clients.append((session, client))
    if not clients:
        raise RuntimeError('No authorized sessions available')
    if args.media_path:
        if os.path.exists(args.media_path):
            print(f'Медиа к сообщению: да ({args.media_path})', flush=True)
        else:
            print(f'Медиа указано, но файл не найден: {args.media_path}', flush=True)
    else:
        print('Медиа к сообщению: нет (только текст)', flush=True)
    tactics = resolve_tactics_preset(args.tactics_preset, args.mailing_type)
    delay_ru = 'равномерная' if tactics['delay_pattern'] == 'uniform' else 'как у человека'
    burst_ru = f"каждые ~{tactics['burst_every']} отправок" if tactics['burst_every'] else 'без длинных пауз'
    print(
        f"Тактика: {args.tactics_preset} · задержки: {delay_ru} · пауза между аккаунтами: "
        f"{tactics['session_gap_sec']} с · набор текста: {'да' if tactics['typing_before_send'] else 'нет'} "
        f"· перерывы: {burst_ru}",
        flush=True,
    )
    last_send_monotonic = {}
    flood_mult = 1.0
    successful_sends = 0
    has_media_file = bool(args.media_path and os.path.exists(args.media_path))
    for (idx, recipient) in enumerate(recipients, start=1):
        start_i = (idx - 1) % len(clients)
        ordered_clients = [clients[(start_i + off) % len(clients)] for off in range(len(clients))]
        delivered = False
        last_exc = None
        for (session_name, client) in ordered_clients:
            row = {'session_name': session_name, 'recipient': str(recipient), 'status': 'sent', 'created_at': now_iso(), 'error_text': None}
            await wait_session_gap(session_name, tactics['session_gap_sec'], last_send_monotonic)
            try:
                sent = False
                for attempt in range(1, 4):
                    try:
                        if args.mailing_type == 'groups':
                            (joined, join_reason) = await ensure_joined(client, recipient, args.join_request_behavior, max(30, int(args.join_wait_seconds or 180)))
                            if not joined:
                                raise RuntimeError(join_reason)
                        prepared_message = apply_spintax_once(args.message or '')
                        if use_ai and ai_token:
                            try:
                                prepared_message = rewrite_text(prepared_message, ai_provider, ai_token)
                            except Exception as ai_exc:
                                print(f'AI rewrite fallback ({session_name} -> {recipient}): {ai_exc}', flush=True)
                        await typing_before_message(
                            client,
                            recipient,
                            tactics['typing_before_send'],
                            prepared_message,
                            has_media_file,
                        )
                        if has_media_file:
                            await client.send_file(recipient, args.media_path, caption=prepared_message or '')
                        else:
                            await client.send_message(recipient, prepared_message)
                        sent = True
                        last_send_monotonic[session_name] = time.monotonic()
                        successful_sends += 1
                        print(
                            f'Отправлено {idx}/{len(recipients)} ({session_name} → {recipient})',
                            flush=True,
                        )
                        append_live(args.live_file, {'recipient': str(recipient), 'status': 'sent', 'session': session_name, 'created_at': row['created_at']})
                        be = int(tactics['burst_every'] or 0)
                        if be > 0 and successful_sends % be == 0:
                            lo = float(tactics['burst_pause_min_sec'] or 0)
                            hi = float(tactics['burst_pause_max_sec'] or lo)
                            if hi < lo:
                                lo, hi = hi, lo
                            extra = random.uniform(lo, hi) if hi > 0 else 0.0
                            if extra > 0:
                                print(f'Burst pause after {successful_sends} sends: {extra:.0f}s', flush=True)
                                await asyncio.sleep(extra)
                        break
                    except FloodWaitError as exc:
                        wait_seconds = int(getattr(exc, 'seconds', 0) or 0)
                        if wait_seconds <= 0:
                            wait_seconds = 30
                        flood_mult = min(2.85, flood_mult * 1.48)
                        print(
                            f'Ожидание FloodWait {wait_seconds} с ({session_name} → {recipient}), попытка {attempt}/3 '
                            f'(множитель паузы {flood_mult:.2f})',
                            flush=True,
                        )
                        if attempt >= 3:
                            raise
                        await asyncio.sleep(wait_seconds + 1 + random.uniform(0.5, 2.0))
                if not sent:
                    raise RuntimeError('Message was not sent after retries')
                ingest(args.backend_url, [row])
                delivered = True
                break
            except Exception as exc:
                last_exc = exc
                row['status'] = 'failed'
                row['error_text'] = str(exc)
                hint = humanize_mailing_error(exc)
                print(
                    f'Не доставлено {idx}/{len(recipients)} ({session_name} → {recipient}). {hint}',
                    flush=True,
                )
                append_live(
                    args.live_file,
                    {
                        'recipient': str(recipient),
                        'status': 'failed',
                        'session': session_name,
                        'error': str(exc),
                        'errorHint': hint,
                        'created_at': row['created_at'],
                    },
                )
                ingest(args.backend_url, [row])
                continue
        if not delivered and last_exc is not None:
            # Финально не доставлено ни одним аккаунтом (ошибки по попыткам уже записаны).
            pass
        pause = human_delay_seconds(args.delay_min_ms, args.delay_max_ms, tactics['delay_pattern'], flood_mult)
        await asyncio.sleep(pause)
        flood_mult = max(1.0, flood_mult * 0.9)
    for (session_name, client) in clients:
        await client.disconnect()
    for (session_name, src_file, rt_dir) in temp_dirs:
        rt_file = os.path.join(rt_dir, 'session.session')
        if os.path.exists(rt_file):
            shutil.copy2(rt_file, src_file)
        shutil.rmtree(rt_dir, ignore_errors=True)
    print('Рассылка: список получателей обработан (отправки и ошибки см. выше).', flush=True)

asyncio.run(main())
