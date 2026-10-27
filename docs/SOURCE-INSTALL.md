# Build and run the source suite

This guide covers a fresh, local development installation of the Desktop application, standalone Web runtime and loopback Node sync service. It does not publish packages, make an OS installer, enroll a managed device, deploy a public service or change the settings of an existing installed profile.

## Requirements

- Node.js 24 or newer, npm and Git.
- Windows source builds need Visual Studio 2022 Build Tools with the C++ desktop workload and Windows SDK, plus Python 3.11 x64 for native Node modules. The active Windows CI uses Windows Server 2022.
- macOS source builds need Xcode Command Line Tools, Python 3.11 and `setuptools` for native modules. The active CI builds x64 and arm64 on macOS 15.
- Linux source builds need a C/C++ compiler, `make`, Python 3 and `pkg-config`; on Debian/Ubuntu these are provided by `build-essential`, `python3` and `pkg-config`. The active Linux CI target is Ubuntu 24.04.
- Windows artifact packaging uses Go for the native Windows host; the tracked workflows pin Go 1.27.3 (the source compatibility minimum is 1.26). It is not required for the ordinary source-suite run.
- Network access to the pinned Git sources and the Anubis npm registry at `https://npm.anubis.locker/`.

Use a new clone for the suite. The source pins are recorded in [`source-suite-pins.json`](../scripts/source-suite-pins.json); the bootstrap rejects missing or non-immutable pins rather than substituting a branch, a sibling checkout or an unverified registry package.

## Install

From the repository root:

```bash
git clone https://github.com/Anubis-Security-Tool/anubis.git
cd anubis
node scripts/source-suite.js install
```

The default command fetches the pinned Web, resource, managed-access SDK and Node Sync sources, builds a renderer package from this exact Desktop checkout, builds the standalone Web runtime with the matching renderer/SDK/resource packages, prepares the local sync server, then builds Desktop. A dependency, version, checksum, clone or build failure stops the sequence with a non-zero exit; the script does not silently fall back to a manually supplied checkout or an older published renderer.

The optional `--workspace <path>` selects the generated workspace (default: `.anubis-suite` under the clone). Use a custom location outside the clone, or add its location to your local ignore rules. Optional source components are selected only with `--with <name>`:

