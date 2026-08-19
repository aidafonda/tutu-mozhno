# Деплой на VPS Aeza

## Требования

Ubuntu 22.04/24.04, Docker Engine и Compose plugin, открытые порты 80/443, домен с A-записью и исходящий HTTPS к `mcp.tutu.ru`.

## До деплоя

Проверить доступность MCP именно из Вены:

```bash
curl -I https://mcp.tutu.ru/mcp
```

HTML-ответ для браузерного запроса нормален; важно само HTTPS-соединение.

## Установка

```bash
git clone <PUBLIC_REPOSITORY_URL> tutu-mozhno
cd tutu-mozhno
cp .env.example .env
nano .env
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 app
```

`.env`:

```env
TUTU_MCP_URL=https://mcp.tutu.ru/mcp
FALLBACK_MODE=demo
APP_DOMAIN=demo.example.com
```

## Проверка

```bash
curl -fsS https://demo.example.com/api/health
curl -fsS https://demo.example.com/docs > /dev/null
```

Затем выполнить поиск и проверить индикатор `MCP онлайн`. При demo fallback посмотреть `docker compose logs --tail=200 app`.

## Обновление

```bash
git pull --ff-only
docker compose up -d --build
```

## Перед питчем

- [ ] Домен открывается с телефона по мобильной сети.
- [ ] `/api/health` отвечает `status: ok`.
- [ ] Индикатор показывает живой MCP.
- [ ] Москва → Казань работает два раза подряд.
- [ ] `/docs` доступна без авторизации.
- [ ] Репозиторий публичный и клонируется.
- [ ] В README стоят публичные ссылки.
- [ ] Контейнеры healthy.
- [ ] Локальная копия соответствует публичному commit SHA.
- [ ] Сервер работает до окончания судейства.
