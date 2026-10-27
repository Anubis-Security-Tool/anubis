# Move Anubis to another computer

This procedure separates the application source/install from user data and machine-bound credentials. Keep the old installation intact until the new computer has been tested.

## Before leaving the old computer

1. Record the Desktop and Web versions, operating system, installation type (Desktop, standalone Web or managed Web), and which connections you need to recreate.
2. In Desktop, open **Settings → Sync** and use the application's export action for the data categories you need. The all-data/configuration export contains sensitive settings; store it in an encrypted, access-controlled location. Use the bookmark toolbar's export action if you need a separate bookmark/group file.
3. If you use Web, make a separate protected backup of its data directory and document its non-secret settings. Web data is not part of the Desktop profile.
4. Back up SSH keys and certificates through your approved secret-management process. Do not put them in the project clone, issue tracker, Wiki, or an unencrypted transfer archive.
5. Keep the old machine's installation and backup available until the new profile's bookmarks, connections and file workflows have been checked.

## Install on the new computer

### Published Desktop

Install the current OS/architecture package from [Downloads](https://download.anubis.locker), verify its published checksum, then start Anubis once to create a fresh profile.

### Published Web

Install the Web runtime separately, using the current instructions in the [Web repository](https://github.com/Anubis-Security-Tool/anubis-web). The Web server has its own `.env`, database and login credentials. Use the **standalone** option only if you intend to run without the managed gateway; a managed installation also requires fresh enrollment and administrator approval for the new installation.

### Build from source

Use a fresh clone and run the [source-suite bootstrap](SOURCE-INSTALL.md). It recreates pinned component checkouts, dependencies and build output. Do not transfer `node_modules/`, `work/`, `dist/` or the old `.anubis-suite/components/` as a substitute for a fresh source build.

For a source-suite move, export/import Desktop data through the application rather than copying `.anubis-suite/config/local-sync.json` or `.anubis-suite/components/web/.env`. Those files hold sync and Web service credentials; the new computer provisions its own identities. The Web database/uploads and Node Sync records are separate from Desktop data and are not migrated by a Desktop export. Use the Web component's documented backup/restore procedure if its data must be retained, and never pair old encrypted Sync records with regenerated credentials.

## Import and verify

1. Import the protected Desktop export through **Settings → Sync**. Import replaces the selected local datasets; read the confirmation and selection carefully. Do not import into the old profile or a profile containing data you have not backed up.
2. Review bookmarks and connection profiles before connecting. Re-enter passwords, API keys and tokens on the new machine. Re-select SSH key/certificate files from their new paths.
3. If profiles were encrypted or protected by the old operating system's keychain/DPAPI, do not assume the old encrypted credential blob is portable. Use the original encryption password where supported; otherwise re-enter the secret. Never disable encryption to force a transfer.
4. For Web, restore only data using the Web component's documented backup/restore procedure and into its separate Web data path. Do not replace its `.env` with the old file: it contains server login and installation secrets. A fresh install should generate fresh credentials.
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

The published Web CLI keeps its private `.env` and default data under `ANUBIS_WEB_HOME` (default `~/.anubis-web`). In a source-suite run, the Web `.env` remains in the pinned Web checkout at `.anubis-suite/components/web/.env`, while `DB_PATH` places Web database, uploads and logs under `.anubis-suite/data/web/`. Desktop and Node Sync data use sibling directories there; none of these are the default installed Desktop profile.

Local paths vary with portable, managed-device and administrator-controlled configurations. Inspect the active configuration on the old machine rather than assuming a default path. Keep backups private and retain the original until restore is verified.
