# Диаграмма развертывания: Инфраструктура платформы ZooLink

## Цель
Показывает физическое развертывание артефактов на инфраструктурных узлах.

## Описание диаграммы
```mermaid
graph TD
    %% User Devices
    subgraph User_Devices
        direction TB
        Desktop[Десктопный браузер<br/>(Chrome, Firefox, Safari)]
        Mobile[Мобильный браузер<br/>(iOS/Android)]
        Tablet[Планшетный браузер<br/>(iPad/Android)]
    end

    %% CDN Layer
    subgraph CDN_Layer[Сеть доставки контента]
        direction TB
        CDN_Edge[Крайние узлы CDN<br/>(CloudFront, Cloudflare)]
    end

    %% Load Balancing
    subgraph Load_Balancers
        direction TB
        ALB[Балансировщик нагрузки приложений<br/>(Завершение HTTPS)]
        ILB[Внутренний балансировщик нагрузки<br/>*(Service-to-service)*]
    end

    %% Compute Layer (Kubernetes)
    subgraph Kubernetes_Cluster[Кластер Kubernetes<br/>(Управляемый или самодостаточный)]
        direction TB
        %% Control Plane
        subgraph Control_Plane
            direction TB
            K8s_API[API-сервер Kubernetes]
            K8s_Scheduler[Планировщик]
            K8s_Controller[Менеджер контроллеров]
            K8s_Etcd[(кластер etcd)]
        end

        %% Worker Nodes
        subgraph Worker_Nodes
            direction TB
            subgraph Node_1[Worker Node 1]
                direction TB
                Kubelet[Kubelet]
                Kube_Proxy[kube-proxy]
                Container_Runtime[Контейнерная среда выполнения<br/>(containerd/cri-o)]
                %% Pods on Node 1
                subgraph Pods_Node1
                    direction TB
                    Web_Pod[Под веб-приложения<br/>(активы SPA)]
                    API_Pod[Под API<br/>(NestJS бэкенд)]
                    Worker_Pod[Под фоновых worker'ов<br/>(Задания, очереди)]
                end
            end

            subgraph Node_2[Worker Node 2]
                direction TB
                Kubelet[Kubelet]
                Kube_Proxy[kube-proxy]
                Container_Runtime[Контейнерная среда выполнения<br/>(containerd/cri-o)]
                %% Pods on Node 2
                subgraph Pods_Node2
                    direction TB
                    API_Pod[Под API<br/>(NestJS бэкенд)]
                    Cron_Pod[Под cron-заданий<br/>(Запланированные задачи)]
                    Monitoring_Pod[Под мониторинга<br/>(Prometheus, Grafana)]
                end
            end

            subgraph Node_3[Worker Node 3]
                direction TB
                Kubelet[Kubelet]
                Kube_Proxy[kube-proxy]
                Container_Runtime[Контейнерная среда выполнения<br/>(containerd/cri-o)]
                %% Pods on Node 3
                subgraph Pods_Node3
                    direction TB
                    DB_Postgres[Под PostgreSQL<br/>(Основной экземпляр)]
                    DB_Postgres_Replica[Под PostgreSQL<br/>(Экземпляр-реплика)]
                    Redis_Pod[Под Redis<br/>(Кластер кеша)]
                end
            end
        end
    end

    %% Data Stores
    subgraph Data_Stores
        direction TB
        PV_Postgres[Постоянный том<br/>(Данные PostgreSQL)]
        PV_Redis[Постоянный том<br/>(Данные Redis)]
        PV_Backups[Постоянный том<br/>(Хранилище бэкапов)]
        Object_Storage[Корзина объектного хранилища<br/>*(S3-совместимое)*]
        Search_Index[Индекс поиска<br/>(Elasticsearch/OpenSearch)]
    end

    %% External Services
    subgraph External_Services
        direction TB
        SMS_Gateway[Провайдер SMS<br/>*(API Twilio)*]
        Email_Service[Провайдер email<br/>*(API SendGrid)*]
        Maps_Service[Провайдер карт<br/>*(API Yandex.Maps)*]
        OAuth_Providers[Провайдеры OAuth<br/>*(Google, Apple и др.)*]
        Monitoring_Service[Внешний мониторинг<br/>*(Datadog, New Relic)*]
    end

    %% Relationships
    %% User to CDN/LB
    Desktop --> CDN_Edge
    Mobile --> CDN_Edge
    Tablet --> CDN_Edge
    CDN_Edge --> ALB

    %% Load Balancing
    ALB --> ILB
    ILB --> K8s_API

    %% Kubernetes Internal
    K8s_API --> K8s_Scheduler
    K8s_API --> K8s_Controller
    K8s_API --> K8s_Etcd

    %% Pod to Node mapping (implicit in subgraph structure)
    %% Services communication
    Web_Pod --> API_Pod
    API_Pod --> DB_Postgres
    API_Pod --> DB_Postgres_Replica
    API_Pod --> Redis_Pod
    API_Pod --> Object_Storage
    API_Pod --> Search_Index
    Worker_Pod --> DB_Postgres
    Worker_Pod --> Redis_Pod
    Cron_Pod --> DB_Postgres
    Cron_Pod --> Object_Storage
    Monitoring_Pod --> PV_Backups
    Monitoring_Pod --> Object_Storage

    %% Persistent Volumes
    DB_Postgres --> PV_Postgres
    DB_Postgres_Replica --> PV_Postgres
    Redis_Pod --> PV_Redis
    %% Monitoring_Pod --> PV_Backups (показано выше)

    %% Object Storage relationship
    Object_Storage --> PV_Backups

    %% External Integrations
    API_Pod --> SMS_Gateway
    API_Pod --> Email_Service
    API_Pod --> Maps_Service
    API_Pod --> OAuth_Providers
    Monitoring_Pod --> Monitoring_Service

    %% Database Replication
    DB_Postgres -->|Репликация| DB_Postgres_Replica

    %% Стилизация
    classDef user fill:#E3F2FD,stroke:#1565C0,stroke-width:1px;
    classDef cdn fill:#FFF3E0,stroke:#EF6C00,stroke-width:1px;
    classDef lb fill:#F3E5F5,stroke:#6A1B9A,stroke-width:1px;
    classDef k8s fill:#E8F5E8,stroke:#2E7D32,stroke-width:1px;
    classDef data fill:#FFEBEE,stroke:#C62828,stroke-width:1px;
    classDef external fill:#F5F5F5,stroke:#616161,stroke-width:1px;
    classDef pv fill:#FFF8E1,stroke:#FFB300,stroke-width:1px;

    class Desktop,Mobile,Tablet user;
    class CDN_Edge cdn;
    class ALB,ILB lb;
    class K8s_API,K8s_Scheduler,K8s_Controller,K8s_Etcd,Kubelet,Kube_Proxy,Container_Runtime k8s;
    class Web_Pod,API_Pod,Worker_Pod,Cron_Pod,Monitoring_Pod,DB_Postgres,DB_Postgres_Replica,Redis_Pod k8s;
    class PV_Postgres,PV_Redis,PV_Backups,Object_Storage,Search_Index data;
    class SMS_Gateway,Email_Service,Maps_Service,OAuth_Providers,Monitoring_Service external;
```

