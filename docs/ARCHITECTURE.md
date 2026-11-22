# Arquitetura

Visão geral para quem vai ler ou alterar o código. As decisões originais estão em [ADR-0001](ADR-0001-arquitetura.md). O protocolo do broker está em [BROKER_PROTOCOL.md](BROKER_PROTOCOL.md) e o modelo de segurança em [SECURITY_MODEL.md](SECURITY_MODEL.md).

## Stack
| Camada | Tecnologia | Por quê |
|---|---|---|
| Shell nativo | **Tauri 2** (Rust) | Binário pequeno (~4 MB), usa o WebView do sistema (WebView2 no Windows), sem embutir um navegador |
| Interface | **React 18 + TypeScript + Vite** | Canvas com muitos nós interativos |
| Terminal | **xterm.js** (renderizador DOM) + **`portable-pty`** (ConPTY no Windows) | Terminal real, com truecolor e links |
| Comunicação entre agentes | **Broker** em Rust, JSON por linha sobre **named pipe** | Local, sem rede, com identidade por terminal |
| CLI e MCP | Crate Rust `regente-cli` (`regente`, `regente-mcp`) | Cliente do broker usado por humanos e por agentes |
| Testes | vitest + jsdom, `cargo test`, E2E por DevTools Protocol (puppeteer-core) | Veja [TESTING.md](TESTING.md) |

## Estrutura do repositório
```
Cargo.toml                 workspace Rust: src-tauri e cli
src-tauri/                 aplicativo (crate regente-app, lib regente_lib)
  src/lib.rs               comandos Tauri (pty_*, ws_*, orch_*, routine_fire, coord_answer…) e ciclo de vida
  src/pty.rs               PtyManager: sessões ConPTY, anel de bytes com offsets, dormência, kill de árvore
  src/orchestrator.rs      regras PURAS: grafo, direção, anti-loop, taxa, pausa, coordenador, status
  src/broker.rs            servidor do named pipe, autorização, injeção no PTY, rotinas, pré-execução
  src/state.rs             AppState compartilhado (PTYs, orquestrador, pendências, tokens por terminal)
  src/persist.rs           escrita atômica, backups rotativos e recuperação
  src/sys.rs               CPU/RAM (sysinfo), git, detecção de comandos no PATH, shell padrão
  src/ansi.rs              remoção de sequências ANSI (para `read` e busca)
  tests/                   integração: broker com PTY real, 20 terminais
cli/                       crate regente-cli
  src/lib.rs               cliente do pipe (call, Env, format_peers)
  src/main.rs              binário `regente`
  src/bin/mcp.rs           binário `regente-mcp` (MCP por stdio)
src/                       interface React
  types.ts                 tipos do domínio (Workspace, nós, Edge, Routine, TeamTemplate…)
  store.ts                 estado global (useSyncExternalStore) e UI
  actions.ts               mutações do workspace, persistência contínua, polling, coordenador, rotinas, templates
  lib/                     lógica pura e testável (geometry, agentState, spawn, workspace, routines, templates, md, highlight, i18n, ipc)
  components/              Canvas, NodeFrame, Sidebar, Minimap, Modals, RoutinesModal, TemplatesModal
  components/nodes/        um arquivo por tipo de nó
  locales/                 pt-BR.json e en.json (toda string de UI)
e2e/                       roteiros E2E contra o app real
scripts/                   build.ps1 (Windows), sign.ps1 (assinatura local)
docs/                      documentação
```

## Fluxos principais

### 1. Terminal
```
TerminalNode (React) ──pty_spawn──▶ lib.rs ──▶ PtyManager.spawn (ConPTY)
                                      │  injeta env: REGENTE_PIPE, REGENTE_TOKEN (por terminal), REGENTE_TERMINAL, PATH com o CLI
PTY ──bytes──▶ anel (1 MiB, offsets start/end) ──evento "pty-output"──▶ xterm.js
teclado ──pty_write──▶ PTY          (digitar também zera a cadeia anti-loop do terminal)
```
- O anel guarda os bytes recentes com *offsets* absolutos. Quando o xterm é recriado (dormência), o front pede um *snapshot* e continua do offset certo, sem perder nem duplicar saída.
- **Dormência**: nó fora da tela ou com zoom < 30 % destrói o xterm e chama `set_streaming(false)`; o PTY segue vivo e a saída só vai para o anel.
- O **estado do agente** (trabalhando / aguardando / ocioso / erro / encerrado) é calculado no front (`lib/agentState.ts`) a partir de atividade recente, padrões do perfil e do processo.
- Ao fechar o app, `RunEvent::Exit` mata a árvore de processos de cada PTY (`taskkill /T /F`).

