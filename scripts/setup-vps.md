# Развёртывание бота на VPS (Debian 13)

Бот работает непрерывно: `scripts/poll.mjs` с `BOT_LOOP=1` делает long polling
(`getUpdates` c `timeout: 50`) — сообщения обрабатываются за секунды. Данные
коммитятся в репозиторий, сайт на GitHub Pages обновляется сам.

## Установка с нуля

```bash
# 1. Пакеты (nodejs в Debian уже с npm)
apt-get update && apt-get install -y nodejs npm git curl

# 2. Если хостер блокирует часть подсетей Telegram (симптом: api.telegram.org
#    резолвится в IPv6, которого нет, а IPv4-адрес не отвечает) — проверить:
#    timeout 6 bash -c '</dev/tcp/149.154.166.110/443' || echo BLOCKED
#    и закрепить в /etc/hosts работающий IP (проверить: curl --resolve ...):
#      echo "149.154.167.220 api.telegram.org" >> /etc/hosts
#    Плюс приоритет IPv4 для glibc:
#      echo 'precedence ::ffff:0:0/96  100' >> /etc/gai.conf

# 3. Пользователь и код
useradd -m -s /bin/bash bot
git clone https://github.com/ZaytsevAndrei/archero2Dashboard.git /opt/archero2Dashboard
chown -R bot:bot /opt/archero2Dashboard
runuser -u bot -- git -C /opt/archero2Dashboard config user.name "damage-bot"
runuser -u bot -- git -C /opt/archero2Dashboard config user.email "damage-bot@vps.local"
runuser -u bot -- git -C /opt/archero2Dashboard config pull.rebase true
cd /opt/archero2Dashboard && runuser -u bot -- npm install --omit=dev

# 4. Push-доступ в GitHub: deploy key (добавить публичный ключ в
#    Settings → Deploy keys с галкой Allow write access)
runuser -u bot -- ssh-keygen -t ed25519 -N '' -f /home/bot/.ssh/id_ed25519
cat /home/bot/.ssh/id_ed25519.pub
runuser -u bot -- bash -c 'ssh-keyscan -t ed25519,rsa github.com >> ~/.ssh/known_hosts'
runuser -u bot -- git -C /opt/archero2Dashboard remote set-url origin git@github.com:ZaytsevAndrei/archero2Dashboard.git
```

## systemd-сервис

`/etc/systemd/system/archero-bot.service`:

```ini
[Unit]
Description=Archero2 Unity damage bot (Telegram long polling)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=bot
WorkingDirectory=/opt/archero2Dashboard
Environment=BOT_LOOP=1
Environment=NODE_OPTIONS=--dns-result-order=ipv4first
ExecStart=/usr/bin/node scripts/poll.mjs
Restart=always
RestartSec=5
MemoryMax=1600M

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload && systemctl enable --now archero-bot
journalctl -u archero-bot -f   # смотреть логи
```

## Заметки

- Некоторые хостеры режут первые TLS-соединения к Telegram (~10 c висят):
  `tg()` в poll.mjs делает до 2 повторов — этого хватает.
- Если IP из /etc/hosts перестал отвечать — подобрать другой:
  `dig api.telegram.org A` и проверить `/dev/tcp/<ip>/443`.
- Обновление кода: `runuser -u bot -- git -C /opt/archero2Dashboard pull` и
  `systemctl restart archero-bot`.