## Описание узлов

### Устройства пользователей
- **Десктопный браузер**: Основной метод доступа для пользователей (продвинутые пользователи, администраторы)
- **Мобильный браузер**: Доступ для пользователей в движении (большинство пользователей)
- **Планшетный браузер**: Альтернативный опыт просмотра

### Слой CDN
- **Крайние узлы CDN**: Распределенные узлы, обслуживающие статические ассеты (JS, CSS, изображения) с низкой латентностью

### Балансировка нагрузки
- **Балансировщик нагрузки приложений**: Завершает SSL/TLS, выполняет проверки работоспособности, маршрутизирует в Kubernetes
- **Внутренний балансировщик нагрузки**: Внутренняя коммуникация сервис-сервис внутри кластера

### Кластер Kubernetes
- **Плоскость управления**: Управляет состоянием кластера и оркестрирует рабочие нагрузки
- **Рабочие узлы**: Выполняют контейнеризованные рабочие нагрузки (поды)

#### Стратегия распределения подов
- **Узел 1**: Веб-обслуживание и слой API (компоненты, обращенные к пользователю)
- **Узел 2**: Обработка API и фоновые задания (вычислительно интенсивные задачи)
- **Узел 3**: Уровень хранения данных (база данных, кеш, поиск)

### Хранилища данных
- **Постоянные тома**: Обеспечивают долговечное хранилище для состоятельных рабочих нагрузок
- **Объектное хранилище**: Масштабируемое хранилище BLOB для загруженных пользователями медиафайлов
- **Индекс поиска**: Возможность полнотекстового поиска для объявлений и профилей

