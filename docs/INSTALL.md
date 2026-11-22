# Instalação

## Plataformas

| Plataforma | Situação | Observações |
|---|---|---|
| Windows 10/11 x64 | ✅ Suportado | Precisa do **WebView2 Runtime** (já vem no Windows 11 e nas versões atuais do Windows 10) |
| Linux | 🧪 Experimental (compilar do código) | Backend e um E2E de interface testados no Ubuntu 24.04; **nenhuma pessoa usou a interface ainda**; sem instalador |
| macOS | 🧪 Experimental (compilar do código) | O CI do GitHub compila e testa o backend; **ninguém usou a interface num Mac ainda**; sem instalador |

> Em Linux e macOS **não há binário pronto**: é preciso compilar (seção abaixo). O estado detalhado, o que foi e o que não foi verificado, está em [PORTING.md](PORTING.md). Relatos de quem testar são muito bem-vindos.

## Windows: instalador (recomendado)

1. Baixe `Regente_<versão>_x64-setup.exe` da página de *Releases* do repositório.
2. **Confira a integridade**: compare o SHA-256 do arquivo com o publicado na release.
   ```powershell
   Get-FileHash .\Regente_0.1.0_x64-setup.exe -Algorithm SHA256
   ```
3. Execute o instalador. Ele instala **apenas para o seu usuário** (sem administrador) em `%LOCALAPPDATA%\Regente`, com:
   - `regente-app.exe` (o aplicativo),
   - `regente.exe` (CLI usado dentro dos terminais),
   - `regente-mcp.exe` (servidor MCP).
4. Abra o **Regente** pelo Menu Iniciar ou pelo atalho da Área de Trabalho.

### Aviso do Windows SmartScreen
As versões publicadas **não são assinadas por uma autoridade certificadora** (assinar custa dinheiro e o projeto é gratuito). O Windows pode mostrar "O Windows protegeu seu computador" ou "Editor desconhecido".
- Confira o SHA-256 (passo 2) e, se bater, clique em **Mais informações → Executar assim mesmo**.
- Se preferir não confiar em binários prontos, **compile você mesmo** (seção abaixo).

### Onde ficam os seus dados
| O quê | Onde |
|---|---|
| Workspaces e backups | `%APPDATA%\Regente\workspaces\<id>\` (`workspace.json` + `backups\`) |
| Configurações e perfis | `%APPDATA%\Regente\config\` (`settings.json`, `profiles.json`) |
| Log de auditoria da orquestração | `%APPDATA%\Regente\logs\orchestration.jsonl` (rotaciona em 5 MB) |
| Notas espelhadas | `<pasta do workspace>\.regente\notes\*.md` |

### Atualizar
Feche o Regente e execute o instalador novo por cima. Seus workspaces e configurações são mantidos.

### Desinstalar
*Configurações → Aplicativos → Regente → Desinstalar*. Os dados em `%APPDATA%\Regente` **permanecem** de propósito; apague a pasta manualmente se quiser removê-los.

## Windows: portátil
Copie `regente-app.exe`, `regente.exe` e `regente-mcp.exe` para a **mesma pasta** e execute `regente-app.exe`. O app põe essa pasta no `PATH` dos terminais para que `regente` funcione dentro deles.

## Compilar a partir do código (Windows)

### Requisitos
- **Rust** (via [rustup](https://rustup.rs)), toolchain `stable-x86_64-pc-windows-msvc`.
- **Node.js 20+** e npm.
- **Visual Studio Build Tools** com o workload **Desenvolvimento para desktop com C++** (e o Windows SDK):
  ```powershell
  winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
  ```
  (exige administrador).
- **WebView2 Runtime** (já presente na maioria das máquinas).

### Passos
```powershell
git clone <url-do-repositorio>
cd Regente
npm install
cargo build --release -p regente-cli      # regente.exe e regente-mcp.exe (o instalador os embute)
npx tauri build --no-bundle               # target\release\regente-app.exe
# ou, para gerar o instalador NSIS:
npx tauri build --config src-tauri/tauri.bundle.conf.json   # target\release\bundle\nsis\Regente_<versão>_x64-setup.exe
```
`.\scripts\build.ps1 [-Test] [-Bundle]` automatiza isso, ajustando `PATH` e `INCLUDE` para o `rc.exe` do Windows SDK.

### Desenvolvimento
```powershell
npm install
npx tauri dev          # app com recarga automática do front-end
npm test               # testes do front-end (vitest)
cargo test --workspace -- --test-threads=1
```

### Problemas comuns de build
| Sintoma | Causa e solução |
|---|---|
| `LNK1104: não é possível abrir msvcrt.lib` / `kernel32.lib` | O Visual Studio está sem o workload C++ ou o Windows SDK. Instale o workload acima |
| `rc.exe` não encontrado / `RC1004` | Ponha `C:\Program Files (x86)\Windows Kits\10\bin\<versão>\x64` no `PATH` e defina `INCLUDE` com `…\Include\<versão>\um;shared;ucrt` (o `scripts\build.ps1` faz isso) |
| Erro ao compilar `vswhom-sys` | Mesma causa: falta do C++ completo. Instale o workload |
| `error: linker link.exe not found` | Abra o terminal "Developer PowerShell" ou instale o Build Tools |
| Testes de PTY falham | Rode com `--test-threads=1`; os testes abrem terminais reais |

> A máquina do mantenedor tem um Visual Studio sem `lib\x64`; ele usa uma configuração **local** em `.cargo/config.toml` (ignorada pelo git) para contornar. Isso **não** é necessário em uma instalação normal do Build Tools.

## Linux e macOS (experimental): compilar do código
**Linux** (Ubuntu/Debian; verificado no Ubuntu 24.04):
```bash
sudo apt install build-essential curl wget file libxdo-dev libssl-dev \
  libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev nodejs npm rustup
rustup default stable
```
**macOS**: `xcode-select --install`, Rust (via [rustup](https://rustup.rs)) e Node.js 20+.

Depois, nas duas plataformas:
```bash
git clone <url-do-repositorio> && cd regente
npm ci
cargo build -p regente-cli               # o app procura `regente` ao lado do executável
npx tauri build --no-bundle              # use --debug para compilar mais rápido
./target/release/regente-app             # (ou target/debug/regente-app com --debug)
```
Onde ficam os dados: Linux `~/.local/share/Regente` (ou `$XDG_DATA_HOME/Regente`); macOS `~/Library/Application Support/Regente`. O socket do broker fica em `$XDG_RUNTIME_DIR/regente/` (diretório `0700`, socket `0600`).

**Limites desta versão**: o `regente read` pode perder o começo de linhas longas em shells com *readline* (bash do macOS); a tela de rotinas ainda diz "PowerShell" mas executa `sh -c`; o build de release e o empacotamento (deb, AppImage, dmg) não foram verificados.

## Verificar a instalação
Abra um terminal **dentro do Regente** e rode:
```
regente debug
```
Deve mostrar `broker: ok`, o seu nome de terminal e o número de conexões. Se aparecer falha, veja *Solução de problemas* em [USER_GUIDE.md](USER_GUIDE.md#solução-de-problemas).

## Configurar o MCP em um agente
```
claude mcp add regente -- regente-mcp        # Claude Code
regente mcp-config                           # imprime o JSON para outros clientes MCP
```
O servidor MCP só funciona **dentro** de terminais do Regente (ele precisa das variáveis `REGENTE_*`).
