# Viewer Clinical Frontend

Адаптивный frontend медицинской DICOM-платформы Viewer. Интерфейс написан на
React Native с Expo и React Native Web: одна кодовая база работает в desktop- и
mobile-браузерах, а позднее может быть расширена до нативных приложений.

## Что реализовано

- список до 100 протоколов операций с поиском и фильтрами по датам;
- адаптивная карточка клинического протокола;
- отдельный список XA/CT, мобильный просмотр XA и отправка в remote PACS;
- выбор конкретного результата `find_study` и импорт полного протокола;
- постановка поддерживаемых заданий hospital agent;
- автоматическое обновление незавершённых заданий;
- серверная история заданий, удаление, множественный выбор и пересылка;
- просмотр сохранённых отчётов;
- интерактивные списки пациентов в отчёте и недельный оперативный план;
- локальные настройки `agent_id` и временного `user_id`;
- индикация доступности backend;
- desktop sidebar, мобильное меню и bottom navigation;
- тематическая splash-заставка и PWA-иконка;
- состояния загрузки, пустых данных и ошибок;
- Docker-сборка статического приложения и reverse proxy к backend.

## Быстрый запуск через Docker Compose

Требуется Docker с Compose plugin.

```bash
cp .env.example .env
docker compose up --build --wait
```

Приложение откроется на [http://localhost:5173](http://localhost:5173).

По умолчанию proxy подключается к действующему backend
`http://135.106.130.37:8080`, а DICOMweb и desktop OHIF — к
`http://135.106.130.37:3000`. Эти значения можно изменить в `.env`:

```dotenv
BACKEND_URL=http://SERVER:8080
OHIF_URL=http://SERVER:3000
EXPO_PUBLIC_OHIF_URL=http://SERVER:3000
FRONTEND_PORT=5173
```

После изменения `EXPO_PUBLIC_OHIF_URL` образ нужно пересобрать, потому что этот
адрес встраивается в web bundle:

```bash
docker compose up -d --build
```

`BACKEND_URL` и `OHIF_URL` применяются при старте контейнера и пересборки не
требуют. Мобильный просмотр XA использует собственный cine-интерфейс и
покадровый DICOMweb Rendered через same-origin `/dicom-web`; OHIF остаётся
desktop-просмотрщиком.

## Docker Hub

Готовый multi-platform production-образ опубликован для Linux `amd64` и
`arm64`:

```text
docker.io/idrisovmarat/viewer_frontend:0.1.0
docker.io/idrisovmarat/viewer_frontend:latest
```

Проверка и запуск без локальной сборки:

```bash
docker pull idrisovmarat/viewer_frontend:0.1.0
docker run --rm -p 5173:8080 \
  -e BACKEND_URL=http://135.106.130.37:8080 \
  -e OHIF_URL=http://135.106.130.37:3000 \
  idrisovmarat/viewer_frontend:0.1.0
```

Workflow `.github/workflows/docker-publish.yml` автоматически собирает
`linux/amd64` и `linux/arm64` и публикует теги при push в `main`, создании тега
`v*` или ручном запуске. В GitHub необходимо добавить repository secrets:

- `DOCKERHUB_USERNAME` — `idrisovmarat`;
- `DOCKERHUB_TOKEN` — access token Docker Hub с правом записи.

Опциональная repository variable `EXPO_PUBLIC_OHIF_URL` изменяет адрес OHIF,
встраиваемый в web bundle.

## Локальная разработка

Проект использует pnpm и Node.js 20.19+:

```bash
pnpm install
pnpm web
```

При запуске без Docker путь `/api` необходимо направить на Viewer backend
локальным reverse proxy. Для проверки production-поведения рекомендуется
Docker Compose.

Проверки:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Почему запросы идут через `/api`

Текущий Go backend не добавляет CORS-заголовки. Браузер поэтому не может
напрямую обращаться с `localhost:5173` к серверу `:8080`. Nginx внутри frontend
контейнера принимает same-origin запросы `/api/*`, удаляет префикс `/api` и
проксирует их в действующий backend.

Например:

```text
Browser GET /api/studies
  → frontend nginx
  → http://SERVER:8080/studies
```

## Текущие ограничения

- backend пока не предоставляет авторизацию и роли;
- список endpoint возвращает максимум 100 исследований без общего `total`;
- локальный кэш заданий остаётся резервным вариантом при недоступном backend;
- мобильный просмотр зависит от поддержки WADO-RS Rendered в PACS; текущий
  Orthanc предоставляет её для загруженных XA и выполняет серверное
  декодирование transfer syntax;
- `/reports` может отсутствовать на сервере старой версии — интерфейс корректно
  показывает это как недоступное состояние;
- серверные HTTP endpoint следует закрыть TLS/VPN до публичной эксплуатации.

## Структура

```text
App.tsx                 адаптивная оболочка и продуктовые экраны
src/api.ts              типизированный клиент текущего Viewer API
src/storage.ts          локальные настройки и история заданий
src/theme.ts            клиническая дизайн-система
src/ui.tsx              переиспользуемые UI-компоненты
src/types.ts            контракты backend
deploy/nginx.conf.template
Dockerfile
compose.yaml
.github/workflows/docker-publish.yml
```

## Подготовка GitHub

Каталог предназначен для репозитория
`github.com/repomz/viewer_frontend`. После создания удалённого репозитория:

```bash
git init
git branch -M main
git remote add origin git@github.com:repomz/viewer_frontend.git
git add .
git commit -m "Build adaptive Viewer clinical frontend"
git push -u origin main
```
