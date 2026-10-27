# 🛡️ Anubis-Security-Tool

Cross-platform desktop terminal, remote-connection and file-transfer workspace, with separate Web and managed-access distributions.

[Website](https://anubis.locker) · [Downloads](https://download.anubis.locker) · [Source setup](docs/SOURCE-INSTALL.md) · [Issues](https://github.com/Anubis-Security-Tool/anubis/issues)

> **Published artifacts:** check the [latest Desktop release](https://github.com/Anubis-Security-Tool/anubis/releases/latest) and the [latest Web package metadata](https://npm.anubis.locker/anubis-web/latest) when choosing a version. Verify the checksum published for the exact Desktop download. A source version, source pin or successful build does not prove that an installer or Web package has been published, installed or accepted.

## What is included

| Distribution or capability | What it provides | Separate setup |
| --- | --- | --- |
| **Desktop** | SSH/terminal, SFTP/FTP, Telnet, serial, RDP, VNC, SPICE, connection profiles, files, built-in SSH tunnels, MCP and sync client; Desktop artifacts also include the browser frontend for managed Web | Install the Desktop package for your OS, or build this repository |
| **Windows machine host** | Windows NSIS package includes `AnubisHost`, which can serve the managed Web workspace | Managed link access requires the gateway, an enrolled and approved device, profile/Web authentication, and the relevant Desktop/Host process running |
| **Standalone Web** | A separately versioned Node.js Web server and browser client | Install `anubis-web` separately, or build the Web source with the source-suite command below |
| **Managed access** | Enrollment and approved access through the managed gateway | Requires an administrator-operated service and separate device approval |
| **Themes, resources and sync client** | Pinned runtime/build dependencies included in source installation | No manual plugin-folder copying |
| **MCP and VNC** | Client capabilities included in the applicable distribution | No additional MCP or VNC plugin install |

The bundled browser frontend and Windows machine-host capability are distinct from the **standalone Web CLI**: the Desktop OS installer does not install or start the separately versioned Node.js Web server. Managed Web link access is available only through the configured gateway after enrollment, device approval and profile/Web authentication, while the applicable Desktop or `AnubisHost` process is running. Do not infer that other operating-system installers provide a machine service.

The application has **no general dynamic plugin marketplace**. The seven PRO menu entries, including Browser Control, are placeholders rather than installable plugins or remote-browser automation.

### Optional back-end projects

The client contains its sync protocol implementation. A sync server is a separate service: the source-suite setup builds a local Node.js server bound to loopback for development. The Cloudflare Worker is an alternative provider requiring your own account, D1 database and explicit deployment; source installation does not deploy it.

SSH tunneling is built into the client. The separate HTTP tunnel server is not required for it. The historical `rdpjs` project is not the Desktop RDP implementation; Desktop RDP uses its current packaged client. The [anubis-site publisher](https://github.com/Anubis-Security-Tool/anubis-site) is an independent distribution service, not a runtime plugin. See [source installation and component boundaries](docs/SOURCE-INSTALL.md) before setting up optional services.

## Install a published application

### Desktop

Choose the current OS/architecture package from [Downloads](https://download.anubis.locker). Check the release tag and published checksum; do not disable operating-system protection to work around an untrusted or unverifiable package.

### Standalone Web

The Web CLI has its own version and source repository; it is not installed by the Desktop installer. Check the [registry's latest package metadata](https://npm.anubis.locker/anubis-web/latest) before installation. `@latest` follows the published npm dist-tag and is not a reproducible version pin.

```bash
npm install --global anubis-web@latest --legacy-peer-deps --registry=https://npm.anubis.locker/
anubis-web --init
anubis-web
```

By default, the Web CLI provisions its private configuration and uses managed enrollment. `anubis-web --standalone` opts a new configuration out of managed enrollment. Existing `.env` and user data are preserved; `--init` initializes configuration but does not start the server. Device approval and Web login are separate authentication steps. Do not expose the Web listener to an untrusted network without TLS, authentication and appropriate access controls. See the [Web repository](https://github.com/Anubis-Security-Tool/anubis-web) for its source and current setup notes.

The one-line Web installer installs the **Web distribution only**. It does not install Desktop or deploy the sync, management, Cloudflare or tunnel services.

## Build the Desktop and Web suite from source

Use a fresh checkout, Node.js 24 or newer, Git, npm and the native build prerequisites for Electron, `node-pty` and `serialport` on your OS. The source-suite entry point fetches pinned companion sources into a dedicated ignored workspace, builds Desktop and standalone Web, and prepares the loopback Node sync service with local-only credentials.

```bash
git clone https://github.com/Anubis-Security-Tool/anubis.git
cd anubis
node scripts/source-suite.js install
```

The intended default source suite includes Desktop, standalone Web, source-aligned renderer/resources/managed-access SDK dependencies and the loopback Node sync server. Optional site publisher, Cloudflare sync, HTTP tunnel and legacy RDP reference components must be explicitly selected; Cloudflare deployment always remains a separate operator action. The unlicensed legacy Go release API is not included.

The command builds application sources; it **does not install an OS package**, publish a release, enroll a device or deploy a public service. Follow [source installation](docs/SOURCE-INSTALL.md) for the exact folder map, local sync setup and platform packaging boundaries. Do not mix artifacts from unrelated source commits.

The full procedure is in [source installation](docs/SOURCE-INSTALL.md); read the [migration guide](docs/MIGRATION.md) before moving an existing profile.

## Move to another computer

Use the Desktop data export/import flow and re-enter credentials that depend on the old OS account or keychain. Web data has a separate, stopped-service file-backup procedure. Do not assume Desktop encrypted secrets or a managed-device identity are portable.

1. On the old computer, create a protected Desktop backup and export application data from **Settings → Sync**. The export can include bookmarks, settings and sensitive configuration; protect the file and do not attach it to an issue.
2. Install Desktop on the new computer, import into the intended profile and verify the result before changing or retiring the old setup.
3. If retaining Web data, first distinguish standalone Web from Windows machine-managed Web in SYSTEM. Use **Settings → Sync** file export/import for its supported data subset, from the Web workspace that actually owns the data. The stopped-service `DB_PATH` copy applies only to standalone Web; never copy the Windows SYSTEM profile to a new PC. See [Web data backup and restore](docs/MIGRATION.md#web-data-backup-and-restore).
4. Re-enter passwords and tokens, re-check SSH key paths, and enroll/approve the new managed device independently if required.
5. Keep the old profile and backup until connections and files have been verified on the new computer.

The full procedure, portability limits and platform data paths are in the [migration guide](docs/MIGRATION.md).

## Project links

- [Source installation](docs/SOURCE-INSTALL.md)
- [Migration guide](docs/MIGRATION.md)
- [Main application](https://github.com/Anubis-Security-Tool/anubis)
- [Web distribution](https://github.com/Anubis-Security-Tool/anubis-web)
- [Brand resources](https://github.com/Anubis-Security-Tool/anubis-resource)
- [Managed access](https://github.com/Anubis-Security-Tool/anubis-managed-access)
- [Website publisher source](https://github.com/Anubis-Security-Tool/anubis-site)
- [Issues](https://github.com/Anubis-Security-Tool/anubis/issues)

## License and attribution

Anubis-Security-Tool is based on electerm. Retain the applicable MIT license, original copyright notices and third-party attributions when modifying or redistributing it. See [LICENSE](LICENSE), [NOTICE](NOTICE) and [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md).
