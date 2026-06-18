# Migrating from Paperclip Docker to Paperclip Desktop

This guide covers how to move your existing Paperclip Docker installation to
Paperclip Desktop while keeping all your data (agents, companies, issues, runs).

## Overview

The Paperclip Docker deployment uses a PostgreSQL container initialized on
Linux. Paperclip Desktop uses an embedded PostgreSQL instance initialized on
macOS. While both use the same PostgreSQL version and data format, Linux and
macOS represent the same locale differently:

| Platform | Locale format |
|----------|--------------|
| Linux (Docker) | `en_US.utf8` |
| macOS (Desktop) | `en_US.UTF-8` |

PostgreSQL stores the locale at initialization time and validates it at every
startup. Pointing Desktop directly at a Docker data directory will fail with:

```
FATAL: configuration file "postgresql.conf" contains errors
LOG:  invalid value for parameter "lc_messages": "en_US.utf8"
```

or after that is fixed:

```
PostgresError: database locale is incompatible with operating system
detail: The database was initialized with LC_COLLATE "en_US.utf8",
        which is not recognized by setlocale().
```

The `postgresql.conf` issue is automatically fixed by Paperclip Desktop since
[paperclipai/paperclip#7894](https://github.com/paperclipai/paperclip/pull/7894).
The `LC_COLLATE` issue in the database catalog requires a one-time
`pg_dump` / `pg_restore` migration (described below).

---

## Prerequisites

- Paperclip Desktop installed
- Docker running with your existing Paperclip stack
- `pg_dump` and `pg_restore` available (`brew install libpq`)

---

## Migration steps

### 1. Back up your data

```bash
# Duplicate the Docker postgres data directory as a safety net
cp -r ~/Coding/paperclip/data/postgres \
      ~/Coding/paperclip/data/postgres.bak-$(date +%Y%m%d-%H%M)
```

### 2. Dump your database from Docker

```bash
# Dump in custom format (compressed, supports selective restore)
docker exec paperclip-local-db-1 \
  pg_dump -U paperclip -d paperclip -Fc -f /tmp/paperclip.pgdump

# Copy the dump to your host
docker cp paperclip-local-db-1:/tmp/paperclip.pgdump \
  ~/Coding/paperclip/data/paperclip.pgdump
```

### 3. Stop Docker

```bash
cd ~/Coding/paperclip && docker compose stop
```

### 4. Move the old data directory aside

```bash
mv ~/Coding/paperclip/data/postgres \
   ~/Coding/paperclip/data/postgres.linux-$(date +%Y%m%d-%H%M)
mkdir ~/Coding/paperclip/data/postgres
```

### 5. Configure Paperclip Desktop

Edit `~/.paperclip/instances/default/config.json`:

```json
{
  "database": {
    "mode": "embedded-postgres",
    "embeddedPostgresDataDir": "/Users/<you>/Coding/paperclip/data/postgres",
    "embeddedPostgresPort": 54352
  }
}
```

Add to `~/.paperclip/instances/default/.env`:

```
PAPERCLIP_HOME=/Users/<you>/Coding/paperclip/data/paperclip
```

### 6. Let Desktop initialize the new cluster

Start Paperclip Desktop once. It will initialize a fresh PostgreSQL cluster
with macOS-compatible locales and then fail to find any data — that is expected.
Close Desktop again after it shows the UI (or after seeing "Server listening"
in the log).

```bash
# Confirm the new cluster was initialized
cat ~/Coding/paperclip/data/postgres/PG_VERSION   # should print: 17
```

### 7. Restore your data

```bash
# Start the embedded postgres directly for the restore
PG_BIN="/Applications/Paperclip Desktop.app/Contents/Resources/app-server/server/node_modules/@embedded-postgres/darwin-arm64/native/bin"
DATA="$HOME/Coding/paperclip/data/postgres"

"$PG_BIN/pg_ctl" -D "$DATA" -o "-p 54352" start -w

# Create the database and restore
/opt/homebrew/opt/libpq/bin/createdb \
  -h 127.0.0.1 -p 54352 -U paperclip paperclip

/opt/homebrew/opt/libpq/bin/pg_restore \
  -h 127.0.0.1 -p 54352 -U paperclip -d paperclip \
  --no-owner --no-privileges \
  ~/Coding/paperclip/data/paperclip.pgdump

# Stop postgres — Desktop will manage it from here
"$PG_BIN/pg_ctl" -D "$DATA" stop
```

### 8. Start Paperclip Desktop

All your agents, companies, issues, and runs are now available natively on
macOS — no Docker required.

---

## Keeping Docker available as a fallback

The old data directory is preserved at `postgres.linux-<timestamp>`. If you
need to roll back:

```bash
# Stop Desktop, restore the old directory, restart Docker
mv ~/Coding/paperclip/data/postgres \
   ~/Coding/paperclip/data/postgres.macos-rollback
mv ~/Coding/paperclip/data/postgres.linux-<timestamp> \
   ~/Coding/paperclip/data/postgres
cd ~/Coding/paperclip && docker compose up -d
```

---

## Keeping Docker DB as the backend (alternative)

If you prefer to keep Docker running and just use Desktop as the UI, configure
Desktop to connect to the Docker Postgres directly:

`~/.paperclip/instances/default/config.json`:
```json
{
  "database": {
    "mode": "postgres",
    "connectionString": "postgres://paperclip:<password>@localhost:54352/paperclip"
  }
}
```

`~/.paperclip/instances/default/.env`:
```
DATABASE_URL=postgres://paperclip:<password>@localhost:54352/paperclip
```

In this case Docker DB must be running whenever you use Desktop.
