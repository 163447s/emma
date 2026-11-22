#!/usr/bin/env python3
"""他的主动消息 —— GitHub Actions 定时跑一次。

流程：读字卡池 → 掷一次概率 → 抽一句 → PushPlus 发微信 → 记进 offline-messages.json
这句会同时出现在「离线补消息」里，她下次打开站点时自动补进聊天。
"""
import datetime
import json
import os
import random
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CARDS = os.path.join(ROOT, 'data', 'push-cards.json')
CONFIG = os.path.join(ROOT, 'data', 'push-config.json')
OFFLINE = os.path.join(ROOT, 'data', 'offline-messages.json')

BJT = datetime.timezone(datetime.timedelta(hours=8))


def load(path, default):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return default


def save(path, data):
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def main():
    token = (os.environ.get('PUSHPLUS_TOKEN') or '').strip()
    if not token:
        print('没有配置 PUSHPLUS_TOKEN，跳过')
        return

    cfg = load(CONFIG, {})
    cards = load(CARDS, [])
    if not isinstance(cards, list) or not cards:
        print('字卡池是空的（data/push-cards.json），跳过')
        return

    now = datetime.datetime.now(BJT)
    hours = cfg.get('hours') or [9, 22]
    if not (hours[0] <= now.hour <= hours[1]):
        print('现在不在允许的时段（%s-%s 点），跳过' % (hours[0], hours[1]))
        return

    offline = load(OFFLINE, [])
    if isinstance(offline, list):
        today = now.strftime('%Y-%m-%d')
        today_count = sum(1 for m in offline if str(m.get('ts', '')).startswith(today))
        if today_count >= int(cfg.get('maxPerDay') or 8):
            print('今天已经发了 %d 条，够了' % today_count)
            return

    chance = float(cfg.get('chance') or 0.22)
    if random.random() > chance:
        print('这次没发（概率 %.2f）' % chance)
        return

    text = random.choice(cards).strip()
    if not text:
        return
    name = cfg.get('name') or '他'

    payload = json.dumps({
        'token': token,
        'title': name,
        'content': text,
        'template': 'txt',
    }, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(
        'https://www.pushplus.plus/send', data=payload,
        headers={'Content-Type': 'application/json'})
    try:
        resp = urllib.request.urlopen(req, timeout=15).read().decode('utf-8', 'ignore')
        print('推送结果：', resp[:200])
    except Exception as e:
        print('推送失败：', e)
        return

    offline = load(OFFLINE, [])
    if not isinstance(offline, list):
        offline = []
    offline.append({
        'id': int(time.time() * 1000),
        'ts': now.isoformat(timespec='seconds'),
        'text': text,
    })
    save(OFFLINE, offline[-30:])

    # 提交回去，页面上才能补到这条
    try:
        subprocess.run(['git', 'config', 'user.name', 'emma-bot'], check=True, cwd=ROOT)
        subprocess.run(['git', 'config', 'user.email', 'bot@local'], check=True, cwd=ROOT)
        subprocess.run(['git', 'add', 'data/offline-messages.json'], check=True, cwd=ROOT)
        subprocess.run(['git', 'commit', '-m', 'push: 他来了一条消息'], check=True, cwd=ROOT)
        subprocess.run(['git', 'push'], check=True, cwd=ROOT)
    except subprocess.CalledProcessError as e:
        print('回写失败（不影响推送本身）：', e)


if __name__ == '__main__':
    main()
