# Диаграмма компонентов: Платформа ZooLink

## Цель
Показывает высокоуровневые компоненты и их интерфейсы в платформе ZooLink.

## Описание диаграммы
```mermaid
graph TD
    %% Основные компоненты
    subgraph Core_Components
        direction TB
        Auth_Service[Сервис аутентификации<br/>(JWT, OAuth, SMS)]
        User_Profile[Сервис профиля пользователя<br/>(CRUD, предпочтения)]
        Animal_Service[Сервис животного<br/>(Жизненный цикл, право собственности)]
        Listing_Service[Сервис объявлений<br/>(CRUD, поиск, модерация)]
        Moderation_Service[Сервис модерации<br/>(Очередь, решения)]
        Matching_Service[Сервис подбора<br/>(Совместимость, предложения)]
        Notification_Service[Сервис уведомлений<br/>(Email, SMS, push)]
        Geo_Service[Геосервис<br/>(Пространственный поиск, расстояние)]
        Admin_Service[Административный сервис<br/>(Конфигурация, справочные данные)]
        Payment_Service[Сервис платежей<br/>(Будущее: транзакции)]
    end

    %% Вспомогательные сервисы
    subgraph Supporting_Services
        direction TB
        APIGateway[Шлюз API<br/>(Маршрутизация, аутентификация, ограничение скорости)]
        Web_Gateway[Веб-шлюз<br/>(SSR, обслуживание активов)]
        File_Storage[Сервис хранения файлов<br/>(S3, CDN)]
        Search_Engine[Поисковый движок<br/>(Elasticsearch)]
        Cache_Layer[Слой кеширования<br/>(Redis)]
        Event_Bus[Шина событий<br/>(Pub/Sub, обмен сообщениями)]
        Monitoring[Мониторинг и наблюдаемость<br/>(Метрики, логи, трассировки)]
    end

    %% Слой данных
    subgraph Data_Layer
        direction TB
        Primary_DB[(PostgreSQL<br/>Основная)]
        Replica_DB[(PostgreSQL<br/>Реплика)]
        Archive_DB[(Объектное хранилище<br/>Резервные копии)]
    end

    %% Внешние системы
    subgraph External_Systems
        direction TB
        SMS_Gateway[SMS-провайдер<br/>(Twilio)]
        Email_Service[Email-провайдер<br/>(SendGrid)]
        Maps_Service[Провайдер карт<br/>(Yandex.Maps)]
        OAuth_Providers[Провайдеры OAuth<br/>(Google, Apple, и др.)]
        Payment_Gateways[Платежные шлюзы<br/>(Stripe, PayPal)]
    end

    %% Пользовательские интерфейсы
    subgraph User_Interfaces
        direction TB
        Web_App[Веб-приложение<br/>(SPA/PWA)]
        Mobile_App[Мобильные приложения<br/>(Будущее: iOS/Android)]
        Admin_Panel[Панель администратора<br/>(Дашборд, управление)]
        Moderator_UI[Интерфейс модератора<br/>(Осмотр очереди)]
    end

    %% Отношения
    %% Пользовательские интерфейсы к шлюзам
    Web_App --> APIGateway
    Mobile_App --> APIGateway
    Admin_Panel --> APIGateway
    Moderator_UI --> APIGateway

    %% Шлюзы к сервисам
    APIGateway --> Auth_Service
    APIGateway --> User_Profile
    APIGateway --> Animal_Service
    APIGateway --> Listing_Service
    APIGateway --> Moderation_Service
    APIGateway --> Matching_Service
    APIGateway --> Notification_Service
    APIGateway --> Geo_Service
    APIGateway --> Admin_Service
    APIGateway --> Payment_Service

    %% Зависимости сервисов
    Auth_Service --> User_Profile
    Listing_Service --> Animal_Service
    Listing_Service --> Moderation_Service
    Matching_Service --> Animal_Service
    Matching_Service --> Listing_Service
    Notification_Service --> User_Profile
    Geo_Service --> Animal_Service
    Geo_Service --> Listing_Service

    %% Сервисы к вспомогательной инфраструктуре
    Auth_Service --> Cache_Layer
    User_Profile --> Cache_Layer
    Animal_Service --> Cache_Layer
    Listing_Service --> Cache_Layer
    Moderation_Service --> Cache_Layer
    Matching_Service --> Cache_Layer
    Notification_Service --> Cache_Layer
    Geo_Service --> Cache_Layer
    Admin_Service --> Cache_Layer
    Payment_Service --> Cache_Layer

    Auth_Service --> Event_Bus
    Listing_Service --> Event_Bus
    Moderation_Service --> Event_Bus
    Animal_Service --> Event_Bus
    Notification_Service --> Event_Bus

    Auth_Service --> Search_Engine
    Listing_Service --> Search_Engine
    Animal_Service --> Search_Engine

    %% Сервисы к хранению файлов
    Listing_Service --> File_Storage
    User_Profile --> File_Storage
    Animal_Service --> File_Storage

    %% Слой данных
    Auth_Service --> Primary_DB
    User_Profile --> Primary_DB
    Animal_Service --> Primary_DB
    Listing_Service --> Primary_DB
    Moderation_Service --> Primary_DB
    Matching_Service --> Primary_DB
    Notification_Service --> Primary_DB
    Geo_Service --> Primary_DB
    Admin_Service --> Primary_DB
    Payment_Service --> Primary_DB

    %% Репликация и резервное копирование
    Primary_DB --> Replica_DB
    Primary_DB --> Archive_DB

    %% Внешние интеграции
    Auth_Service --> SMS_Gateway
    Auth_Service --> OAuth_Providers
    Notification_Service --> SMS_Gateway
    Notification_Service --> Email_Service
    Geo_Service --> Maps_Service
    Payment_Service --> Payment_Gateways
    File_Storage --> Maps_Service

    %% Мониторинг
    Monitoring .-> Auth_Service
    Monitoring .-> User_Profile
    Monitoring .-> Animal_Service
    Monitoring .-> Listing_Service
    Monitoring .-> Moderation_Service
    Monitoring .-> Matching_Service
    Monitoring .-> Notification_Service
    Monitoring .-> Geo_Service
    Monitoring .-> Admin_Service
    Monitoring .-> Payment_Service
    Monitoring .-> APIGateway
    Monitoring .-> Cache_Layer
    Monitoring .-> Primary_DB
    Monitoring .-> File_Storage
    Monitoring .-> Search_Engine

    classDef service fill:#E3F2FD,stroke:#1565C0,stroke-width:1px;
    classDef storage fill:#FFF3E0,stroke:#EF6C00,stroke-width:1px;
    classDef external fill:#F3E5F5,stroke:#6A1B9A,stroke-width:1px;
    classDef ui fill:#E8F5E8,stroke:#2E7D32,stroke-width:1px;
    classDef support fill:#F5F5F5,stroke:#616161,stroke-width:1px;
    classDef data fill:#FFEBEE,stroke:#C62828,stroke-width:1px;
    classDef monitoring fill:#FFFDE7,stroke:#F57F17,stroke-width:1px;

    class Auth_Service,User_Profile,Animal_Service,Listing_Service,Moderation_Service,Matching_Service,Notification_Service,Geo_Service,Admin_Service,Payment_Service service;
    class File_Storage,Search_Engine,Cache_Layer storage;
    class SMS_Gateway,Email_Service,Maps_Service,OAuth_Providers,Payment_Gateways external;
    class Web_App,Mobile_App,Admin_Panel,Moderator_UI ui;
    class APIGateway,Web_Gateway,Event_Bus support;
    class Primary_DB,Replica_DB,Archive_DB data;
    class Monitoring monitoring;
```

