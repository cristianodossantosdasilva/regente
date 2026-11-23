# Testes

O Regente tem **três camadas** de teste. Toda regra nova precisa de teste (veja o [CONTRIBUTING](../CONTRIBUTING.md)).

| Camada | Comando | O que cobre | Contagem atual |
|---|---|---|---|
| Front-end (vitest + jsdom) | `npm test` | Geometria, estado do agente, spawn, migração do workspace, rotinas, templates, Markdown, realce, importação endurecida, renderização básica | 42 |
| Rust: unidade + integração | `cargo test --workspace -- --test-threads=1` | Orquestrador (regras puras), broker com **PTYs reais**, persistência, ANSI, 20 terminais simultâneos, CLI/MCP | 59 |
| E2E no app real | `bash e2e/run-all.sh` | A interface e o CLI de ponta a ponta, num app **instalado/compilado de verdade** (WebView2 + DevTools) | 65 verificações + restauração/memória |

> `--test-threads=1` é obrigatório nos testes Rust: eles abrem terminais e pipes reais e não são feitos para rodar em paralelo.

## Rodando

```powershell
npm install
npm test
cargo test --workspace -- --test-threads=1
npx tsc --noEmit          # checagem de tipos do front
```

Para um teste específico: `cargo test -p regente-app --test broker_e2e -- --test-threads=1 nome_do_teste` ou `npx vitest run src/lib/routines.test.ts`.

## O que cada arquivo de teste faz
| Arquivo | Foco |
|---|---|
| `src/lib/lib.test.ts` | Geometria, estado do agente, spawn, `migrate`, `hardenImported`, `isInside` |
| `src/lib/routines.test.ts` | `isDue`, `nextRun`, `sanitizeRoutine` |
| `src/lib/templates.test.ts` | Capturar/instanciar/validar templates |
| `src/lib/content.test.ts`, `src/render.test.tsx` | Markdown, realce, renderização |
| `src-tauri/src/orchestrator.rs` (módulo `tests`) | Todas as regras de orquestração, sem I/O |
| `src-tauri/src/broker.rs` (módulo `tests`) | `sanitize`, `decode_escapes`, `slice_lines`, `edit_once`, `run_pre` |
| `src-tauri/tests/broker_e2e.rs` | **Todos os métodos do broker** contra um broker real com PTYs reais |
| `src-tauri/tests/many_terminals.rs` | 20 terminais: tempo de subida, memória, dormência |
| `e2e/*.mjs` | Veja abaixo |

## E2E no app real
Os roteiros em `e2e/` conectam ao WebView2 do app por DevTools Protocol (puppeteer-core) e dirigem a interface de verdade: criam workspaces, terminais, conexões por arraste, digitam comandos `regente …` dentro dos terminais e conferem o resultado.

| Roteiro | Cobre |
|---|---|
| `full.mjs` | Workspace, terminais, renomear, conexão por arraste, `peers/send/ask/reply/status/debug`, atividade, pausa, confirmação humana, zoom, dormência/replay, paleta, busca |
| `nodes.mjs` | Nota, esboço, diagrama, arquivo, navegador local, zona, git branch/worktree, tema, perfis, importação |
| `coord.mjs` | Coordenador: `recruit`, `peers`, recrutado sem recursão, `dismiss` |
| `routines.mjs` | Criar rotina pela UI, executar agora, pré-execução com `{{output}}`, pré-execução vazia, lembrete |
| `templates.mjs` | Salvar e inserir template, nomes únicos, sem sobreposição |
| `persist.mjs N` | Depois de reiniciar o app, o workspace volta com N nós |
| `restore.mjs`, `mem.mjs` | Restauração completa e alerta de RAM |
| `agents.mjs`, `key.mjs` | (Opcional) Agentes **reais** (Claude Code, Kiro, AGY) trocando mensagens |

### Rodar tudo, com isolamento
```bash
bash e2e/run-all.sh [caminho/do/regente-app.exe]
```
O script usa **dados e WebView em uma pasta temporária** (`APPDATA` e `WEBVIEW2_USER_DATA_FOLDER`), a **porta 9333** e reinicia o app entre as suítes. Ele só encerra os processos que **ele mesmo** iniciou: não mexe numa instância sua já aberta nem nos seus workspaces.

Manualmente (uma suíte):
```powershell
$env:APPDATA = "C:\temp\regente-e2e\appdata"
$env:WEBVIEW2_USER_DATA_FOLDER = "C:\temp\regente-e2e\wv2"
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9333"
.\target\release\regente-app.exe
# em outro terminal:
cd e2e; npm install; $env:E2E_PORT = 9333; node full.mjs
```
Capturas de tela ficam em `e2e/out/` (ignorado pelo git).

> **Agentes reais nos testes**: `agents.mjs` **nunca** usa flags de bypass de permissão (`--trust-all-tools`, `--dangerously-skip-permissions`). As aprovações são manuais.

### E2E de interface no Linux
`bash e2e/run-linux.sh` (veja os pré-requisitos no cabeçalho do script): sobe uma tela virtual (Xvfb), o `tauri-driver` e roda `e2e/webdriver/smoke.mjs` por WebDriver. `smoke.mjs` (13 verificações) cobre: abrir o app, criar workspace, terminal com o shell real, `regente debug/status/peers/send/ask/reply`, coordenador, `recruit` e `dismiss`. `features.mjs` (23) cobre: rotinas (execução manual, pré-execução por `sh` com `{{output}}`, sem saída, lembrete), criação de nós e zona pela paleta, templates, importação de um workspace hostil (o coordenador é removido e a pré-execução **não** roda) e o **reinício do app** com restauração do workspace. Roda no CI do Ubuntu. Não existe equivalente no macOS (o `tauri-driver` não o suporta).

## Escrevendo testes
- **Regra de orquestração nova** → teste no `orchestrator.rs` (puro) **e** um caso negativo no `broker_e2e.rs` (o que deve ser recusado).
- **Mudou o formato do workspace** → atualize `SCHEMA_VERSION`, `migrate()` e o teste de ida e volta (`migrate(JSON.parse(JSON.stringify(ws)))` deve ser igual).
- **Tela nova** → um roteiro curto em `e2e/` seguindo o padrão `check(nome, condição)` e `process.exit(failed ? 1 : 0)`; nada de `sleep` longo sem `waitFor`.
- **Não use dados reais** (pastas pessoais, chaves). Use a pasta do próprio repositório ou temporária.
- Testes de tempo (rotinas) recebem a hora **como argumento** (`isDue(r, now)`); não use `Date.now()` direto na lógica.

## Integração contínua
O workflow `.github/workflows/ci.yml` roda o front e os testes Rust no Windows em cada PR; Linux e macOS rodam em modo experimental (veja [PORTING.md](PORTING.md)).
