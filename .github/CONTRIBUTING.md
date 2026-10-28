# CONTRIBUTING

> First off, thank you for considering contributing to **Anubis Security Tool**.

Anubis Security Tool is an open-source security project built for cybersecurity research, vulnerability analysis, system administration, and intelligent automation. I welcome contributions from the community — whether you're fixing a bug, improving documentation, suggesting a feature, or helping develop the Anubis ecosystem.

Every contribution matters. You don't have to be an experienced developer to help make the project better.

There are many ways to contribute:
- 🐛 Report bugs and unexpected behavior.
- 💡 Suggest improvements and new features.
- 📚 Improve documentation, guides, and examples.
- 🔧 Fix bugs and improve existing functionality.
- 🧩 Contribute to Anubis modules and integrations.
- 🔒 Help improve security, reliability, and cross-platform compatibility.

## Getting Started

Working on your first Pull Request? Here's the basic workflow.

1. **Fork** the repository.
2. **Clone** your fork to your local machine.
3. **Create a branch** for your changes.
4. **Make your changes** and test them locally.
5. **Check the code style** by running `npm run lint`.
6. **Commit your changes** with a clear and descriptive message.
7. **Open a Pull Request** against the main repository and explain what you've changed and why.

### Development Setup

Anubis Core requires **Node.js 24.x** and the project's dependencies.

```bash
git clone https://github.com/Anubis-Security-Tool/anubis.git
cd anubis
npm install --legacy-peer-deps
npm start
```

In a separate terminal, start the application:

```bash
npm run app
```

Before submitting your changes, run the relevant checks:

```bash
npm run lint
npm run test-unit-ci
```

See the development documentation for additional build instructions and testing procedures.

## Pull Request Rules

To keep the project maintainable and make reviews easier, please follow these rules:

- **One PR, one issue.** Each Pull Request should address a single bug, improvement, or agreed feature. Keep unrelated changes in separate PRs.
- **Discuss major changes first.** For new features, UI/UX changes, architectural decisions, or changes to existing behavior, open an issue before submitting a PR. This gives us a chance to discuss the approach before implementation.
- **Keep changes focused.** Avoid unrelated refactoring, formatting changes, or modifications to files that are not necessary for your contribution.
- **Test your changes.** Run the relevant checks and include details about what you tested.
- **Describe your changes clearly.** Explain the problem, your solution, and any relevant limitations or compatibility considerations.
- **Respect the existing architecture.** Follow the project's conventions and avoid breaking existing functionality across supported platforms.
- **Don't include secrets.** Never commit API keys, credentials, private certificates, personal data, or other sensitive information.

Pull Requests that introduce significant design or behavior changes without prior discussion may be asked to be revised or closed.

## Reporting Bugs & Suggesting Features

Found a bug or have an idea for improving Anubis?

- **Bug reports:** [Open an issue](https://github.com/Anubis-Security-Tool/anubis/issues/new).
- **Feature requests:** Open an issue describing the problem, the proposed solution, and why it would be useful.
- **Questions and discussions:** [Join the discussions](https://github.com/Anubis-Security-Tool/anubis/discussions).

Before opening a new issue, please check whether a similar report or discussion already exists.

When reporting a bug, include as much relevant information as possible:
- Operating system and version.
- Anubis version.
- Steps to reproduce the issue.
- Expected behavior and actual behavior.
- Relevant logs or error messages, with sensitive information removed.

## Security Contributions

Security improvements are especially welcome.

If you discover a potential vulnerability, please avoid publishing sensitive exploit details in a public issue before the problem has been assessed. Use the project's designated private security reporting channel, if available.

Contributions should support authorized security testing, defensive research, vulnerability analysis, and responsible disclosure.

## Contributing to the Anubis Ecosystem

Anubis is designed as an evolving ecosystem of open-source security tools and modules. Contributions that improve interoperability, documentation, reliability, and cross-platform support are welcome.

If your contribution targets a separate Anubis module or related repository, submit it to the appropriate repository whenever possible.

## Final Note

Anubis Security Tool grows through the people who use it, test it, report problems, and contribute improvements.

Thank you for helping make Anubis more reliable, capable, and useful for the open-source security community.

**— Anubis Security Tool**