| Option | Preparation only | What it does not do |
| --- | --- | --- |
| `cloudflare-sync` | Fetches and installs the Worker/D1 source and dependencies | Does not create a Cloudflare account/database or deploy |
| `http-tunnel` | Fetches and installs the separate HTTP tunnel service | Does not start or expose it; GPL-3.0 source and notices remain applicable |
| `rdpjs` | Fetches the historical RDP reference source | Does not install a Desktop plugin or replace the active RDP client |
| `site` | Fetches the immutable [`anubis-site`](https://github.com/Anubis-Security-Tool/anubis-site) publisher source and runs its dependency-free tests | Does not ingest a release, build deployment output, publish a website or accept a release |

For example, `node scripts/source-suite.js install --with cloudflare-sync` prepares the optional Worker source only. The unlicensed legacy Go release API is not included or redistributed; the site's Node release ingester is a separate implementation.

## Generated files and data

| Path | Purpose | Safe to delete or copy? |
| --- | --- | --- |
| `src/app/`, `src/client/`, `src/build/`, `src/test/`, `native/`, `res/`, `docs/`, `scripts/`, `.github/` | Tracked application, build, platform, test and documentation source | Do not remove as a cleanup step |
| `node_modules/` | Re-creatable npm dependencies | Recreate with the bootstrap; do not copy between operating systems |
| `work/`, `dist/` | Build and packaging output produced by the App build scripts | Re-create; these are not user data or a finished release |
| `.anubis-suite/components/` | Exact-pinned companion source checkouts; the Web checkout also contains its private `.env` | Re-create from the pin file; keep local edits in a separate clone. The Web checkout is access-restricted because `.env` contains server secrets. |
| `.anubis-suite/config/` | Generated local-sync credentials | **Sensitive. Do not commit, publish, or copy to another computer.** |
| `.anubis-suite/output/` | Local renderer, SDK, resource and browser-asset package tarballs | Re-create; not a release artifact |
| `.anubis-suite/data/desktop/` | Isolated source-run Desktop profile, database and per-install secrets | User data; back up only with the migration guidance |
| `.anubis-suite/data/web/` | Isolated Web database, settings, uploads and logs | User data; protect as sensitive |
| `.anubis-suite/data/sync/` | Local Node Sync's JSON records | User data; protect as sensitive |

The repository ignores `.anubis-suite/`. The bootstrap never removes or replaces an existing workspace. An existing component checkout is reused only when its canonical remote, pinned commit and clean state match; otherwise installation stops and tells you to use a fresh workspace. Preserve Web `.env` files and all existing data. The Web installer creates a private `.env` only when none exists; standalone mode affects a new configuration and does not convert an existing managed setup.

On POSIX systems the suite config/data directories and Web checkout are owner-only. On Windows, the bootstrap restricts the suite's private directories, Web checkout and `.env` to the current account; keep the workspace under a per-user directory with appropriate NTFS permissions as well.

## Run the local suite

After installation:

```bash
node scripts/source-suite.js run
```

The runner starts Node Sync on `127.0.0.1:7101`, verifies it with an authenticated, non-writing protocol check, then launches the built Desktop app and standalone Web runtime. Web runs with managed enrollment disabled in that child process; no public gateway is contacted. `Ctrl+C` stops the processes started by the runner. Use `--desktop-only` or `--web-only` to run a single client; the local sync service still starts for either mode.

The suite generates a unique JWT secret and user ID once in `.anubis-suite/config/local-sync.json`. It passes that private configuration only to the loopback Node server and to the two client processes. Desktop receives admin-locked custom-sync settings; Web seeds the same custom-sync values only when its fresh SQLite profile is first created. Existing Web databases/configuration are not reseeded. The clients use the normal custom-sync protocol and `/api/sync` endpoint; the local service is not a fabricated plugin. The app and Web data paths are isolated beneath `.anubis-suite/data/`, not the normal installed profile locations.

The secret is also stored in the clients' local settings, so protect the entire workspace. Do not put it in a shell command, issue, screenshot, public `.env`, shared backup or production deployment. If the private sync config is lost, stop the local service and set up a new secret/user ID; do not regenerate credentials while retaining data and imply the old credentials still work.

## Component boundaries

- **Desktop** is built by this repository's `npm run b` pipeline. Its bundled SSH, SFTP/FTP, Telnet, serial, RDP, VNC, SPICE, SSH tunnels, MCP and sync client are integrated dependencies, not dynamically loaded plugins.
- **Standalone Web** is a separately versioned Node.js runtime. The source bootstrap passes locally packed, version-checked renderer, managed-access SDK and resource tarballs to the Web source installer; the installer builds and validates the server/assets but does not start it.
- **Managed access** requires an independently operated gateway and explicit administrator approval. Installing the client SDK is not gateway deployment, device enrollment or approval.
- **Local Node Sync** is for private development on loopback. A remote operator needs a separately secured deployment, HTTPS, authentication and an explicit network policy. Never bind this development service to all network interfaces.
- **Cloudflare Sync** is a separate provider requiring the operator's own Cloudflare account and D1 setup. The source bootstrap does not deploy it.
- **Built-in SSH tunnels** are not the separate GPL-3.0 HTTP tunnel server. The historic GPL-3.0 `rdpjs` project is not the active Desktop RDP implementation.
- **Browser Control** and six other PRO menu entries are placeholders, not remote Chrome automation or installable extensions.
- An App build or Web build is not an OS installer, release, deployed Web service or proof of a functioning remote target. Packaging and live acceptance are separate steps.

## Build OS packages separately

`node scripts/source-suite.js install` and `run` build and launch source runtimes; they do not produce or install an OS package. Artifact builds use the release-input preparation in [`.github/actions/release-inputs`](../.github/actions/release-inputs/action.yml), then the exact shared CI steps `npm ci --legacy-peer-deps`, `node src/build/bin/release-source-inputs.js build`, and `npm run pb`. Do not replace the pinned `.release-inputs` checkouts with arbitrary branches or add `npx`/electron-builder flags not present in the tracked workflows.

The tracked jobs prepare the checked-out source with:

```bash
npm config set legacy-peer-deps true
npm install -g yarn
npm ci --legacy-peer-deps
node src/build/bin/release-source-inputs.js build
npm run pb
```

The Windows jobs also run `npm install -g node-gyp` and provision Python 3.11 x64 and Go 1.27.3. The macOS jobs install `setuptools` with `pip install setuptools`. These are CI preparation commands, not part of the source-suite `install` command.

The workflows then invoke these platform builders:

| Artifact | Exact builder command and workflow |
| --- | --- |
| Windows x64 NSIS installer | `node src/build/bin/build-win-nsis` ([win-nsis](../.github/workflows/win-nsis.yml)) |
| Windows portable archive | `node src/build/bin/build-win-portable` ([win-portable](../.github/workflows/win-portable.yml)) |
| Windows tar archive | `node src/build/bin/build-win-tar` ([win-tar](../.github/workflows/win-tar.yml)) |
| Linux x64 `.deb`, `.tar.gz`, AppImage | `node src/build/bin/build-linux-deb-tar` ([linux-deb-tar](../.github/workflows/linux-deb-tar.yml)) |
| macOS x64 `.dmg` | `node src/build/bin/build-mac` ([mac](../.github/workflows/mac.yml)) |
| macOS arm64 `.dmg` | `node src/build/bin/build-mac-arm` ([mac-arm](../.github/workflows/mac-arm.yml)) |

The tracked jobs set their build environment and signing/notarization inputs; do not copy credentials into commands or documentation. The Windows NSIS output is a machine installer; portable/archive outputs do not install the machine service. Packaging creates artifacts only—it does not install them, publish a release or prove live acceptance.

For ordinary development commands and tests, see [Development](wiki/Development.md). For new-PC transfer, see [Migration](MIGRATION.md).
