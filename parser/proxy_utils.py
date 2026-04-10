import json
from urllib.parse import quote


def build_requests_proxies(proxy_json: str):
    if not proxy_json or not str(proxy_json).strip():
        return None
    data = json.loads(proxy_json)
    host = str(data.get("host") or "").strip()
    port = int(data.get("port") or 0)
    login = str(data.get("login") or "").strip()
    password = str(data.get("pass") or "").strip()
    proto = str(data.get("protocol") or "HTTP/S").lower()
    if not host or port <= 0:
        return None
    auth = ""
    if login or password:
        auth = f"{quote(login, safe='')}:{quote(password, safe='')}@"
    if "socks5" in proto:
        url = f"socks5h://{auth}{host}:{port}"
    elif "socks4" in proto:
        url = f"socks4://{auth}{host}:{port}"
    else:
        url = f"http://{auth}{host}:{port}"
    return {"http": url, "https": url}


def build_telethon_proxy(proxy_json: str):
    if not proxy_json:
        return None
    data = json.loads(proxy_json)
    host = str(data.get('host') or '').strip()
    port = int(data.get('port') or 0)
    login = str(data.get('login') or '').strip() or None
    password = str(data.get('pass') or '').strip() or None
    proto = str(data.get('protocol') or 'HTTP/S').lower()
    if not host or port <= 0:
        return None
    import socks
    if 'socks5' in proto:
        kind = socks.SOCKS5
    elif 'socks4' in proto:
        kind = socks.SOCKS4
    else:
        kind = socks.HTTP
    return (kind, host, port, True, login, password)
