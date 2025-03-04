FROM mcr.microsoft.com/devcontainers/php:8.3

RUN apt-get update && apt-get install -y --no-install-recommends \
    sqlite3 libsqlite3-dev

RUN docker-php-ext-install pdo_sqlite