## Описание компонентов

### Основные бизнес-сервисы
- **Сервис аутентификации**: Обрабатывает аутентификацию пользователей (телефон/OAuth), генерацию и валидацию JWT, управление сессиями
- **Сервис профиля пользователя**: Управляет профилями пользователей, настройками, предпочтениями и связями пользователь-организация
- **Сервис животного**: Управление основной сущностью животного включая жизненный цикл, право собственности, родословную и данные о здоровье
- **Сервис объявлений**: Управление жизненным циклом объявлений, функциональностью поиска, рабочим процессом модерации и состояниями транзакций
- **Сервис модерации**: Управление очередью, workflow принятия решений, журналы аудита и назначение модераторов
- **Сервис подбора**: Алгоритмы совместимости для предложений пар на основе генетики, местоположения и предпочтений
- **Сервис уведомлений**: Обрабатывает всю исходящую коммуникацию (email, SMS, push-уведомления)
- **Геосервис**: Пространственная индексация, расчеты расстояний и оптимизация гео-поиска
- **Административный сервис**: Управление конфигурацией системы, справочными данными (породы, виды) и административными функциями
- **Сервис платежей**: Заглушка для будущей обработки платежей (эскроу, подписки, комиссии)

### Вспомогательная инфраструктура
- **Шлюз API**: Точка входа, обрабатывающая маршрутизацию, аутентификацию, ограничение скорости и преобразование запросов/ответов
- **Веб-шлюз**: Server-side rendering, обслуживание активов и оптимизация SEO для веб-краулеров
- **Сервис хранения файлов**: Абстрагирует операции с объектным хранилищем (S3-совместимое) с интеграцией CDN
- **Поисковый движок**: Предоставляет возможности полнотекстового поиска для объявлений и профилей животных
- **Слой кеширования**: Распределенное кеширование часто используемых данных (сессии, справочные данные, вычисленные результаты)
- **Шина событий**: Обеспечивает слабую связанность между сервисами через паттерны pub/sub обмена сообщениями
- **Мониторинг и наблюдаемость**: Собирает метрики, логи и трассировки для анализа состояния системы и производительности

