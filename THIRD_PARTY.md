# Dependências de terceiros

Todas de código aberto com licença permissiva. Nenhum código, asset ou texto do app proprietário que inspirou o projeto foi usado.

| Pacote | Licença | Uso |
|---|---|---|
| Tauri 2, tauri-plugin-dialog/notification/opener | MIT / Apache-2.0 | Shell nativo, diálogos, notificações, abrir links |
| React, React DOM | MIT | UI |
| Vite, @vitejs/plugin-react, TypeScript | MIT / Apache-2.0 | Build |
| @xterm/xterm, addon-fit, addon-web-links | MIT | Emulador de terminal |
| marked | MIT | Markdown |
| portable-pty | MIT | PTY (ConPTY) |
| sysinfo | MIT | CPU/RAM por processo |
| tokio | MIT | Runtime assíncrono do broker |
| serde, serde_json | MIT / Apache-2.0 | Serialização |
| uuid | MIT / Apache-2.0 | Identificadores |
| vitest, jsdom | MIT | Testes (dev) |
| tempfile | MIT / Apache-2.0 | Testes (dev) |

Observação: 7 crates transitivos (Tauri/WebView) usam MPL-2.0 (copyleft por arquivo, sem efeito sobre o código do Regente); o restante é MIT, Apache-2.0, BSD, Zlib ou Unicode. Auditoria: `cargo metadata` + licenças dos pacotes npm (sem GPL/AGPL).

Ícone do app: criado para este projeto (`app-icon.svg`).