### Внешние сервисы
- Сторонние API для связи (SMS, email), отображения карт, идентификации и мониторинга

## Шаблоны коммуникации

### Северо-южный трафик
- **Пользователь ↔ CDN ↔ ALB**: Доставка статических ассетов и первоначальная обработка запросов
- **ALB ↔ ILB ↔ API Pods**: Внешний доступ к API через балансировщики нагрузки

### Восток-западный трафик
- **API Pods ↔ База данных**: Основные шаблоны доступа к данным
- **API Pods ↔ Кеш**: Хранение сетей и кэширование справочных данных
- **API Pods ↔ Объектное хранилище**: Операции загрузки/скачивания медиа
- **API Pods ↔ Индекс поиска**: Полнотекстовые поисковые запросы
- **Фоновые поды ↔ База данных/Хранилище**: Пакетная обработка и задачи обслуживания
- **Поды мониторинга → Все сервисы**: Сбор метрики и сбор журналов

### Внешняя интеграция
- **API Pods ↔ Провайдеры SMS/Email**: Доставка уведомлений
- **API Pods ↔ Провайдер карт**: Геокодинг и расчеты расстояний
- **API Pods ↔ Провайдеры OAuth**: Потоки входа через социальные сети
- **Поды мониторинга → Внешний мониторинг**: Экспорт метрик и оповещения

## Характеристики масштабирования

### Горизонтальное автосмасштабирование подов (HPA)
- Масштабирование на основе CPU/памяти для сервисов без состояния (Web, API, Workers)
- Масштабирование на основе пользовательских метрик для длины очереди (фоновые worker'ы)
- Минимальные/максимальные ограничения реплик на развертывание

### Вертикальное автосмасштабирование подов (VPA)
- Рекомендации по ресурсам для оптимального размер контейнеров
- Применяется к подам базы данных и кеша для оптимизации ресурсов

### Автосмасштабирование кластера
- Масштабирование групп узлов на основе требований планирования подов
- Различные пулы узлов для различных рабочих нагрузок (вычислительно-оптимизированные, память-оптимизированные, хранилище-оптимизированные)

## Учитываемые аспекты восстановление после сбоев

### Развертывание в нескольких зонах
- Плоскость управления распределена по зонам доступности
- Рабочие узлы распределены по зонам для отказоустойчивости
- Постоянные тома с зоново-осознанным предоставлением

### Стратегия резервного копирования
- Регулярные снимки постоянных томов
- Версионирование объектного хранилища и репликация между регионами
- Логические бэкапы базы данных и архивирование WAL
- Снимки индекса поиска

### Процедуры переключения
- Повышение базы данных: реплика → основной
- Перенаправление трафика через проверки работоспособности балансировщика
- Процедуры разогрева кеша после переключения
- Мониторинг запаздывания репликации индекса поиска

## Рассмотрения безопасности

### Сетевые политики
- Ограничение коммуникаций под-под только на необходимые пути
- База данных доступна только из пода API и worker
- Внешние сервисы доступны только через контролируемый исходящий трафик

### Управление секретами
- Секреты Kubernetes для учетных данных базы данных, API-ключей
- Внешние менеджеры секретов (HashiCorp Vault, AWS Secrets Manager) для ротации
- Идентификация пода для наименьших привилегий доступа к облачным ресурсам

### Безопасность образов
- Сканирование базовых образов на наличие уязвимостей
- Выполнение от non-root пользователя в контейнерах
- Только для чтения корневая файловая система где возможно
- Проверка подписи для доверенных образов