# Contribuindo com o Regente

Obrigado pelo interesse! O Regente é gratuito, de código aberto (MIT) e feito pela comunidade. Este guia explica como colaborar. Ao participar, você concorda com o [Código de Conduta](CODE_OF_CONDUCT.md).

## Formas de ajudar
- **Testar e reportar bugs** (principalmente em máquinas e agentes diferentes dos do mantenedor).
- **Documentação**: correções, traduções (a UI e a maior parte dos docs estão em PT-BR; tradução para inglês é muito bem-vinda), exemplos de fluxos.
- **Port para Linux e macOS**: a maior contribuição possível agora. Veja [docs/PORTING.md](docs/PORTING.md).
- **Perfis de agentes**: novas ferramentas e flags de retomada (arquivo `src/lib/workspace.ts`, `DEFAULT_PROFILES`).
- **Funcionalidades**: veja [docs/FEATURES.md](docs/FEATURES.md) (🔜/📋) e [docs/ROADMAP.md](docs/ROADMAP.md).
- **Segurança**: revisão do broker. Falhas **não** vão em issues públicas: veja [SECURITY.md](SECURITY.md).

## Regra de ouro: código limpo de terceiros
O Regente tem identidade própria e **não pode conter código, assets, textos de interface, nomes ou marcas de outros produtos**. Ao contribuir:
- escreva o código você mesmo, a partir de documentação pública ou da descrição do comportamento;
- **não cole** código de outros projetos sem verificar a licença (só aceitamos licenças permissivas compatíveis com MIT, e elas precisam ser registradas em [THIRD_PARTY.md](THIRD_PARTY.md));
- **não descompile, extraia ou copie** nada de aplicativos proprietários, nem textos/ícones/layouts deles;
- se um PR parecer derivado de um produto proprietário, ele será recusado.

## Preparando o ambiente (Windows)
Requisitos e problemas comuns de build: [docs/INSTALL.md](docs/INSTALL.md#compilar-a-partir-do-código-windows).
```powershell
git clone <seu-fork>
cd Regente
npm install
npx tauri dev                                   # app com recarga
npm test                                        # testes do front
cargo test --workspace -- --test-threads=1      # testes do Rust
npx tsc --noEmit                                # tipos
```
O mapa do código está em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Como testar (inclusive o E2E no app real): [docs/TESTING.md](docs/TESTING.md).

## Fluxo de contribuição
1. **Abra uma issue** antes de mudanças grandes (novas funções, mudanças de formato ou de protocolo) para alinharmos a ideia. Bugs e docs podem ir direto para PR.
2. Faça um **fork** e crie um branch descritivo (`fix/…`, `feat/…`, `docs/…`).
3. Faça commits **pequenos e focados**. Mensagens no imperativo, em português ou inglês, explicando o *porquê*. Ex.: `Corrige perda de allowKeys ao reabrir o workspace`.
4. **Rode os testes** (`npm test`, `cargo test --workspace -- --test-threads=1`, `npx tsc --noEmit`). Mudou algo de interface ou do CLI/broker? Rode também `bash e2e/run-all.sh`.
5. Abra o **Pull Request** preenchendo o modelo. PRs pequenos são revisados mais rápido.
6. Responda aos comentários; o mantenedor pode pedir ajustes. O PR é integrado quando o CI passa e há aprovação.

## Padrões de código
**Geral**
- Sem *placeholders*, sem código morto, sem `TODO` sem issue.
- **Toda regra nova tem teste**; bugs corrigidos ganham um teste que falhava antes.
- **Nunca registre segredos** (tokens, chaves) em logs, eventos ou mensagens de erro.
- Toda string de UI vai em `src/locales/pt-BR.json` **e** `src/locales/en.json`.

**Rust**
- Regras de negócio **puras** em `orchestrator.rs` (testáveis sem I/O); o `broker.rs` só aplica.
- Não use `unwrap()` em entrada externa. Valide tamanhos e formatos.
- `cargo fmt` e `cargo clippy` sem avisos novos.
- Ações do broker que alteram estado: respeitar a pausa global, registrar no log e ter teste do caso negativo.

**TypeScript/React**
- Lógica em `src/lib/` (pura, testável); componentes só apresentam.
- Estado global em `store.ts`, mutações em `actions.ts`.
- Dados vindos de disco/importação passam por `migrate()`; mudou o formato → atualize `SCHEMA_VERSION`, `migrate()` e os testes.
- Evite dependências novas; se for necessário, precisam ser permissivas (MIT/Apache/BSD…) e entrar em `THIRD_PARTY.md`.

**Segurança**
- Leia [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) e as invariantes em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Quebrar uma invariante exige discussão prévia.
- Texto vindo de agentes, notas, arquivos e workspaces importados é **não confiável**.

## Checklist do PR
- [ ] Testes novos/atualizados e passando (`npm test`, `cargo test … --test-threads=1`, `npx tsc --noEmit`)
- [ ] Docs atualizadas (README/guia/protocolo, se mudou comportamento)
- [ ] Strings de UI nos dois idiomas
- [ ] Sem segredos, caminhos pessoais ou dados reais
- [ ] Sem código/asset de terceiros sem licença registrada
- [ ] `docs/CHANGELOG.md` atualizado (seção "Não lançado")

## Documentação
Escrita em português do Brasil, clara e verificável: **não documente o que você não testou**. Se algo é um plano, diga que é um plano (veja como o [PORTING.md](docs/PORTING.md) faz). Traduções são bem-vindas: crie `docs/en/…` e linke a partir do `README.en.md`.

## Releases (para mantenedores)
1. Atualize a versão em `package.json`, `src-tauri/Cargo.toml`, `cli/Cargo.toml` e `src-tauri/tauri.conf.json`; mova "Não lançado" do CHANGELOG para a versão.
2. `.\scripts\release.ps1` (PowerShell): gera o instalador **sem vazar caminhos da sua máquina** (o Rust embute caminhos de arquivos nos executáveis; o script os troca por nomes genéricos com `--remap-path-prefix`) e cria o `SHA256SUMS.txt`. Depois confira: nenhum executável deve conter o nome do seu usuário.
3. Rode os testes e o E2E; instale o `.exe` numa máquina limpa e faça o roteiro do guia.
4. Publique o instalador **com o SHA-256** na release. Se assinar, use um certificado próprio do projeto; **nunca** publique chaves privadas nem o certificado autoassinado pessoal de alguém.

## Dúvidas
Abra uma *Discussion* ou uma issue com a etiqueta `pergunta`.