### Слой данных
- **Основная база данных**: Основной экземпляр PostgreSQL, обрабатывающий все операции чтения/записи
- **Реплика база данных**: Реплики только для чтения для масштабирования операций чтения и аналитики
- **Архивное хранилище**: Долгосрочное хранилище резервных копий для соответствия требованиям и восстановления после сбоев

### Внешние системы
- **SMS-провайдер**: Сервис третьей стороны для отправки кодов верификации и уведомлений
- **Email-провайдер**: Сервис третьей стороны для транзакционных и маркетинговых email
- **Провайдер карт**: Сервис геокодинга и карт для функций, основанных на местоположении
- **Провайдеры OAuth**: Сервисы третьей стороны для вариантов социального входа
- **Платежные шлюзы**: Будущая интеграция с платежными процессорами для финансовых транзакций

### Пользовательские интерфейсы
- **Веб-приложение**: Одностраничное приложение с возможностями PWA для доступа через браузер
- **Мобильные приложения**: Нативные iOS/Android приложения (планируются для будущих фаз)
- **Панель администратора**: Административная панель для конфигурации системы и управления пользователями
- **Интерфейс модератора**: Специализированный интерфейс для модераторов для просмотра и принятия решений по объявлениям

## Контракты интерфейсов

### Синхронные интерфейсы (REST/gRPC)
- Все основные сервисы предоставляют RESTful API через HTTPS
- Внутренняя коммуникация между сервисами использует gRPC для критически важных по производительности путей
- Шлюз API обрабатывает перевод протоколов и балансировку нагрузки

### Асинхронные интерфейсы (Event-Driven)
- Сервисы публикуют доменные события в шину событий для слабой связанности
- Примеры: AnimalCreated, ListingPublished, ModerationDecisionMade, MatchFound
- Обеспечивает Eventual Consistency и оркестрацию workflow

### Паттерны доступа к данным
- Сервисы обращаются к базам данных через ORM/repositories с пулом соединений
- Операции, интенсивные по чтению, могут использовать реплики баз данных
- Паттерн Cache-aside для часто используемых данных
- Паттерн Write-through кеширования для данных сессий

## Рекомендации по развертыванию
- Сервисы могут развертываться независимо или как монолит
- Оркестрация контейнеров через Kubernetes (EKS/GKE/самодостаточный)
- Паттерн базы данных на сервис возможен для будущей эволюции в микросервисы
- Сервис-меш (Istio/Linkerd) может управлять межсервисной коммуникацией
- Поддерживаются сине-зеленые развертывания для нулевого простоя при релизе