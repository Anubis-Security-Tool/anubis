# 🛡️ Anubis-Security-Tool

Cross-platform desktop terminal, remote-connection and file-transfer workspace, with separate Web and managed-access distributions.

[Website](https://anubis.locker) · [Downloads](https://download.anubis.locker) · [Canonical Wiki](https://github.com/Anubis-Security-Tool/anubis/wiki) · [Discussions](https://github.com/Anubis-Security-Tool/anubis/discussions)

> **Release versions and source versions are not the same thing.** Check the [published releases](https://github.com/Anubis-Security-Tool/anubis/releases) and verify the checksum for the exact download. A version in a source manifest or a successful source build does not prove that an installer has been released or accepted.

## What is included

| Distribution or capability | What it provides | Separate setup |
| --- | --- | --- |
| **Desktop** | SSH/terminal, SFTP/FTP, Telnet, serial, RDP, VNC, SPICE, connection profiles, files, built-in SSH tunnels, MCP and sync client | Install the Desktop package for your OS, or build this repository |
| **Standalone Web** | A separately versioned Node.js Web server and browser client | Install `anubis-web` separately, or build the Web source with the source-suite command below |
| **Managed access** | Enrollment and approved access through the managed gateway | Requires an administrator-operated service and separate device approval |
| **Themes, resources and sync client** | Pinned runtime/build dependencies included in source installation | No manual plugin-folder copying |
| **MCP and VNC** | Client capabilities included in the applicable distribution | No additional MCP or VNC plugin install |

The application has **no general dynamic plugin marketplace**. The seven PRO menu entries, including Browser Control, are placeholders rather than installable plugins or remote-browser automation.

### Optional back-end projects

The client contains its sync protocol implementation. A sync server is a separate service: the source-suite setup builds a local Node.js server bound to loopback for development. The Cloudflare Worker is an alternative provider requiring your own account, D1 database and explicit deployment; source installation does not deploy it.

SSH tunneling is built into the client. The separate HTTP tunnel server is not required for it. The historical `rdpjs` project is not the Desktop RDP implementation; Desktop RDP uses its current packaged client. Release APIs and the website are independent services, not runtime plugins. See [source installation and component boundaries](docs/SOURCE-INSTALL.md) before setting up optional services.

## Install a published application

### Desktop

Choose the current OS/architecture package from [Downloads](https://download.anubis.locker). Check the release tag and published checksum; do not disable operating-system protection to work around an untrusted or unverifiable package.

### Standalone Web

The Web CLI has its own version and source repository; it is not installed by the Desktop installer. Use the current instructions in the [Web repository](https://github.com/Anubis-Security-Tool/anubis-web). The published package is available from the project registry:

```powershell
npm install --global anubis-web --legacy-peer-deps --registry=https://npm.anubis.locker/
anubis-web --init
anubis-web
```

By default, the Web CLI provisions its private configuration and uses managed enrollment. `--standalone` opts a new configuration out of managed enrollment. Existing `.env` and user data are preserved; initialization does not start the server. Device approval and Web login are separate authentication steps. Do not expose the Web listener to an untrusted network without TLS, authentication and appropriate access controls.

The one-line Web installer installs the **Web distribution only**. It does not install Desktop or deploy the sync, management, Cloudflare or tunnel services.

## Build the Desktop and Web suite from source

Use a fresh checkout, Node.js 24 or newer, Git, npm and the native build prerequisites for Electron, `node-pty` and `serialport` on your OS. The repository's source-suite entry point fetches the pinned companion sources into a dedicated ignored workspace, installs/builds the Desktop and standalone Web sources, and prepares the loopback Node sync service with local-only credentials.

```bash
git clone https://github.com/Anubis-Security-Tool/anubis.git
cd anubis
node scripts/source-suite.js install
```

The default source suite includes Desktop, standalone Web, the source-aligned renderer/resources/access package dependencies and the loopback Node sync server. Optional Cloudflare sync, HTTP tunnel, legacy RDP reference, Go release API and website components must be explicitly selected; Cloudflare deployment always remains a separate operator action.

The command builds application sources; it **does not install an OS package**, publish a release, enroll a device or deploy a public service. Follow [source installation](docs/SOURCE-INSTALL.md) for the exact folder map, local sync setup and platform packaging boundaries. Do not mix artifacts from unrelated source commits.

For iterative UI development rather than the pinned full source suite, use the [development guide](docs/wiki/Development.md).

## Move to another computer

Use the application's data export/import flow and re-enter credentials that depend on the old OS account or keychain. Do not copy an encrypted database or a managed-device identity as if it were portable.

1. On the old computer, create a protected backup and export application data from **Settings → Sync**. The export can include bookmarks, settings and sensitive configuration; protect the file and do not attach it to an issue.
2. Install Desktop/Web on the new computer, import into the intended profile and verify the result before changing or retiring the old setup.
3. Re-enter passwords and tokens, re-check SSH key paths, and enroll/approve the new managed device independently if required.
4. Keep the old profile and backup until connections and files have been verified on the new computer.

The full procedure, portability limits and platform data paths are in the [migration guide](docs/MIGRATION.md).

## Project links

- [Canonical product Wiki](https://github.com/Anubis-Security-Tool/anubis/wiki)
- [Main application](https://github.com/Anubis-Security-Tool/anubis)
- [Web distribution](https://github.com/Anubis-Security-Tool/anubis-web)
- [Brand resources](https://github.com/Anubis-Security-Tool/anubis-resource)
- [Managed access](https://github.com/Anubis-Security-Tool/anubis-managed-access)
- [Issues](https://github.com/Anubis-Security-Tool/anubis/issues)
- [Community and contribution guidance](docs/community/README.md)

## License and attribution

Anubis-Security-Tool is based on electerm. Retain the applicable MIT license, original copyright notices and third-party attributions when modifying or redistributing it. See [LICENSE](LICENSE), [NOTICE](NOTICE) and [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md).