### 2. Mensagem entre agentes (`regente ask kiro "…" --wait`)
```
regente.exe ──named pipe──▶ broker.rs  {method, params{token,…}}
  1. token → terminal remetente (um token por terminal; "from" do cliente só é conferido)
  2. orchestrator: resolve o par entre as CONEXÕES do remetente; checa direção, pausa, profundidade, taxa
  3. (opcional) confirmação humana: evento "confirm-request" → modal → confirm_answer; reconfere pausa e conexão depois
  4. registra no log de auditoria (memória + JSONL) e emite "activity"
  5. injeta no PTY do destino (bracketed paste + Enter, ou comentário "# …" em shell comum)
  6. se wait: espera um oneshot; o destino responde com `regente reply <id>` e o texto volta ao remetente
```
A injeção no PTY **só** acontece dentro do broker, depois de todas as checagens.

### 3. Coordenador (recruit/connect/dismiss)
O broker não cria nós; ele **pede à interface**: emite `coord-request` (com prazo de 10 s), a interface executa (`handleCoord` em `actions.ts`) e responde com o comando Tauri `coord_answer`. O broker reserva a vaga antes de pedir, aplica limites de taxa e registra tudo.

### 4. Rotinas
A interface agenda (`lib/routines.ts`, função pura `isDue`) e chama o comando Tauri `routine_fire`, que executa `Ctx::fire_routine` no broker: pré-execução opcional (PowerShell, 60 s), `{{output}}`, sanitização, reconferência de pausa e injeção. **Não existe método de rotina no pipe**, então agentes não podem criar nem disparar rotinas.

### 5. Persistência
- `workspace.json` por workspace em `%APPDATA%\Regente\workspaces\<id>\`, escrito de forma **atômica** (arquivo temporário + renomear).
- **Backups rotativos** (até 10, no máximo 1 por minuto) em `backups\` e **recuperação** a partir do mais recente válido se o arquivo principal estiver corrompido.
- O front salva com *debounce* a cada mudança (`onStateChanged` em `actions.ts`).
- O formato tem `version` (`SCHEMA_VERSION` em `types.ts`). `migrate()` em `lib/workspace.ts` valida **tudo** que vem de disco/importação (campos inválidos viram padrões; nós desconhecidos são descartados). **Mudou o formato? Atualize `migrate()` e os testes.**
- Notas são espelhadas em `<raiz>\.regente\notes\*.md`.

## Decisões e invariantes (não quebre sem discutir)
1. **Regras de orquestração são puras** (`orchestrator.rs`) e testadas sem I/O. O broker só aplica o resultado.
2. **Identidade vem do token por terminal**, nunca de um campo informado pelo cliente.
3. **Injeção no PTY somente via broker**, depois de sanitizar e autorizar.
4. **Texto de terceiros é dado, não instrução**: sem HTML cru em Markdown, links só `http(s)`/`mailto`/relativos, navegador só `localhost`, arquivos importados são não confiáveis.
5. **A pausa global vence tudo** (mensagens, respostas, rotinas, coordenador).
6. **Sem telemetria e sem rede obrigatória.**
7. **Toda string de UI** em `src/locales/{pt-BR,en}.json`.
8. **Toda regra nova tem teste.**

## Limites e constantes
| Constante | Valor | Onde |
|---|---|---|
| Profundidade máxima da cadeia | 4 (vale 10 min) | `orchestrator.rs` |
| Mensagens por minuto por agente | 30 | `orchestrator.rs` |
| Coordenador: recrutados vivos / operações por minuto | 6 / 10 | `orchestrator.rs` |
| `notify` / `status` | 1 a cada 10 s / 1 a cada 2 s por terminal | `orchestrator.rs` |
| Mensagem / nota / linha do pipe | 32 KiB / 256 KiB / 1 MiB | `broker.rs` |
| Anel de saída por terminal | 1 MiB | `pty.rs` |
| Backups de workspace | 10, 1 por minuto | `persist.rs` |
| Log de auditoria em memória / arquivo | 2000 entradas / rotaciona em 5 MB | `orchestrator.rs`, `broker.rs` |
| Pré-execução de rotina | 60 s, 8 KB de saída | `broker.rs` |

## Pontos específicos do Windows (o que precisa mudar para portar)
Veja a lista completa e o plano em [PORTING.md](PORTING.md): *named pipe* (`broker.rs`, `cli/src/lib.rs`), `taskkill` (`pty.rs`), PowerShell na pré-execução e na detecção de shell (`broker.rs`, `sys.rs`), `APPDATA` (`lib.rs`), `.exe` fixos (`lib.rs`, `cli/src/main.rs`) e o empacotamento NSIS.
