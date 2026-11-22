# Port para Linux e macOS

**Estado atual: Windows é suportado; Linux e macOS são experimentais** (o backend passa nos testes; a interface ainda não foi validada por pessoas). Este documento descreve o que foi feito e o que falta. O Tauri, o React, o xterm.js e o `portable-pty` já são multiplataforma; o que prende o projeto ao Windows é um conjunto **pequeno e bem localizado** de pontos, listado abaixo.

> Nenhuma das mudanças abaixo foi feita nem testada: o mantenedor desenvolve no Windows. Quem fizer o port deve **rodar a suíte de testes na plataforma** (veja [TESTING.md](TESTING.md)) e abrir um PR por etapa.

## Estado do port
O código das etapas 1 a 6 abaixo está escrito e **foi exercitado no Linux**; no macOS, **validado apenas pelo CI do GitHub** (runner `macos-latest`: compila o app e passa os testes do backend).

| Verificação | Resultado |
|---|---|
| Windows: toda a suíte (a lógica de conexão é compartilhada com o socket Unix) | ✅ 59 testes de Rust, 42 do front |
| **Linux** (Ubuntu 24.04 em WSL2): `cargo test --workspace -- --test-threads=1` | ✅ **56 testes**: 42 de unidade, **9 de integração do broker com PTYs reais e socket Unix** (tokens por terminal, coordenador, `keys`, rotinas e pré-execução, pausa, linha enorme), a carga de 20 terminais e os do MCP |
| Linux: `tsc` e `npm test` | ✅ 42 testes do front |
| Linux: compilar o app (`npx tauri build --debug --no-bundle`) | ✅ |
| Linux: abrir o app sob **Xvfb** (tela virtual) | ✅ o processo sobe e fica de pé; o broker cria `…/regente/broker-<pid>.sock` com diretório `0700` e socket `0600`; os dados vão para `$XDG_DATA_HOME/Regente` |
| Linux: **E2E de interface** (`bash e2e/run-linux.sh`, WebDriver via `tauri-driver` + Xvfb): workspace, bash real, `regente debug/status/peers/send/ask/reply`, coordenador (`recruit`/`dismiss`) | ✅ **13 de 13** |
| Linux: uso por uma pessoa, E2E dos demais recursos (nós, rotinas, templates, importação) | ❌ não verificado |
| Linux: build de **release**, empacotamento (deb/AppImage) | ❌ não verificado |
| **macOS** (CI do GitHub, hardware Apple real): compilar o app e `cargo test --workspace` | ✅ passa (com um ajuste no teste de `read`, veja "Limitação conhecida") |
| macOS: abrir a interface, terminais, E2E | ❌ não verificado por ninguém. O `tauri-driver` **não suporta macOS** (não há driver para o WKWebView), então só uma pessoa com um Mac consegue validar a interface |

> **macOS e virtualização**: não use hackintosh nem VM de macOS em hardware não-Apple (a licença da Apple proíbe). O caminho legítimo e gratuito é o CI do GitHub (`macos-latest`) ou um Mac de verdade.

| Etapa | Código na branch | Observação |
|---|---|---|
| 1. Transporte por socket Unix | ✅ testado no Linux | `broker.rs::serve` (`#[cfg(unix)]`), cliente em `cli/src/lib.rs`; diretório `0700`, socket `0600` |
| 2. Encerrar árvores de processos | ✅ testado no Linux | `kill(-pgid, SIGKILL)` em `pty.rs` e `broker.rs` |
| 3. Pré-execução de rotinas | ✅ testado no Linux | `sh -c`, grupo de processos próprio. A tela ainda diz "PowerShell" |
| 4. Pasta de dados | ✅ confirmado no Linux | `$XDG_DATA_HOME`/`~/.local/share/Regente`; macOS `~/Library/Application Support/Regente` (não verificado) |
| 5. Sufixo de executável | ✅ escrito | `EXE_SUFFIX` |
| 6. Shell padrão | 🟡 não exercitado pela interface | `$SHELL`; o ramo POSIX de `spawn.ts` precisa de teste pela UI |
| 7. Empacotamento (deb/AppImage/dmg), ícones, assinatura | ❌ não feito | |
| 8. Testes parametrizados | ✅ feito | terminal de teste, pré-execução, carga e socket cru por plataforma |
| 9. CI Linux/macOS | ✅ roda a suíte completa em modo experimental | |

