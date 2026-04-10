import argparse
import json

import requests

from proxy_utils import build_requests_proxies
from license_guard import ensure_license_valid

ensure_license_valid()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--proxy-json", type=str, required=True)
    args = p.parse_args()
    try:
        proxies = build_requests_proxies(args.proxy_json)
        if not proxies:
            print(json.dumps({"ok": False, "error": "Некорректный прокси"}), flush=True)
            return
        r = requests.get("https://api.ipify.org?format=json", timeout=20, proxies=proxies)
        r.raise_for_status()
        ip = str(r.json().get("ip") or "").strip()
        if not ip:
            print(json.dumps({"ok": False, "error": "Пустой ответ ipify"}), flush=True)
            return
        print(json.dumps({"ok": True, "ip": ip}), flush=True)
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}), flush=True)


main()
