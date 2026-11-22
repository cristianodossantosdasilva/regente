# Revisões e verificação

## Revisões feitas pelos agentes (via o próprio Regente)
Cenário: terminal com Claude Code real → `regente ask <agente> … --wait` → agente real responde com `regente reply` → resposta volta ao Claude Code.
Nenhum agente foi iniciado com flags de bypass de permissão; o Claude Code ficou restrito a `Bash(regente:*)` e as permissões pedidas por Kiro/AGY foram aprovadas manualmente, uma a uma.

### Kiro — revisão de `src-tauri/src/orchestrator.rs`
| # | Achado | Ação |
|---|---|---|
| 1 | `mark_delivered` sobrescrevia a profundidade: uma mensagem rasa zerava a cadeia e burlava o anti-loop | **Corrigido** (mantém o máximo vigente) + teste `shallow_delivery_does_not_reset_chain_depth` |
| 2 | Terminal que recebeu profundidade 4 ficava bloqueado por 10 min mesmo para ação humana | **Corrigido**: digitação humana no terminal zera a cadeia (`orch_reset_depth`) + teste |
| 3 | `edge_between` pegava a primeira aresta; com duplicadas/opostas a flag `confirm` podia vir da errada | **Corrigido**: `needs_confirm` usa a regra mais restritiva + teste |
| 4 | `resolve_note` aceitava consulta vazia; `d + 1` em `u8` podia estourar | **Corrigido** (guarda + `saturating_add`) + testes |
| 4b | `authorize_send` consome taxa antes da entrega | Aceito: contar tentativas é conservador; documentado |

### AGY — crítica de UX (sobre capturas reais da UI)
| # | Sugestão | Ação |
|---|---|---|
| 1 | Nome do terminal (não id) na aba Atividade | Atividade limpa ao trocar de workspace; nomes resolvidos no workspace aberto |
| 2 | Não injetar `[Regente]` como comando em shells (ParserError) | **Feito**: em shell comum a mensagem entra como comentário `# …` |
| 3 | Botões de zoom (−, +, ajustar) | **Feito** |
| 4 | Portas de conexão mais visíveis; rotular direção/permissão da seta | **Feito** (porta destaca no hover; rótulo →/↔/🔒 com tooltip) |
| 5 | Destaque sincronizado agente da barra ↔ card; tooltips | Já existia a seleção sincronizada; tooltips adicionados nos chips |

Além disso, os E2E encontraram e corrigiram: nó novo nascendo fora da tela (agora é trazido para a vista), seletor de perfil que não repetia a mesma escolha, campo de renomear sem seleção do texto, nós novos sobrepostos (posicionamento por espaço livre).

## Verificação (evidências)
Todas executadas nesta máquina (Windows 11), contra o **app nativo real** (`regente-app.exe` release), com PTY, broker e disco reais.

| Item | Como | Resultado |
|---|---|---|
| Unitários TypeScript (geometria, estado, spawn, migração, markdown, realce, posicionamento, render) | `npm test` | 29/29 |
| Unitários + integração Rust (PTY ConPTY, orquestrador, persistência, MCP, **broker e2e**, **20 terminais**) | `cargo test --workspace -- --test-threads=1` | 37/37 |
| E2E do app: workspace, terminais, renomear, conexão por arraste, `regente peers/send/ask/reply`, atividade, pausa, confirmação humana, zoom, dormência/replay, paleta, busca | `e2e/full.mjs` | 21/21 |
| E2E dos nós: nota, esboço, diagrama, arquivo (md/código), navegador (localhost; externo bloqueado), zona, git branch, **git worktree**, tema claro, perfis + detecção no PATH, importação | `e2e/nodes.mjs` | 16/16 |
| Restauração após reiniciar o app (nós, conexões, diretórios, zoom) | `e2e/restore.mjs` | 3/3 |
| Alerta de RAM por terminal (toast + chip) | `e2e/mem.mjs` | 2/2 |
| **Agentes reais**: Claude Code → Kiro e Claude Code → AGY | `e2e/agents.mjs` + `key.mjs` | respostas devolvidas ao Claude Code |
| 20 terminais | `tests/many_terminals.rs` | sobem em 0,4 s; ~216 MB agregados; buffers ≤ limite; dormentes não emitem eventos |
| Log de auditoria em disco | broker e2e + app real | `%APPDATA%\Regente\logs\orchestration.jsonl` |

## Não verificado / limitações
- **Instalador NSIS**: gerado (`target/release/bundle/nsis/Regente_0.1.0_x64-setup.exe`, 1,5 MB, com `regente.exe` e `regente-mcp.exe`), mas **não foi instalado/executado** nesta máquina.
- **Assinatura de código**: as versões publicadas **não** são assinadas por uma autoridade certificadora. O script opcional `scripts/sign.ps1` cria um certificado autoassinado no repositório de certificados do *seu* usuário e assina os arquivos que você indicar (útil para uso próprio; o Windows só confia nele se você importar o certificado).
- **Notificações nativas do Windows** (toast do SO): o caminho de código roda, mas a exibição do toast pelo sistema não foi observada (o alerta in-app foi).
- **Retomar sessão** de agentes: flags conferidas na documentação oficial e no `--help` local: Claude `--continue`, Kiro `--resume`, AGY `--continue`, Copilot `--continue`, OpenCode `--continue`, Codex `resume --last`, Gemini `--resume latest`. Cobertas por teste unitário de spawn; não testadas E2E com cada agente.
- **Estado "aguardando entrada"**: heurística por padrões do perfil (não infalível).
- **Efeitos colaterais dos testes com agentes**: Kiro e AGY pediram confiança na pasta do projeto; a confiança foi concedida (persistida nas configurações deles). Processos `kiro-cli`/`agy` iniciados pelos testes podem ter ficado em segundo plano.