### Limitação conhecida (macOS)
O `/bin/sh` do macOS é o bash com *readline*, que redesenha linhas longas com movimentos de cursor. O `regente read` aproxima o conteúdo do terminal e pode **perder o começo de linhas longas** nesse shell (o texto injetado chega normalmente; é só a leitura que fica imperfeita). Melhorar isso é uma das tarefas do item "estado de terminal confiável" (parser de terminal completo) em [FEATURES.md](FEATURES.md).

### Como compilar e testar no Linux (verificado no Ubuntu 24.04)
```bash
sudo apt install build-essential curl wget file libxdo-dev libssl-dev \
  libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev nodejs npm rustup xvfb
rustup default stable
git clone <repo> && cd regente && git checkout port/unix
npm ci
cargo build -p regente-cli                       # o app procura `regente` ao lado do executável
cargo test --workspace -- --test-threads=1       # backend completo
npm test                                         # front-end
npx tauri build --debug --no-bundle              # app em target/debug/regente-app
# abrir sem monitor (teste de fumaça):
xvfb-run -a ./target/debug/regente-app
```
No WSL2 com WSLg (Windows 11) dá para abrir a janela do app direto, sem `xvfb-run`. Falta ainda um roteiro E2E para Linux (WebDriver).

## Pré-requisitos de build

**Linux** (Debian/Ubuntu; outros usam os pacotes equivalentes — veja o guia de pré-requisitos do Tauri 2):
```bash
sudo apt install build-essential curl wget file libxdo-dev libssl-dev \
  libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libgtk-3-dev
```
**macOS**: Xcode Command Line Tools (`xcode-select --install`).
**Ambos**: Rust (rustup), Node.js 20+.

## Lista de trabalho (do mais estrutural ao mais simples)

### 1. Transporte do broker: *named pipe* → socket Unix  *(principal)*
- **Hoje**: `src-tauri/src/broker.rs`, função `serve` com `#[cfg(windows)]` (named pipe) e um *stub* `#[cfg(not(windows))]` que só imprime um aviso. O nome do pipe vem de `state.rs` (`\\.\pipe\regente-broker-<pid>`). O cliente está em `cli/src/lib.rs` (`open_pipe`).
- **Fazer**:
  - Servidor: `tokio::net::UnixListener` em um socket dentro de um diretório **só do usuário** (`$XDG_RUNTIME_DIR/regente/<pid>.sock` no Linux; `$TMPDIR` ou `~/Library/Caches` no macOS), diretório com modo `0700` e socket `0600`. Verificar as credenciais do par (`SO_PEERCRED` no Linux / `getpeereid` no macOS) é desejável.
  - Cliente (`cli/src/lib.rs`): conectar com `std::os::unix::net::UnixStream`; manter o mesmo protocolo de uma linha ([BROKER_PROTOCOL.md](BROKER_PROTOCOL.md)).
  - `REGENTE_PIPE` passa a conter o caminho do socket (pode manter o nome da variável).
  - Limite de linha de 1 MiB e o resto do protocolo: **iguais**.

### 2. Encerrar árvores de processos
- **Hoje**: `pty.rs` (`kill_tree` usa `taskkill /T /F`; a versão não-Windows é vazia) e `broker.rs` (`kill_process_tree`).
- **Fazer**: iniciar cada PTY como líder de sessão/grupo (o `portable-pty` já usa `setsid` no Unix) e encerrar com `killpg(pgid, SIGTERM)` seguido de `SIGKILL` após um prazo. Crate `nix` ou `libc`.

### 3. Pré-execução de rotinas
- **Hoje**: `broker.rs::run_pre` chama `powershell.exe -NoProfile -NonInteractive -Command`.
- **Fazer**: no Unix, `sh -c "<cmd>"` (ou o shell do usuário), com o mesmo limite de 60 s, 8 KB de saída e a mesma regra "sem saída ou código ≠ 0 ⇒ não dispara". Atualizar o texto de UI (`routine.preRun`, "PowerShell") para "comando do shell".

