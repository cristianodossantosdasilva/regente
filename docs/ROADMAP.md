# Roadmap

- [x] **Fase 0** — Descoberta, ADR, roadmap
- [x] **Fase 1** — Núcleo: app abre, canvas pan/zoom, nó Terminal (PTY), salvar/restaurar
- [x] **Fase 2** — Multi-terminal, perfis de agente, estados, zonas, notas, minimapa, backup
- [x] **Fase 3** — Broker, CLI `regente`, conexões por linha, painel de atividade, anti-loop, MCP
- [x] **Fase 4** — Worktrees, busca, paleta, notificações, esboço, diagrama, navegador, tema
- [x] **Fase 5** — Carga de 20 terminais, testes, README, instalador NSIS
- [x] **Validação** — E2E no app nativo + agentes reais (Claude Code, Kiro, AGY); revisões aplicadas (docs/REVIEWS.md)

## Pendências conhecidas
- Assinatura de código por autoridade certificadora: não feita. Os instaladores publicados não são assinados e trazem o SHA-256 (veja [INSTALL.md](INSTALL.md)). `scripts/sign.ps1` é um auxílio **opcional** para assinar localmente com um certificado criado por você.
- Testar o instalador NSIS em mais máquinas (foi instalado e validado em uma máquina Windows 11).
- **Linux e macOS**: backend portado e testado (Ubuntu 24.04; CI no macOS); faltam validar a interface, E2E por WebDriver, instaladores (deb/AppImage/dmg) e a limitação do `read` no bash do macOS. Veja [PORTING.md](PORTING.md).
