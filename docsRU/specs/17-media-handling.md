---
version: "1.0"
lastUpdated: "2026-06-18"
author: "Architecture Review Board"
status: "Approved"
---

# Спецификация: Обработка медиа и файлов (фото, аватары, логотипы)

## Результат
Определяет сквозной медиа-пайплайн (pre-signed S3-загрузка, валидация, варианты, жизненный цикл, приватность),
чтобы бэкенд реализовал загрузки без изобретения контракта. Закрывает медиа-пробел раунда 5. Согласовано с ADR-0001
(pre-signed URL) и ADR-0008 (РФ object storage / CDN).

## 1. Поток загрузки (pre-signed, нормативно)
1. Клиент → `POST /api/v1/uploads` `{ purpose: "listing_photo|avatar|org_logo", content_type, byte_size }`
   (аутентифицировано). Сервер валидирует лимиты (§2), возвращает `{ upload_url, object_key, headers, expires_at }`.
   Объект пишется под префикс **`tmp/`**; политика pre-signed PUT фиксирует `Content-Type` и max-размер.
2. Клиент → `PUT` байты напрямую в `upload_url` (S3-совместимо).
3. Клиент → attach: напр. `POST /api/v1/listings/{id}/photos` `{ object_key, order_index }`. Сервер проверяет наличие
   объекта, **переносит `tmp/` → постоянный префикс**, выполняет постобработку (§3, §5) и пишет `listing_photos`.
- `listing_photos.url` хранит **object key** (immutable); публичный CDN-URL вычисляет сервер/адаптер при чтении
  (никогда не доверять URL от клиента).

## 2. Лимиты валидации (нормативно)
- **MIME:** только `image/jpeg`, `image/png`, `image/webp`.
- **Размер:** ≤ 10 МБ/файл. **Разрешение:** ≤ 8000×8000 px.
- **Кол-во:** фото объявления 1–10 (`MAX_MEDIA_ITEMS=10`); **≥1 фото обязательно** для DRAFT→PENDING_MODERATION.
  Аватар/логотип: ровно 1, ≤ 5 МБ, желательно квадрат.
- Проверка дважды: в политике pre-signed (Content-Type + Content-Length) и при attach.

## 3. Варианты изображений
При attach сервер генерирует фиксированный набор: `thumb` (150px), `card` (600px), `full` (≤1600px), перекодировка
в **WebP** (оригинал хранится для скачивания). Именование: `<key>__<variant>.webp`. (On-the-fly CDN-resize может
заменить это в Фазе 2.)

## 4. Жизненный цикл
- `order_index` задаёт порядок; `order_index = 0` — главное фото. Переупорядочивание —
  `PATCH /api/v1/listings/{id}/photos` `[{photo_id, order_index}]`. Удаление — `DELETE .../photos/{photoId}`.
- CRUD фото — только для `seller_id` объявления (или члена org по RBAC).
- При удалении объявления `listing_photos` удаляются каскадно; фоновый джоб удаляет объекты + варианты.
- **Очистка orphan:** lifecycle-правило S3 удаляет всё под `tmp/` через 24 ч; джоб-воркер также удаляет постоянные
  объекты без ссылки `listing_photos`/`users.avatar_url`/`organizations.logo_url` (еженедельно).

## 5. Безопасность и приватность
- **Удаление EXIF/GPS обязательно** для каждого загруженного изображения (ФЗ-152 — фото могут нести геолокацию/метаданные владельца).
- **Антивирус-скан** (ClamAV или провайдер) до выхода объекта из `tmp/`; при детекте attach отклоняется, объект удаляется.
- Бакет **приватный**; объекты отдаются только через CDN (подписанные/публичные CDN-URL), без прямого доступа к бакету.
  CORS ограничивает pre-signed PUT origin'ами приложения. Шифрование SSE-S3 at-rest по security_specification.md.
- **Контент-модерация** изображений (NSFW) — ручная в MVP: фото проверяются с объявлением при пре-модерации;
  автоанализ — Фаза 2 (ADR-0006).

## 6. CDN
Отдаётся через РФ CDN (Yandex/VK/Selectel, ADR-0008). Object key — content-addressed (с хэшем содержимого), поэтому
изменённое изображение получает новый key — **инвалидация кэша не нужна**; при удалении возможен purge CDN.

## Связанное
- ADR-0001 (pre-signed URL), [ADR-0008](../04-decisions/0008-rf-provider-matrix.md), `storage.md`,
  `performance_specification.md`, `security/security_specification.md`, `12-moderation-domain.md`, `data-governance.md`
- 🌐 EN: [docs/specs/17-media-handling.md](../../docs/specs/17-media-handling.md)
