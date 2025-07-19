#!/bin/bash
# filepath: /workspaces/bytereserve-laravel/fix-sqlite-permissions.sh

# Create database directory if it doesn't exist
mkdir -p /workspaces/bytereserve-laravel/database

# Set proper ownership
chown -R vscode:vscode /workspaces/bytereserve-laravel/database

# Set proper permissions for SQLite database files
chmod -R 755 /workspaces/bytereserve-laravel/database
touch /workspaces/bytereserve-laravel/database/database.sqlite
chmod 664 /workspaces/bytereserve-laravel/database/database.sqlite

# Set proper permissions for the storage directory
chmod -R 775 /workspaces/bytereserve-laravel/storage
chown -R vscode:vscode /workspaces/bytereserve-laravel/storage

echo "SQLite database permissions fixed."