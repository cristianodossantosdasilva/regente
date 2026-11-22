# ADR-0001 — Arquitetura do Regente

Status: aceito · Data: 2026-11-22

## Contexto
Clone funcional pessoal de um "canvas infinito de agentes de código". O prompt original assumia macOS/Swift,
mas o ambiente é **Windows 11** sem toolchain Apple. Alvo revisto: Windows (com caminho aberto para macOS/Linux).

## Decisões

| Tema | Decisão | Justificativa |
|---|---|---|
| Shell do app | **Tauri 2** (Rust) | Baixo uso de RAM (requisito), binário pequeno, WebView2 nativo |
| UI | React + TypeScript + Vite | Ecossistema para canvas/terminal |
| Terminal | **xterm.js** (MIT) + addon fit/webgl/web-links | Emulação completa xterm-256color/truecolor |
| PTY | **portable-pty** (MIT) → ConPTY | Resize via ConPTY (equivalente a SIGWINCH) |
| Canvas | Implementação própria (transform CSS pan/zoom) + virtualização | Controle de dormência; sem dependência pesada |
| Broker | Processo embutido no app; **named pipe** `\\.\pipe\regente-broker-<user>`, ACL só do usuário; JSON-RPC 2.0 por linha | Equivalente ao socket Unix 0600 |
| CLI `regente` | Binário Rust (crate `regente-cli`) injetado no PATH dos terminais | `peers`, `send`, `read`, `note`, `ask` |
| MCP | `regente-mcp` (stdio) expondo as mesmas operações | Uso nativo por Claude Code/Kiro |
| Persistência | JSON versionado (`version`), escrita atômica (tmp+rename), debounce, backup rotativo (N=10) | Recuperação após crash |
| i18n | pt-BR padrão, en opcional, arquivos JSON | Substitui `.xcstrings` |
| Dados | `%APPDATA%\Regente`; contexto por workspace em `.regente/` | |

## Orquestração (anti-loop e segurança)
- Agente só enxerga pares **conectados** (grafo dirigido guardado no workspace).
- Mensagens: `{id, from, to, depth, ttl, body}`; descartadas se `depth > 4` ou `ttl` expirado.
- Fila por terminal destino; injeção no PTY somente pelo broker; log append-only (JSONL) auditável.
- "Pausar orquestração" global; confirmação humana opcional por conexão.
- `ask --wait`: o broker marca a mensagem com um token de resposta; o destino responde com `regente reply`.
  Detectar fim de resposta pela saída do PTY é pouco confiável → protocolo explícito de resposta.

## Estado do agente (limitação conhecida)
Heurística por atividade de saída + processo vivo. Não é confiável para "aguardando entrada" em todos os harnesses;
padrões de prompt por perfil são configuráveis. Registrado como risco.

## Riscos
1. ConPTY tem diferenças de comportamento (escape sequences) → testes de integração.
2. Muitos terminais xterm.js → dormência (dispose do renderer fora da tela, buffer em Rust com limite).
3. Instalação de Rust/MSVC necessária no ambiente de build.
4. Sem telemetria; sandbox do Tauri mantido; CSP restrita.

## Restrições legais
Nenhum código, asset ou string do app original é usado; ele não foi inspecionado. Dependências em `THIRD_PARTY.md`.

## Adendo — implementação (2026-11-22)
- **Sincronização de notas**: o texto vive no front; `orch_sync` envia ao broker. Escritas do broker (`note add`) voltam por evento `note-updated`.
- **Resposta de agentes**: `ask --wait` usa protocolo explícito (`regente reply <id>`), não detecção de fim de saída. Resposta tardia é injetada no terminal remetente.
- **Entrega**: texto sanitizado (sem controle/ESC); agentes TUI usam bracketed paste, shells achatam em uma linha; Enter enviado 180 ms depois.
- **Agentes dentro do shell** (`-NoExit -Command`): resolve `.cmd/.ps1`/aliases; o terminal sobrevive ao agente. Estado "encerrado" = shell encerrado.
- **Dormência**: PTY mantém buffer com offsets de bytes; o xterm é recriado com replay sem perdas nem duplicação. Zoom < 30% mostra resumo em texto.
- **Ambiente de build**: o VS instalado na máquina não tinha o workload C++ completo; build local usa `.cargo/config.toml` (LIB→onecore) e um stub de `vswhom-sys`
  (apenas local, não versionado). Ver README.
- **Segurança**: o pipe usa a DACL padrão do usuário + `reject_remote_clients`; a defesa efetiva é o token de sessão (só no ambiente dos terminais).
