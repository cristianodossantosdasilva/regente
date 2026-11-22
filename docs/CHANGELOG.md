# Changelog

## Não lançado
- **Linux**: E2E de interface por WebDriver (`e2e/run-linux.sh`, 13 verificações). Corrige o shell padrão no Unix (usava o `pwsh.exe` do Windows no WSL; agora `$SHELL`).
- **Linux e macOS (experimental)**: broker por socket Unix, encerramento de grupos de processos, pré-execução por `sh`, pasta de dados por plataforma. Backend testado no Ubuntu 24.04 (56 testes de Rust) e no CI do macOS; interface ainda não validada.
- Release: `scripts/release.ps1` remove caminhos pessoais dos binários; `tauri.bundle.conf.json` separa os recursos do instalador (`cargo test` funciona em cópia nova).
- `regente peers` com identidade e estado; `status`, `notify`, `debug`, `keys` (permissão por conexão); notas por faixa/`edit`/`write`; `ask --batch`.
- Coordenador: `recruit`/`connect`/`dismiss` por CLI e MCP (máx. 6 recrutados, sem recursão, pausa e auditoria).
- Rotinas agendadas (interface + disparo seguro pelo broker, pré-execução e lembretes).
- Correção: `allowKeys` e `coordinator` eram perdidos ao reabrir o workspace; agora são persistidos e testados.
- Templates de equipe e papel por agente.
- Segurança (2ª revisão do Kiro): `keys` recusado em conexões que exigem confirmação e só no sentido da conexão; pausa reconferida após confirmação, em `reply`, depois do pré-run e no coordenador; reserva de vagas e limite de taxa para recrutar/conectar/dispensar; pedidos expiram; `recruit` só por id/nome exato de perfil e `cwd` dentro do workspace; importação endurecida; pré-execução nunca trava e preserva acentos; mensagens/notas/linhas com teto; rótulos e status sem bidi/zero-width.
- Segurança (revisão do Kiro): token **por terminal**; o remetente é deduzido do token e tentativas de se passar por outro terminal são negadas e auditadas.
- Repositório preparado para ser público: licença MIT, aviso legal, `THIRD_PARTY.md` auditado.

## 0.1.0 — 2026-11-22 (Fases 0–5, execução autônoma)

### Fase 0 — Descoberta
- Ambiente real: Windows 11 (sem Swift/Xcode) → alvo trocado de macOS/Swift para **Windows/Tauri+React** (ADR-0001).

### Fase 1 — Núcleo
- App Tauri; canvas com pan/zoom/zoom-to-fit; nó Terminal (xterm.js + ConPTY via `portable-pty`); salvar/restaurar.

### Fase 2 — Multi-terminal e agentes
- Perfis de agente editáveis (JSON) com detecção no PATH; estado do agente por heurística; zonas, notas Markdown, minimapa; backup rotativo + recuperação.

### Fase 3 — Orquestração
- Broker (named pipe, JSON-RPC, token de sessão), CLI `regente`, servidor MCP `regente-mcp`, conexões por arraste, painel de atividade,
  anti-loop (profundidade/TTL/taxa), pausa global, confirmação humana opcional, sanitização de texto injetado.

### Fase 4 — Extras
- git branch/dirty no cabeçalho, git worktree por agente, busca global (nós, notas, saída de terminais), paleta Ctrl+K, notificações nativas,
  esboço, diagrama, preview de arquivo, navegador localhost, tema claro/escuro, i18n pt-BR/en, espelhamento de notas em `.regente/`.

### Validação e revisões (execução autônoma)
- E2E no app nativo via DevTools Protocol (`e2e/`): 21 + 16 + 3 + 2 verificações; agentes reais Claude Code → Kiro e → AGY pelo próprio canvas.
- Correções vindas do Kiro (anti-loop, confirmação, entradas vazias, overflow) e do AGY (zoom, rótulos de conexão, injeção como comentário em shells).
- Correções vindas dos E2E: nó novo fora da tela, seletor de perfil, renomear, sobreposição de nós.
- Log de auditoria JSONL em `%APPDATA%\Regente\logs`. Instalador NSIS (com CLI e MCP).

### Fase 5 — Polimento
- Dormência de terminais (xterm destruído fora da tela/zoom<30%; buffer limitado), alerta de RAM por terminal.
- Testes: 29 (vitest) + 37 (Rust, incluindo e2e do broker com PTY real e carga de 20 terminais: 0,4 s para subir, ~216 MB agregados no teste com `cmd.exe`).
- Build de release `regente-app.exe` (4 MB) + `regente.exe` + `regente-mcp.exe`.
