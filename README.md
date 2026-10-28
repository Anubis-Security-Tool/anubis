# 🛡️ Anubis Security Tool

### Open-Source Security. Intelligent Automation. Total Control.

**Anubis Security Tool** is an open-source, cross-platform workspace for cybersecurity research, remote access, system administration, and security automation.

The project brings together terminal workflows, remote connections, file transfers, configurable network access, and an evolving ecosystem of security tools. Its modular architecture is designed to support developers, security researchers, system administrators, and DevSecOps teams.

<p align="center">
  <a href="https://anubis.locker"><strong>🌐 Official Website</strong></a> ·
  <a href="https://download.anubis.locker"><strong>📦 Downloads</strong></a> ·
  <a href="https://docs.anubis.locker/"><strong>📚 Documentation</strong></a> ·
  <a href="https://github.com/Anubis-Security-Tool/anubis"><strong>💻 Source Code</strong></a>
</p>

---

## 📑 Table of Contents

- [🚀 Quick Start & Installation](#-quick-start--installation)
- [💻 Platform Support](#-platform-support)
- [✨ Features](#-features)
- [🏗️ Architecture & Ecosystem](#️-architecture--ecosystem)
- [🛠️ Build from Source](#️-build-from-source)
- [🧪 Development & Testing](#-development--testing)
- [🔐 Security & Responsible Use](#-security--responsible-use)
- [🤝 Contributing](#-contributing)
- [📜 License](#-license)

---

## 🚀 Quick Start & Installation

### 📦 Ready-to-Use Builds

The current public Desktop release is **v5.7.2**. Select your operating system and architecture on the official download portal.

| OS / Platform | Version | Architecture / Format | Status | Download |
|---|---|---|---|---|
| 💻 **Windows** | `v5.7.2` | Select the available Windows package | 🟢 Public release | [**Download for Windows**](https://download.anubis.locker) |
| 🍎 **macOS** | `v5.7.2` | Select the available macOS package | 🟢 Public release | [**Download for macOS**](https://download.anubis.locker) |
| 🐧 **Linux** | `v5.7.2` | Select the available Linux package | 🟢 Public release | [**Download for Linux**](https://download.anubis.locker) |
| 🧰 **Source Code** | `v5.7.2` | Git repository | 🟢 Available | [**Browse Source Code**](https://github.com/Anubis-Security-Tool/anubis) |

> **Version information:** `v5.7.2` is the public Desktop version documented by the project. The `5.7.3` version in the source manifest refers to a candidate for fixes, not a confirmed public release. Check the [version notes](https://github.com/Anubis-Security-Tool/anubis/blob/main/docs/wiki/Versions.md) before choosing a build.

**Before installing:**

1. Download the package for your operating system and architecture.
2. Verify the published version and the corresponding SHA-256 checksum, when provided.
3. Follow the platform-specific instructions in the [Installation Guide](https://github.com/Anubis-Security-Tool/anubis/blob/main/docs/wiki/Installation.md).
4. Back up important application data before upgrading an existing installation.

**Note:** Desktop, standalone Web, and managed-device Web are separate distributions. Their versions, dependencies, and installation procedures may differ.

### ⚡ First Connection

1. Launch Anubis Security Tool.
2. Create a connection profile using **New bookmark**.
3. Select the required protocol.
4. Enter the address and connection parameters for a system you are authorized to access.
5. Connect and use the terminal, remote session, or file-transfer interface supported by that protocol.

For detailed instructions, see the [Quick Start Guide](https://github.com/Anubis-Security-Tool/anubis/blob/main/docs/wiki/Quick-start.md).

---

## 💻 Platform Support

Anubis is developed for multiple desktop operating systems.

| Platform | Purpose |
|---|---|
| 💻 Windows | Desktop terminal and remote-connection workflows |
| 🍎 macOS | Desktop terminal and remote-connection workflows |
| 🐧 Linux | Desktop terminal and remote-connection workflows |
| 🌐 Web | Separate browser-based distribution |
| 🔗 Managed Access | Controlled access to enrolled and approved devices |

Availability of individual features depends on the platform, package, protocol implementation, and target system configuration.

---

## ✨ Features

### 🖥️ Terminal & Remote Access

- **SSH** — connect to authorized remote systems.
- **SFTP / FTP** — transfer files between supported endpoints.
- **RDP** — remote desktop connectivity.
- **VNC** — remote screen access.
- **SPICE** — supported remote-display workflows.
- **Serial** — connect to supported serial devices.
- **Telnet** — connect to compatible endpoints.
- **Connection profiles** — organize frequently used connections and configuration parameters.
- **Quick commands** — keep commonly used commands available for repetitive tasks.

Protocol availability and behavior depend on the target service and the installed build.

### 📁 File Transfers & Workflow Tools

- Manage supported file-transfer sessions.
- Organize connection bookmarks and groups.
- Reuse connection settings.
- Work with quick commands and repetitive administrative tasks.
- Configure supported proxy and SSH-tunneling workflows.

### 🌐 Web & Managed Access

Anubis has separate components for browser-based workflows and managed-device access.

- **Anubis Web** — a separate Web distribution.
- **Anubis Managed Access** — device enrollment and controlled access workflows.
- **Anubis Resources** — shared branding, icons, and build resources.

These components are maintained separately from the Desktop application. Installing Desktop does not automatically deploy a Web service or enroll a remote device.

### 🧠 AI & Security Ecosystem

Anubis is designed to grow into a modular security ecosystem with AI-assisted workflows and specialized analysis tools.

The project roadmap includes vulnerability intelligence, binary analysis, network infrastructure, and security automation. However, a planned module or visible interface element does not necessarily mean the corresponding functionality is implemented or available in a public release.

See the [Anubis Ecosystem](#️-architecture--ecosystem) section for project components and development status.

---

## 🏗️ Architecture & Ecosystem

Anubis is organized as a collection of related projects rather than a single monolithic application.

| Component | Focus | Repository |
|---|---|---|
| 🛡️ **Anubis Core** | Desktop terminal and remote-access application | [anubis](https://github.com/Anubis-Security-Tool/anubis) |
| 🌐 **Anubis Web** | Browser-based application distribution | [anubis-web](https://github.com/Anubis-Security-Tool/anubis-web) |
| 🔗 **Anubis Managed Access** | Device enrollment and controlled remote access | [anubis-managed-access](https://github.com/Anubis-Security-Tool/anubis-managed-access) |
| 🎨 **Anubis Resources** | Branding, icons, and shared build resources | [anubis-resource](https://github.com/Anubis-Security-Tool/anubis-resource) |
| 🔍 **Anubis Aegis** | CVE scanning and vulnerability intelligence | [Anubis-Aegis-CVE-Scanner](https://github.com/Anubis-Security-Tool/Anubis-Aegis-CVE-Scanner) |
| 🪲 **Anubis Scarab** | Planned DLL scanning and binary analysis | Roadmap |
| 🌐 **Anubis Atlas** | Planned proxy and network infrastructure module | Roadmap |
| 🧠 **Anubis Oracle** | Planned AI-assisted security assessment workflows | Roadmap |
| ⚙️ **Anubis Osiris** | Planned cross-platform system automation | Roadmap |

> **Development status:** The table distinguishes existing repositories from roadmap concepts. Planned modules should not be interpreted as released features. Check each repository and its release notes for current implementation status.

### 🔍 Anubis Aegis — CVE Scanner

[Explore the Anubis Aegis repository](https://github.com/Anubis-Security-Tool/Anubis-Aegis-CVE-Scanner)

A dedicated project for vulnerability intelligence and software-component analysis. Consult its repository for the current implementation, supported inputs, and usage instructions.

---

## 🛠️ Build from Source

This section describes the current source-development workflow for the main Anubis repository. It is intended for developers who want to run the application locally or work on its code.

### 📋 Prerequisites

Install the following before building:

- **Git** — to clone the repository.
- **Node.js 24.x** — the recommended version for the documented development workflow.
- **npm** — included with Node.js.
- A compatible operating system and the additional native build tools required by your target platform.

Some platform-specific packages and native components may require additional dependencies. Review the project documentation before attempting a production or machine-level build.

### 1. Clone the Repository

```bash
git clone https://github.com/Anubis-Security-Tool/anubis.git
cd anubis
```

### 2. Install Dependencies

From the repository root, run:

```bash
npm install --legacy-peer-deps
```

Use the dependency versions and lockfile supplied with the checkout. The installation process also executes the project's configured post-install script.

### 3. Start the Development Process

Run:

```bash
npm start
```

This starts the development process. The documented Vite development server uses port `5570`.

In a **second terminal**, from the same repository directory, run:

```bash
npm run app
```

This launches the application entry point used by the development workflow.

Keep both processes running while developing.

### 4. Run the Linter

To check source-code style, run:

```bash
npm run lint
```

### 5. Build the Application's Source Artifacts

Run:

```bash
npm run b
```

This command executes the project's configured cleanup, compilation, and file-preparation steps:

- `clean` — cleans generated build output.
- `compile` — runs the project's compilation process.
- `prepare-file` — prepares the generated application files.

**Important:** `npm run b` prepares application build artifacts. It does not, by itself, guarantee that a complete platform installer has been produced.

### 6. Prepare Electron Packaging Configuration

Run:

```bash
npm run pb
```

This prepares the root Electron Builder configuration for packaging.

The command is a packaging-preparation step, **not a substitute for the complete platform-specific release process**. Producing a usable installer may require additional resources, native components, platform tooling, and release steps.

### 🔎 Source Build Reference

| Command | Purpose |
|---|---|
| `npm install --legacy-peer-deps` | Install project dependencies |
| `npm start` | Start the development process |
| `npm run app` | Launch the application entry point |
| `npm run lint` | Check source-code style |
| `npm run test-unit-ci` | Run the configured unit/CI tests |
| `npm run b` | Clean, compile, and prepare application files |
| `npm run pb` | Prepare Electron packaging configuration |

For platform-specific build requirements and additional details, consult the [Development Guide](https://github.com/Anubis-Security-Tool/anubis/blob/main/docs/wiki/Development.md).

---

## 🧪 Development & Testing

Anubis includes development and testing scripts for different parts of the application.

### Available Checks

```bash
npm run lint
npm run test-unit-ci
npm run test-integration
```

Additional test commands are defined in `package.json`. Some tests require extra dependencies, a running test environment, or a particular operating system.

For example, the packaged Windows smoke tests have their own prerequisites:

```powershell
npm run test-packaged-windows
```

Run this command only in an appropriate Windows test environment with the required build artifacts and dependencies available.

### ⚠️ Build Success Is Not Release Validation

A successful compilation or test run does not automatically confirm:

- That an installer works on every supported operating system.
- That Windows UAC and service installation behave correctly.
- That the installed GUI and native components are compatible.
- That upgrades and profile migration work in every scenario.
- That a Web deployment is configured securely.
- That all advertised or planned features are available.

Validate the relevant installation and runtime scenarios before distributing a build.

For the complete development workflow, see the [Development Guide](https://github.com/Anubis-Security-Tool/anubis/blob/main/docs/wiki/Development.md).

---

## 🌐 Server Deployment & Configuration

The Web distribution is maintained separately from the Desktop application.

For Web deployment:

1. Visit the [Anubis Web repository](https://github.com/Anubis-Security-Tool/anubis-web).
2. Follow the installation instructions for the exact package version you intend to deploy.
3. Configure authentication and network exposure according to the Web component's documentation.
4. Restrict access to trusted users and networks.
5. Verify the deployment before exposing it to external clients.

Do not assume that Desktop and Web share the same version number, configuration format, or runtime behavior.

For managed-device workflows, consult the [Anubis Managed Access repository](https://github.com/Anubis-Security-Tool/anubis-managed-access).

---

## 🔐 Security & Responsible Use

Anubis is intended for legitimate system administration, defensive security work, and authorized research.

> **Security Notice**
>
> - **Authorization:** Access only systems and devices you own or have explicit permission to administer or test.
> - **Least privilege:** Run the application with the minimum permissions required for the task.
> - **Credentials:** Do not embed passwords, access tokens, or other secrets in URLs, source code, or public configuration files.
> - **Remote exposure:** Do not expose a Web interface or remote-access service to untrusted networks without appropriate authentication and access controls.
> - **Verification:** Download software from official project channels and verify available checksums.
> - **Testing:** Use controlled environments when testing new builds, native components, and administrative features.

Support for a protocol does not guarantee that a target service is secure, correctly configured, or compatible with every Anubis build.

### 🐛 Reporting Security Issues

Please avoid publishing sensitive exploit details, credentials, private keys, or unpatched vulnerability information in public issues.

Use the project's designated private reporting channel when available. For general bugs and feature requests, use [GitHub Issues](https://github.com/Anubis-Security-Tool/anubis/issues).

---

## 🤝 Contributing

Contributions help improve the reliability, compatibility, and usability of the Anubis ecosystem.

You can contribute by:

- ⭐ Starring the repository.
- 🐛 Reporting reproducible bugs.
- 💡 Proposing improvements and new features.
- 🔧 Submitting code changes and tests.
- 📚 Improving documentation.
- 🌐 Helping with cross-platform compatibility.
- 🔐 Reporting security issues responsibly.

Before making substantial changes, review the existing code and documentation, and describe the intended change in an issue or discussion when appropriate.

### 🔗 Community & Project Links

| Resource | Link |
|---|---|
| 🌐 Official Website | [anubis.locker](https://anubis.locker) |
| 📦 Downloads | [download.anubis.locker](https://download.anubis.locker) |
| 📚 Documentation | [docs.anubis.locker](https://docs.anubis.locker/) |
| 💻 Main Repository | [Anubis Security Tool](https://github.com/Anubis-Security-Tool/anubis) |
| 🧩 All Organization Repositories | [Browse Projects](https://github.com/orgs/Anubis-Security-Tool/repositories) |
| 💬 Discussions | [GitHub Discussions](https://github.com/Anubis-Security-Tool/anubis/discussions) |
| 🐛 Bug Reports | [GitHub Issues](https://github.com/Anubis-Security-Tool/anubis/issues) |
| 🛠️ Development Guide | [Development.md](https://github.com/Anubis-Security-Tool/anubis/blob/main/docs/wiki/Development.md) |
| 📥 Installation Guide | [Installation.md](https://github.com/Anubis-Security-Tool/anubis/blob/main/docs/wiki/Installation.md) |
| 📌 Version Notes | [Versions.md](https://github.com/Anubis-Security-Tool/anubis/blob/main/docs/wiki/Versions.md) |

---

## 📜 License

Anubis is based on the **electerm** project. The original copyright notices and applicable MIT license terms are retained.

Review the following files in the repository for licensing and third-party attribution information:

- [`LICENSE`](https://github.com/Anubis-Security-Tool/anubis/blob/main/LICENSE)
- [`NOTICE`](https://github.com/Anubis-Security-Tool/anubis/blob/main/NOTICE)
- [`THIRD-PARTY-LICENSES.md`](https://github.com/Anubis-Security-Tool/anubis/blob/main/THIRD-PARTY-LICENSES.md)

Redistribution and modification must comply with the applicable license terms and notices.

---

<p align="center">
  <strong>🛡️ ANUBIS SECURITY TOOL</strong>
  <br>
  <em>Build smarter. Analyze deeper. Automate securely.</em>
  <br><br>
  Open Source · Security Research · Cross-Platform Engineering
</p>
