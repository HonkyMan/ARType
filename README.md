# ARType

Корпоративный перевод выделенного текста и его замена прямо в приложениях.
Форк [TypeTide](https://github.com/everettjf/typetide), MIT License.

Сотрудник устанавливает клиент, входит через Google и выбирает организацию.
Модель, ключ провайдера, места и ограничения управляются сервером. Руководители
управляют своей командой. Инвойсы выставляются вручную; эквайринг не подключён.

## Состояние поставки

Реализованы сервер, кабинет, корпоративные клиенты и сборочные сценарии.
Пакеты `UNSIGNED-VALIDATION` предназначены для технической проверки.
Для раздачи сотрудникам требуются конечный домен, реальный Google OAuth,
провайдер, подписи и [приёмка](docs/ACCEPTANCE.md). Тестовый preview-сервер
имитирует Google/AI и не является рабочим корпоративным сервисом.

| Путь | Назначение |
|---|---|
| `server/src`, `server/public` | API, Google-вход, организации, прокси, кабинет |
| `macos` | SwiftUI, macOS 26+, сборка Apple Silicon |
| `windows` | Win32, Windows 10+, x64 |
| `branding` | SVG-знак и wordmark, системные иконки |
| `compose.yaml`, `deployment` | PostgreSQL, API, HTTPS/Caddy, backup/restore |

## Сервер

Нужны Linux с Docker Compose, домен, DNS A/AAAA на сервер и открытые TCP 80/443.
Не создавайте AAAA без работающего IPv6. База и API наружу не публикуются.

```bash
cp .env.example .env
chmod 600 .env
openssl rand -hex 32
```

В `.env` задайте DOMAIN, сгенерированный POSTGRES_PASSWORD, ADMIN_EMAILS,
Google client ID/secret, PROVIDER_BASE_URL и PROVIDER_KEYS. Пароль базы должен
быть URL-safe: hex выше подходит. ADMIN_EMAILS — доверенные операторы всего
сервиса, разделённые запятыми. Владельцев продуктов в этот список не добавляйте.

PROVIDER_KEYS — JSON вида `{"main":"ключ"}`. Сотрудники ключ не получают;
в кабинете выбирается только alias `main`. Можно задать несколько aliases.
Один сервер использует один OpenAI-совместимый PROVIDER_BASE_URL; модель
задаётся отдельно для каждой организации.

```bash
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

Проверьте `https://ваш-домен/health`, затем войдите в кабинет. Оператор создаёт
организацию, назначает модель, alias, места, квоты и email владельца. Владелец
входит на приглашённый Google email и добавляет коллег. Приглашения действуют
7 дней и резервируют место; адрес кабинета и установщики передаются вручную.
Email автоматически не отправляется.

## Google OAuth

1. В [Google Cloud Console](https://console.cloud.google.com/auth/overview)
   выберите проект. В Google Auth Platform заполните Branding: ARType, поддержку
   и домен. Для нескольких независимых компаний нужна External audience.
2. В режиме Testing добавьте пилотные email в Test users. Перед широкой выдачей
   переведите consent screen в Production и выполните требования консоли Google.
3. В Data Access оставьте только `openid`, `email`, `profile`.
4. В Clients создайте **Web application**. Authorized redirect URI:
   `https://ваш-домен/auth/google/callback` — точное совпадение с DOMAIN.
5. Сохраните Client ID и Client Secret в `.env` и пересоздайте API:

```bash
docker compose up -d --force-recreate api
```

Отдельные Desktop OAuth clients не нужны: нативное приложение открывает браузер,
сервер проводит Google-вход, человек сверяет код устройства и подтверждает вход.
Google secret остаётся на сервере. Сессии ARType хранятся в Keychain / Credential
Manager, в базе — их хеши. Основа: [Google Web OAuth](https://developers.google.com/identity/protocols/oauth2/web-server).

## Установщики

Один HTTPS-адрес сервиса встраивается при сборке для всех организаций. Сотрудник
не вводит URL, ключи или модель. Mac требует Xcode/Metal и Package.resolved.

```bash
scripts/build-artype-macos.sh https://ваш-домен --validation
```

Для поставки задайте ARTYPE_SIGN_IDENTITY (Developer ID Application),
ARTYPE_NOTARY_PROFILE (профиль `notarytool`) и замените флаг на `--release`.
Сценарий подписывает, notarizes и staples приложение/DMG, проверяет Gatekeeper,
сохраняет DMG и SHA-256 в `build/artype/`.

Windows требует Visual Studio C++/Windows SDK, CMake и Inno Setup 6:

```powershell
./scripts/build-artype-windows.ps1 -ServiceUrl https://ваш-домен -Validation
```

Для подписанного выпуска передайте CertificateThumbprint вместо Validation;
signtool должен быть в PATH. Подписываются EXE приложения и установщика.
На Mac сотрудник вручную выдаёт Accessibility в системных настройках.
Обновления пока выдаются администратором новыми установщиками; upstream канал
TypeTide отключён. Полный MIT notice включён в пакеты.

## Проверки

```bash
cd server
npm ci --ignore-scripts
TEST_DATABASE_URL=postgresql://artype@127.0.0.1:55438/artype_test npm test
npm run check
```

Используйте отдельную базу с суффиксом `_test`: тесты очищают таблицы.
Mac: `xcodebuild -project macos/TypeTide.xcodeproj -scheme TypeTide -configuration Debug -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO test`.
Внутреннее имя схемы сохранено; bundle/executable называются ARType.
Windows: `ARType.exe --selftest`. GitHub Actions проверяет обе платформы и сервер.
CI-пакеты с loopback URL предназначены только для проверки.

См. [эксплуатацию](docs/OPERATIONS.md) и [приёмку](docs/ACCEPTANCE.md).
Исходные тексты, промпты и переводы не сохраняются в базе или логах API.
AI-провайдер получает текст; его политика хранения настраивается отдельно.
Квоты считаются в Unicode-символах за календарный месяц UTC. CSV предназначен
для ручных инвойсов, денежную стоимость сервис не рассчитывает.
В v1 результат выдаётся после проверки полного ответа, что увеличивает время
до первого текста, но исключает замену незавершённым переводом.
