# Regente — convenções do projeto

App pessoal e local (Windows) com canvas infinito onde agentes de código (Claude Code, Kiro, AGY…) rodam em
terminais e se comunicam por conexões desenhadas. Clone funcional **com identidade própria**: nunca copiar código,
assets ou strings de apps proprietários. Sem telemetria; sem rede obrigatória.

## Stack
Tauri 2 (Rust) + React/TypeScript/Vite. Terminal: xterm.js + `portable-pty` (ConPTY). Decisões em `docs/ADR-0001-arquitetura.md`.

## Estrutura
- `src/` front-end. `lib/` = lógica pura testável (geometry, agentState, spawn, workspace, md, highlight, ipc, i18n).
  `components/` UI; `components/nodes/` um arquivo por tipo de nó. `actions.ts` = mutações + persistência + polling. `store.ts` = estado global.
- `src-tauri/src/` `pty.rs` (PTY + buffer de replay), `orchestrator.rs` (regras puras: grafo, anti-loop, taxa, pausa),
  `broker.rs` (JSON-RPC por named pipe; injeta no PTY), `persist.rs` (atômico + backups), `sys.rs` (CPU/RAM, git, base64), `ansi.rs`, `lib.rs` (comandos Tauri).
- `cli/` crate `regente-cli`: bins `regente` (CLI) e `regente-mcp` (MCP stdio); lib `regente_client` (cliente do pipe).

## Comandos
```
npm install                 # uma vez
npm test                    # vitest (42 testes)
cargo test --workspace -- --test-threads=1   # Rust (59 testes, incl. e2e do broker com PTY real e carga de 20 terminais)
npx tauri dev               # desenvolvimento
npx tauri build --no-bundle # app em target/release/regente-app.exe
cargo build --release -p regente-cli   # (antes do instalador: `npx tauri build --config src-tauri/tauri.bundle.conf.json` embute estes .exe; `cargo test` e `tauri build --no-bundle` não precisam dele) regente.exe + regente-mcp.exe (ficam ao lado do app → entram no PATH dos terminais)
```
Ver `Makefile` / `scripts/build.ps1`. Se o MSVC local não tiver `lib\x64` (esta máquina só tem `lib\onecore`), veja "Ambiente de build" no README.

## Regras
- Segurança do broker: pipe só local + **token por terminal** (remetente deduzido do token, `from` do cliente é só conferido) injetado só nos terminais do app; injeção no PTY **somente** via broker;
  texto de mensagens é sanitizado (sem caracteres de controle/ESC); anti-loop (profundidade ≤ 4, TTL 10 min), 30 msgs/min por remetente; pausa global; confirmação humana por conexão.
- Agente só enxerga pares conectados (direção importa: `from → to`; `bidirectional` libera os dois sentidos). Notas conectadas são legíveis/graváveis.
- HTML cru em Markdown é descartado; links só http(s)/mailto/relativos. Navegador embutido: só localhost.
- Persistência: JSON com `version` (`SCHEMA_VERSION` em `types.ts`); mudou o formato → atualizar `migrate()` e testes.
- Terminais fora da tela (ou zoom < 30%) são dormentes: xterm destruído, PTY vivo, saída só no buffer (`set_streaming(false)`).
- i18n: toda string de UI em `src/locales/{pt-BR,en}.json` (pt-BR é o padrão).
- Sem placeholders; teste novo para toda regra nova. Nunca logar segredos.

## E2E do app nativo
`e2e/` (puppeteer-core via WebView2 + DevTools). Rode o app com `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` e veja `e2e/README.md`.
Nunca inicie agentes de teste com flags de bypass de permissão (`--trust-all-tools`, `--dangerously-skip-permissions`).
