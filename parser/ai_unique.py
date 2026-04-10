import requests

def rewrite_with_openai(text: str, api_token: str) -> str:
    prompt = f'Перепиши сообщение для рассылки, сохрани смысл и язык, сделай формулировки естественными и уникальными. Не добавляй объяснений, верни только итоговый текст.\n\nТекст:\n{text}'
    res = requests.post('https://api.openai.com/v1/chat/completions', headers={'Authorization': f'Bearer {api_token}', 'Content-Type': 'application/json'}, json={'model': 'gpt-4o-mini', 'messages': [{'role': 'system', 'content': 'Ты помощник по уникализации текстов рассылок.'}, {'role': 'user', 'content': prompt}], 'temperature': 0.9}, timeout=20)
    res.raise_for_status()
    data = res.json()
    return data.get('choices', [{}])[0].get('message', {}).get('content', '').strip() or text

def rewrite_with_gemini(text: str, api_token: str) -> str:
    prompt = f'Перепиши сообщение для рассылки, сохрани смысл и язык, сделай формулировки естественными и уникальными. Не добавляй объяснений, верни только итоговый текст.\n\nТекст:\n{text}'
    url = f'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_token}'
    res = requests.post(url, headers={'Content-Type': 'application/json'}, json={'contents': [{'parts': [{'text': prompt}]}], 'generationConfig': {'temperature': 0.9}}, timeout=20)
    res.raise_for_status()
    data = res.json()
    return data.get('candidates', [{}])[0].get('content', {}).get('parts', [{}])[0].get('text', '').strip() or text

def rewrite_text(text: str, provider: str, api_token: str) -> str:
    base = str(text or '').strip()
    if not base:
        return base
    selected = str(provider or 'gemini').strip().lower()
    if selected == 'openai':
        return rewrite_with_openai(base, api_token)
    return rewrite_with_gemini(base, api_token)
