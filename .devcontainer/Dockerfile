FROM mcr.microsoft.com/devcontainers/php:8.3

RUN apt-get update && apt-get install -y --no-install-recommends \
    sqlite3 libsqlite3-dev

RUN docker-php-ext-install pdo_sqlite

# Ensure SQLite directories have the right permissions
RUN mkdir -p /workspaces/bytereserve-laravel/database && \
    mkdir -p /workspaces/bytereserve-laravel/storage && \
    chown -R 1000:1000 /workspaces/bytereserve-laravel/database && \
    chown -R 1000:1000 /workspaces/bytereserve-laravel/storage