### 4. Pasta de dados
- **Hoje**: `lib.rs::data_dir` lê `%APPDATA%\Regente`.
- **Fazer**: Linux `$XDG_DATA_HOME/Regente` (padrão `~/.local/share/Regente`), macOS `~/Library/Application Support/Regente`. Considere o crate `dirs`. Atualizar [INSTALL.md](INSTALL.md) e o [USER_GUIDE.md](USER_GUIDE.md).

### 5. Nomes de executáveis e `PATH`
- **Hoje**: `lib.rs` (`cli_available` procura `regente.exe`), `cli/src/main.rs` (`mcp-config` procura `regente-mcp.exe`), `find_cli_dir`.
- **Fazer**: usar `std::env::consts::EXE_SUFFIX`. Garantir que, no pacote, `regente` e `regente-mcp` fiquem num diretório que o app põe no `PATH` dos terminais.

### 6. Shell padrão e detecção de comandos
- **Hoje**: `sys.rs` já escolhe `which` fora do Windows, mas o shell padrão e os perfis assumem `pwsh`/PowerShell. `src/lib/spawn.ts` tem um ramo POSIX (`sh -c '…'; exec $SHELL`) que **nunca foi exercitado**.
- **Fazer**: padrão `$SHELL` (ou `bash`/`zsh`); revisar `spawn.ts` e `sys.rs::default_shell`; testar a injeção por *bracketed paste* em `bash` e `zsh` e a regra "vira comentário" (`#` funciona em shells POSIX).

### 7. Janela, ícones e empacotamento
- **Hoje**: `src-tauri/tauri.conf.json` define alvo `nsis`; `main.rs` usa `windows_subsystem` (já protegido por `cfg_attr`).
- **Fazer**: alvos `deb`, `appimage` (Linux) e `dmg`/`app` (macOS); ícones `.icns`/`.png`; no macOS, assinatura e notarização (o app roda sem, mas o Gatekeeper avisará). Rever a CSP no WebKitGTK/WKWebView.

### 7b. Atalhos e fontes
- O front já trata `Ctrl` **ou** `Cmd` (`e.ctrlKey || e.metaKey`). Conferir conflitos com atalhos do sistema.
- Fonte padrão do terminal (`Cascadia Mono, Consolas, monospace`): cair em `monospace` está ok; considerar `Menlo`/`DejaVu Sans Mono`.

### 8. Testes
- `src-tauri/tests/*.rs` e `pty.rs` (testes) usam `cmd.exe` como terminal de teste: parametrizar por plataforma (`sh`).
- Os testes de PTY devem rodar com `--test-threads=1`.
- O E2E por DevTools usa o WebView2 (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`). No Linux/macOS o WebKit não expõe o mesmo protocolo: use **`tauri-driver`/WebDriver** para um equivalente, ou comece só com os testes unitários e de integração.

### 9. CI
Um workflow com matriz `windows-latest`, `ubuntu-latest`, `macos-latest` (já existe um esqueleto em `.github/workflows/ci.yml`, com Linux/macOS marcados como experimentais) que rode `npm test`, `cargo test --workspace -- --test-threads=1` e `tauri build`.

## Ordem sugerida de PRs
1. Abstrair o transporte (trait/`cfg`) e implementar o socket Unix + cliente, **com teste de integração** equivalente ao `broker_e2e.rs`.
2. `kill_tree` e `run_pre` no Unix.
3. `data_dir`, sufixo de executável, shell padrão.
4. Empacotamento e CI.
5. Documentação (INSTALL/USER_GUIDE) e remoção do aviso "não suportado" no README, **só depois** de a suíte passar na plataforma.

## Como saber que terminou
- `cargo test --workspace -- --test-threads=1` e `npm test` passam no Linux/macOS.
- O app abre, cria terminais, e o roteiro manual do [USER_GUIDE](USER_GUIDE.md) (criar workspace, conectar dois terminais, `regente peers`, `regente ask --wait`, reiniciar e restaurar) funciona.
- Os documentos de instalação para a plataforma foram escritos **a partir de uma instalação real**.

Se você quer assumir essa tarefa, abra uma issue "Port: Linux" ou "Port: macOS" para coordenarmos, e veja o [CONTRIBUTING.md](../CONTRIBUTING.md).
