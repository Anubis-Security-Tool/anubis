# Move Anubis to another computer

This procedure separates the application source/install from user data and machine-bound credentials. Keep the old installation intact until the new computer has been tested.

## Before leaving the old computer

1. Record the Desktop and Web versions, operating system, installation type (Desktop, standalone Web or managed Web), and which connections you need to recreate.
2. In Desktop, open **Settings → Sync** and use the application's export action for the data categories you need. The all-data/configuration export contains sensitive settings; store it in an encrypted, access-controlled location. Use the bookmark toolbar's export action if you need a separate bookmark/group file.
3. If you use Web, first review/disable automatic sync and export any needed sync data from **Settings → Sync**. Then stop its service and make a separate, private backup of the configured `DB_PATH` as described below if you need the full Web profile.
4. Back up SSH keys and certificates through your approved secret-management process. Do not put them in the project clone, issue tracker, Wiki, or an unencrypted transfer archive.
5. Keep the old machine's installation and backup available until the new profile's bookmarks, connections and file workflows have been checked.

## Install on the new computer

### Published Desktop

Install the current OS/architecture package from [Downloads](https://download.anubis.locker), verify its published checksum, then start Anubis once to create a fresh profile.

### Published Web

Install the Web runtime separately, using the current instructions in the [Web repository](https://github.com/Anubis-Security-Tool/anubis-web). The Web server has its own `.env`, database and login credentials. Use the **standalone** option only if you intend to run without the managed gateway; a managed installation also requires fresh enrollment and administrator approval for the new installation.

### Build from source

Use a fresh clone and run the [source-suite bootstrap](SOURCE-INSTALL.md). It recreates pinned component checkouts, dependencies and build output. Do not transfer `node_modules/`, `work/`, `dist/` or the old `.anubis-suite/components/` as a substitute for a fresh source build.

For a source-suite move, export/import Desktop data through the application rather than copying `.anubis-suite/config/local-sync.json` or `.anubis-suite/components/web/.env`. Those files hold sync and Web service credentials; the new computer provisions its own identities. The Web database/uploads and Node Sync records are separate from Desktop data and are not migrated by a Desktop export.

## Web data backup and restore

Web offers two distinct migration paths. **Settings → Sync file export/import** handles the supported sync-data subset; a full standalone Web profile requires a stopped-service file copy. Neither path is part of the Desktop profile.

### Settings → Sync file export/import

The export creates a plaintext `*-electerm-all-data.json` file and can include credentials or other sensitive configuration. It covers bookmarks, bookmark groups, terminal themes, quick commands, profiles, address bookmarks, workspaces, triggers and configuration. It does not include the full SQLite databases, history, logs, uploads or managed-installation identity.

Import replaces the covered collections and configuration rather than merging them, and strips runtime-only fields such as the active Web token and host/port/socket values. The exported sync settings can still retain the previous endpoint, user/token and automatic-sync settings. Disable/review autosync before exporting; on the destination, explicitly configure the intended sync endpoint and credentials and keep autosync disabled until you have reviewed the imported configuration. `ANUBIS_SYNC_*` source-suite variables seed only a fresh database and do not overwrite imported settings. If you need encrypted sync payloads, preserve the explicit sync-encryption password; it is separate from `SERVER_SECRET`.

### Full standalone Web profile copy

This file-level transfer must be done while all Web processes using the profile are stopped:

1. On the old host, review/disable automatic sync in the UI, then stop **all** Web processes using the profile. The packaged CLI defaults to `ANUBIS_WEB_HOME/data` (`ANUBIS_WEB_HOME` defaults to `~/.anubis-web`); source installs use their configured `DB_PATH`.
2. While stopped, make a private backup of the entire resolved `DB_PATH`, including both SQLite databases (`sqlite/electerm.db` and `sqlite/electerm_data.db`), SQLite sidecars, uploads and other profile data. The SQLite adapter stores records as JSON; it is not database-wide encryption, and `SERVER_SECRET` is not a database key. Treat the backup as highly sensitive. `DB_PATH/uploads` is upload staging, not an archive of files moved to caller-chosen destinations; separately migrate any referenced keys/files and reselect their paths on the new host.
3. Exclude `.env`, the managed identity at `DB_PATH/managed-installation.json`, and any custom `ANUBIS_INSTALLATION_FILE` path. `SERVER_PASS` is only the Web login password and `SERVER_SECRET` only signs JWTs, so fresh strong values do not prevent reading a copied database. Old browser tokens will be invalid; sign in again. Never copy controller/session cookies or managed identity to create a second installation.
4. On the new host, prepare the **same Web version** and leave it stopped. For the packaged CLI, `anubis-web --init` creates fresh private settings; for a source checkout, use its documented `scripts/install-source.js` preparation. Restore into an empty private target `DB_PATH`; ensure `DB_TYPE` is unset or `sqlite` for the default SQLite adapter. Do not overwrite an existing profile without first backing it up.
5. Start exactly one Web process against the restored path, sign in with the new `.env` password, review the data and reconfigure sync before enabling it. If managed access is enabled, the new installation identity must be enrolled and fingerprint-approved.
6. Keep the original backup until the restore is verified. This file-level restore is verified for the same-version default SQLite layout; it is not a generic custom-database or old Desktop database migration guarantee.

## Import and verify

1. Import the protected Desktop export through **Settings → Sync**. Import replaces the selected local datasets; read the confirmation and selection carefully. Do not import into the old profile or a profile containing data you have not backed up.
2. Review bookmarks and connection profiles before connecting. Re-enter passwords, API keys and tokens on the new machine. Re-select SSH key/certificate files from their new paths.
3. If profiles were encrypted or protected by the old operating system's keychain/DPAPI, do not assume the old encrypted credential blob is portable. Use the original encryption password where supported; otherwise re-enter the secret. Never disable encryption to force a transfer.
4. For Web, follow [Web data backup and restore](#web-data-backup-and-restore) before starting the service on the new host.
5. For managed access, treat the new computer as a new installation: enroll it and have an administrator verify/approve its new fingerprint. Do not copy the old managed-installation identity or claim that copying a profile transfers approval.
6. Test one authorized connection, a file transfer, and any sync/managed workflow before retiring the old computer.

## What not to copy blindly

- **Do not copy the entire Desktop data directory as the migration method.** An encrypted database or a credential encrypted by the old OS may be unreadable—or unsafe to reuse—on the new system. Prefer the app's export/import flow and re-enter machine-bound secrets.
- **Do not copy `node_modules/`, `work/`, `dist/` or generated `.anubis-suite/components/`.** They are platform/build/source caches, not profile data.
- **Do not copy `.anubis-suite/config/local-sync.json` to a second computer.** It contains the Node Sync JWT secret and user ID. Provision a distinct local service identity on the new computer.
- **Do not copy Web `.env`, managed-installation identity files, MCP tokens or service credentials.** Generate new local credentials, enroll separately, and approve through the administrator workflow.
- **Do not expose an HTTP endpoint or disable TLS/authentication to make a migration work.** A Desktop protocol or Web feature does not bypass the target service's security policy.

## Data locations

Default Desktop data directories (unless the installation has an explicit supported override):

| OS | Default |
| --- | --- |
| Windows | `%APPDATA%\anubis` |
| macOS | `~/Library/Application Support/anubis` |
| Linux | `~/.config/anubis` |

The published Web CLI keeps its private `.env` and default data under `ANUBIS_WEB_HOME` (default `~/.anubis-web`); its default `DB_PATH` is the `data` subdirectory. The SQLite database files are `DB_PATH/sqlite/electerm.db` and `DB_PATH/sqlite/electerm_data.db`; uploads, session/instance logs and custom modules also live beneath `DB_PATH`. Managed installation identity defaults to `DB_PATH/managed-installation.json`; a custom `ANUBIS_INSTALLATION_FILE` can place it elsewhere. Neither identity path is portable. In a source-suite run, the Web `.env` remains in the pinned Web checkout at `.anubis-suite/components/web/.env`, while `DB_PATH` places Web database, uploads and logs under `.anubis-suite/data/web/`. Desktop and Node Sync data use sibling directories there; none of these are the default installed Desktop profile.

Local paths vary with portable, managed-device and administrator-controlled configurations. Inspect the active configuration on the old machine rather than assuming a default path. Keep backups private and retain the original until restore is verified.
