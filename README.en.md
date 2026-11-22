# Regente

An infinite canvas to orchestrate **coding agents** (Claude Code, Kiro, Antigravity, Codex, Gemini CLI, Copilot CLI, OpenCode…) running in real terminals, with notes, sketches, diagrams, file previews and a local browser, all in a persistent workspace. Agents connected by a line can message each other (`regente ask`) even when they are different tools. 100% local, no telemetry, free and open source (MIT).

> Most of the documentation is currently in **Brazilian Portuguese** (see [README.md](README.md)). Translations are very welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). The UI itself supports English (Settings → Language).

## Platform status
| Platform | Status |
|---|---|
| **Windows 10/11 x64** | ✅ Supported and tested |
| **Linux** | 🚧 **Not supported yet** (the broker uses a Windows named pipe). Port plan: [docs/PORTING.md](docs/PORTING.md) |
| **macOS** | 🚧 **Not supported yet** (same reason) |

## Install (Windows)
Download `Regente_<version>_x64-setup.exe` from the Releases page, verify the published SHA-256, run it (per-user install, no admin needed). Releases are not signed by a certificate authority, so SmartScreen may warn you. Details, portable install and building from source: [docs/INSTALL.md](docs/INSTALL.md) (Portuguese).

## What it does
- **Canvas** with terminals, notes, sketches, diagrams, file previews and a localhost-only browser.
- **Agent profiles** (editable), per-terminal state, CPU/RAM, native notifications, session resume.
- **Orchestration** over directed connections: `regente peers | send | ask --wait | reply | read | status | notify | keys | note …`; a pause switch, optional human confirmation per connection, anti-loop protection and an audit log.
- **MCP server** (`regente-mcp`) exposing the same operations as tools.
- **Coordinator** agents that can recruit/connect/dismiss other agents (max 6, no recursion).
- **Scheduled routines**, **team templates**, git worktree per agent, command palette, global search.

## Security in one paragraph
The broker listens on a local named pipe only. Every terminal gets its **own secret token**; the sender is derived from the token, so an agent cannot impersonate another terminal. Messages are sanitized, imported workspaces are treated as untrusted, and the global pause overrides everything. Regente is **not a sandbox**: agents run with your user's permissions. See [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) and [SECURITY.md](SECURITY.md).

## Contributing
We want your help, especially with the **Linux/macOS port** and English documentation. Read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Please note the clean-room rule: no code, assets or strings from other products.

## License
MIT. Third-party dependencies (all permissive) are listed in [THIRD_PARTY.md](THIRD_PARTY.md). Not affiliated with any agent vendor; product names belong to their owners.
