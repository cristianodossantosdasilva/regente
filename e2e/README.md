# E2E do app nativo

Conecta ao WebView2 do `regente-app.exe` real (PTY, broker e disco reais) via DevTools Protocol.

```
cd e2e && npm install
# PowerShell:  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"; ..\target\release\regente-app.exe
node full.mjs      # workspace, terminais, conexão por arraste, regente peers/send/ask/reply, pausa, confirmação, zoom, dormência, paleta, busca
node nodes.mjs     # nota, esboço, diagrama, arquivo, navegador, zona, git worktree, tema, perfis, importação
node restore.mjs   # reinicie o app antes: confere restauração de nós, conexões e diretórios
node coord.mjs    # coordenador: recruit, peers, dismiss por CLI
node persist.mjs 6  # reinicie o app e confere que o workspace volta com N nós
node mem.mjs       # alerta de RAM por terminal
node agents.mjs    # (opcional) monta Claude Code/Kiro/AGY reais; veja key.mjs para interagir
```
Se a porta 9222 estiver em uso (ex.: Chrome), use `E2E_PORT=9333` e `--remote-debugging-port=9333`. Para não tocar nos seus dados, rode o app com `APPDATA` e `WEBVIEW2_USER_DATA_FOLDER` apontando para uma pasta temporária.
Capturas ficam em `e2e/out/`. Use um workspace/dados de teste: os scripts criam workspaces e terminais.
`agents.mjs` NÃO usa flags de bypass de permissão; aprove prompts dos agentes manualmente (`node key.mjs <terminal> @Enter`).
