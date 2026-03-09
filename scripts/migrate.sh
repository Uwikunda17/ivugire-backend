#!/bin/bash

# Migration script using pg_dump (more reliable for large datasets)
# Make sure PostgreSQL client tools are installed

echo "🔄 Starting migration using pg_dump..."

# Export from local database
echo "📤 Exporting from local database..."
pg_dump -h localhost -U postgres -d ivugire -F c -b -v -f local_backup.dump

if [ $? -ne 0 ]; then
    echo "❌ Failed to export from local database"
    exit 1
fi

echo "✅ Local database exported"

# Get credentials from .env
export PGPASSWORD=$(grep "DATABASE_URL" .env | cut -d'@' -d':' -f2)

echo "📥 Importing to Render database..."
pg_restore -h dpg-d6n6307tskes73e86ivg-a.oregon-postgres.render.com \
  -U ivugiredev \
  -d ivugire \
  --clean \
  --if-exists \
  -v \
  local_backup.dump

if [ $? -eq 0 ]; then
    echo "✅ Migration complete!"
    echo "🗑️  Cleaning up backup file..."
    rm -f local_backup.dump
else
    echo "❌ Migration failed. Backup saved as local_backup.dump"
    exit 1
fi
