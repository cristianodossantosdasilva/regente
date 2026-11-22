# Guia do usuário

Este guia cobre o uso diário do Regente no Windows. Para instalar, veja [INSTALL.md](INSTALL.md).

## Sumário
1. [Conceitos](#conceitos)
2. [Workspaces](#workspaces)
3. [O canvas](#o-canvas)
4. [Tipos de nó](#tipos-de-nó)
5. [Perfis de agente](#perfis-de-agente)
6. [Conectar agentes e orquestrar](#conectar-agentes-e-orquestrar)
7. [O CLI `regente` e o MCP](#o-cli-regente-e-o-mcp)
8. [Coordenador](#coordenador)
9. [Rotinas agendadas](#rotinas-agendadas)
10. [Templates de equipe e papéis](#templates-de-equipe-e-papéis)
11. [Git worktree](#git-worktree)
12. [Atalhos](#atalhos)
13. [Configurações](#configurações)
14. [Dados, backup e importação](#dados-backup-e-importação)
15. [Solução de problemas](#solução-de-problemas)

## Conceitos
- **Workspace**: um canvas salvo, ligado a uma **pasta raiz** (normalmente o repositório do seu projeto). Tudo (nós, conexões, zoom, rotinas) é salvo automaticamente.
- **Nó**: um bloco no canvas: terminal, nota, esboço, diagrama, arquivo ou navegador.
- **Agente**: um terminal que executa uma ferramenta de código (Claude Code, Kiro, etc.) a partir de um **perfil**.
- **Conexão**: uma linha entre dois nós. **Só quem está conectado enxerga e fala com quem.** A direção importa.
- **Broker**: o servidor local do app que entrega as mensagens entre agentes (você não precisa mexer nele).

## Workspaces
Barra lateral → aba **Workspaces**:
- **Criar**: informe nome e a pasta raiz.
- **Abrir / excluir**: pela lista.
- **Exportar / importar**: veja [Dados, backup e importação](#dados-backup-e-importação).

A barra lateral abre/fecha com `Ctrl+B`. As abas são **Agentes** (terminais, estado, CPU/RAM), **Atividade** (tudo o que os agentes trocaram) e **Workspaces**.

## O canvas
- **Mover a vista**: arraste o fundo, role com o mouse, ou segure espaço e arraste.
- **Zoom**: `Ctrl` + roda do mouse (ou pinça), `Ctrl +` / `Ctrl −`, botões na tela. **10 % a 400 %**.
- **Ajustar tudo na tela**: `Ctrl+1`. **Zoom 100 %**: `Ctrl+0`.
- **Minimapa**: canto da tela; clique para saltar.
- **Grade e encaixe**: em Configurações (*Encaixar na grade*, *Tamanho da grade*).
- **Zonas**: retângulos coloridos (paleta → "Nova zona"). Mover a zona leva os nós que estão dentro.
- **Excluir** o nó selecionado: tecla `Delete`.
- **Renomear**: clique duplo no cabeçalho do nó. Os nomes são usados para endereçar agentes (`regente ask <nome>`), então prefira nomes curtos e únicos.

Terminais fora da tela (ou com zoom abaixo de 30 %) ficam **dormentes**: a tela é liberada para economizar memória, mas o processo continua rodando e a saída é guardada. Ao voltar, o histórico reaparece.

## Tipos de nó
| Nó | Para quê | Detalhes |
|---|---|---|
| **Terminal** | Shell ou agente | ConPTY real, xterm-256color, truecolor, links clicáveis, copiar/colar. Cabeçalho mostra estado, CPU/RAM, branch do git |
| **Nota** | Memória compartilhada | Markdown com *preview*. Agentes conectados podem ler e escrever pelo CLI/MCP. Espelhada em `<raiz>\.regente\notes\*.md` |
| **Esboço** | Desenho livre | Caneta, retângulo, seta |
| **Diagrama** | Caixas e ligações | Para desenhar arquiteturas e fluxos rápidos |
| **Arquivo** | Ver um arquivo | Código com realce, imagem ou Markdown |
| **Navegador** | Ver o app em desenvolvimento | **Somente `localhost`**; endereços externos são bloqueados |

Crie nós pela barra superior (seletor **＋ Terminal…** e os botões de nota, esboço, etc.) ou pela **paleta** (`Ctrl+K`).

## Perfis de agente
Um perfil diz **como iniciar** um terminal. Perfis padrão: *Shell*, *Claude Code*, *Antigravity (AGY)*, *Kiro CLI*, *Copilot CLI*, *Codex*, *Gemini CLI*, *OpenCode*. O app detecta no `PATH` quais comandos existem.

Editar: botão **Perfis de agentes** na barra superior. A tela é um editor **JSON** (há o botão *Detectar no PATH*, que mostra quais comandos foram encontrados, e *Salvar*). Cada perfil tem os campos:
| Campo | Significado |
|---|---|
| `id`, `name`, `color` | Identificador, nome exibido e cor |
| `command` e `args` | O que executar (ex.: `claude`). `command` vazio = shell puro |
| `env` | Variáveis de ambiente adicionadas só a esse terminal |
| `resumeArgs` | Argumentos extras ao retomar a sessão (ex.: `["--continue"]`, `["--resume"]`, `["resume","--last"]`), usados quando "Retomar sessão ao reabrir" está ligado |
| `waitPatterns` | Expressões regulares (texto) que indicam que o agente espera uma resposta sua (alimentam o estado *aguardando entrada*) |
| `paste` | Injeta as mensagens entre agentes por *bracketed paste* (ligado para agentes de interface de texto; desligado para shells) |

Exemplo:
```json
{ "id": "meu-agente", "name": "Meu Agente", "command": "meu-cli", "args": ["--modo", "seguro"],
  "env": {}, "resumeArgs": ["--continue"], "waitPatterns": ["\\(y/n\\)", "press enter"], "color": "#7aa2f7", "paste": true }
```

O agente roda **dentro do seu shell** (`pwsh`/PowerShell), então aliases e o `PATH` do seu usuário funcionam; quando o agente termina, o terminal continua útil.

> **Permissões dos agentes**: o Regente **não** liga modos de "pular permissões". Quando um agente pede aprovação de um comando, você aprova no terminal dele, como faria normalmente.

## Conectar agentes e orquestrar
**Criar uma conexão**: arraste o ponto da borda de um terminal até outro nó.

**Clicar na linha** abre as opções:
| Opção | Efeito |
|---|---|
| **Bidirecional** | Os dois lados podem enviar um ao outro (↔). Sem isso, só da origem para o destino (→) |
| **Exigir confirmação** | Cada mensagem pede a sua aprovação antes de ser entregue (🔒) |
| **Permitir teclas** | Deixa a origem enviar teclas cruas ao destino (`regente keys`), para operar menus interativos (⌨). Vale só no sentido origem → destino e não funciona em conexões que exigem confirmação |
| Excluir | Remove a conexão |

**Painel Atividade** (barra lateral) mostra, em ordem, o que foi enviado, perguntado, respondido ou **negado** (e por quê). O mesmo vai para o log `orchestration.jsonl`.

**Botão Pausar** (ou paleta → "Pausar orquestração"): bloqueia **todo** envio entre agentes, incluindo rotinas e o coordenador, até você despausar.

**Proteções automáticas**
- **Anti-loop**: uma cadeia de mensagens entre agentes tem profundidade máxima de 4 e vale por 10 minutos; digitar no terminal zera a cadeia.
- **Taxa**: no máximo 30 mensagens por minuto por agente.
- **Texto**: caracteres de controle e sequências de escape são removidos das mensagens.

Como as mensagens aparecem no destino: para agentes de interface de texto, entram por *bracketed paste* e Enter. Em um shell comum entram como **comentário** (`# …`), para nunca serem executadas.

## O CLI `regente` e o MCP
Dentro de qualquer terminal do Regente existem `REGENTE_PIPE`, `REGENTE_TOKEN`, `REGENTE_TERMINAL` e o `regente` no `PATH`.

| Comando | O que faz |
|---|---|
| `regente peers` | Lista quem está conectado a você (com direção, estado e status) e as notas |
| `regente send <par> <msg>` | Envia sem esperar |
| `regente ask <par> <pergunta> [--wait] [--timeout s]` | Pergunta; com `--wait` espera a resposta (padrão 300 s) |
| `regente reply <id> <resposta>` | Responde a uma mensagem recebida (o `id` vem na mensagem) |
| `regente read <par> [--last N]` | Últimas N linhas da saída do par |
| `regente ask --batch '{"a":"p1","b":"p2"}'` | Pergunta a vários em paralelo; devolve JSON `[{name, output\|error}]` |
| `regente note list \| read \| add \| edit \| write` | Notas conectadas (veja abaixo) |
| `regente status <texto> --state working\|blocked\|review\|done [--progress 2/5]` | Publica o seu status; aparece como *chip* no cabeçalho |
| `regente notify <msg>` | Notificação do sistema para o usuário (1 a cada 10 s) |
| `regente keys <par> "<teclas>"` | Teclas cruas: `\n` Enter, `\t` Tab, `\e` ESC, `\xNN`, `\\` |
| `regente debug` | Diagnóstico da conexão com o broker |
| `regente recruit \| connect \| dismiss` | Só para o [coordenador](#coordenador) |
| `regente mcp-config` | Imprime a configuração MCP |

Texto longo: use `-` para ler do stdin (`type msg.txt | regente send kiro -`).

**Notas** (`note`): `read <nota> [--offset N --limit N]` lê por faixa de linhas; `add` acrescenta; `edit <nota> "antigo" "novo"` troca um trecho que apareça **uma única vez**; `write` substitui tudo.

**Responder a uma pergunta**: quem recebe `[Regente] … (id abc123)` responde com `regente reply abc123 "…"`. Se o remetente usou `--wait`, a resposta volta para o comando dele.

**MCP**: `claude mcp add regente -- regente-mcp`. Funciona **somente** dentro de terminais do Regente. Ferramentas: `regente_peers`, `_send`, `_ask`, `_reply`, `_read`, `_status`, `_notify`, `_keys`, `_recruit`, `_connect`, `_dismiss`, `_note_list`, `_note_read`, `_note_edit`, `_note_write`, `_note_add`.

Referência técnica completa: [BROKER_PROTOCOL.md](BROKER_PROTOCOL.md).

## Coordenador
Um terminal pode ser promovido a **coordenador** (paleta → *Alternar coordenador (terminal selecionado)*; aparece 👑 no cabeçalho). Ele pode, pelo CLI/MCP:
- `regente recruit <perfil> [--name N] [--cwd pasta]`: cria um agente novo, já conectado a ele (bidirecional).
- `regente connect <a> <b> [--one-way]`: conecta dois agentes que ele gerencia.
- `regente dismiss <nome>`: encerra um agente que ele recrutou.

**Limites** (por segurança): máximo de **6** recrutados vivos por coordenador; recrutados **não** são coordenadores (sem recursão); só vale o **id/nome exato** do perfil; a pasta (`--cwd`) precisa ficar dentro do workspace; no máximo 10 operações de topologia por minuto; a **pausa global** bloqueia tudo; cada operação fica no log de auditoria.

## Rotinas agendadas
Paleta → **Rotinas agendadas…**. Uma rotina envia um texto a um agente (ou apenas lembra você) em horários definidos:
- **A cada N minutos**, **todo dia** (HH:MM), **toda semana** (dia + hora) ou **uma vez** (data e hora).
- **Pré-execução** (opcional): um comando PowerShell roda antes; a saída substitui `{{output}}` no texto. **Sem saída ou com erro, a rotina não dispara** (útil para "só acordar o agente se houver algo novo").
- **Lembrete**: só mostra um aviso para você, sem enviar ao agente.
- **Limite de execuções** e botão **Executar agora**.

Regras importantes: rotinas **só rodam com o workspace aberto no app**; diárias/semanais perdidas há mais de 2 horas são descartadas; a pausa global adia a rotina; **só a interface cria rotinas** (agentes não conseguem). A pré-execução tem limite de 60 s e de 8 KB de saída.

## Templates de equipe e papéis
- **Papel do agente**: paleta → *Definir papel (instrução inicial) do terminal selecionado*. O texto é enviado ao agente (se for um agente de interface de texto) e fica salvo no terminal.
- **Equipes (templates)**: paleta → **Equipes (templates)…**. *Salvar como template* guarda todos os terminais e notas do workspace, as conexões e os papéis. *Inserir* recria tudo num espaço livre do canvas, com nomes únicos; os agentes com papel recebem a instrução depois de iniciarem. Os templates ficam em `%APPDATA%\Regente\config\templates.json` e valem para qualquer workspace.

## Git worktree
No cabeçalho de um terminal, o botão **Criar git worktree** (ou a paleta) pergunta um nome, cria um *worktree* da pasta atual e abre um terminal do mesmo perfil nele. Assim cada agente trabalha numa cópia isolada do repositório, sem pisar no outro. O cabeçalho também mostra o **branch** e se há alterações não commitadas.

## Atalhos
| Atalho | Ação |
|---|---|
| `Ctrl+K` | Paleta de comandos |
| `Ctrl+Shift+F` | Busca global (nós, notas e saída dos terminais) |
| `Ctrl+B` | Abrir/fechar a barra lateral |
| `Ctrl` + roda / `Ctrl +` / `Ctrl −` | Zoom |
| `Ctrl+0` / `Ctrl+1` | Zoom 100 % / ajustar tudo |
| `Delete` | Excluir o nó ou a conexão selecionados |
| Clique duplo no cabeçalho | Renomear |

No macOS/Linux (quando suportados), `Ctrl` vira `⌘` onde aplicável.

## Configurações
Engrenagem na barra superior:
| Opção | Padrão | Efeito |
|---|---|---|
| Tema | Escuro | Claro/escuro |
| Idioma | Português (Brasil) | PT-BR / English |
| Tamanho e fonte do terminal | 13 · Cascadia Mono, Consolas | Aplica a todos os terminais |
| Scrollback (linhas) | 5000 | Histórico por terminal |
| Encaixar na grade / tamanho | desligado / 20 | Alinha nós ao arrastar |
| Alerta de RAM por terminal | 1500 MB | Aviso quando um terminal passa disso |
| Notificações nativas | ligado | Avisos do Windows quando um agente termina ou espera você |

## Dados, backup e importação
- Tudo fica em `%APPDATA%\Regente` (veja a tabela em [INSTALL.md](INSTALL.md#onde-ficam-os-seus-dados)).
- O workspace é salvo continuamente, com **backups rotativos** em `workspaces\<id>\backups\` e **recuperação** automática se o arquivo principal estiver corrompido.
- **Exportar** gera um arquivo `.json` do workspace.
- **Importar** (aba Workspaces → escolher arquivo): o Regente trata o arquivo como **não confiável**. Ele pergunta a **pasta raiz nesta máquina**, remove coordenador, permissão de teclas, papéis e rotinas, e passa **todas as conexões a exigir confirmação**. Revise e religue o que quiser.

## Solução de problemas
| Sintoma | O que fazer |
|---|---|
| `regente: variável REGENTE_PIPE ausente: execute dentro de um terminal do Regente` | O comando só funciona **dentro de um terminal do Regente**. Abra um terminal pelo app |
| `regente debug` mostra falha no broker | O app foi reiniciado e o terminal é antigo (o pipe muda a cada execução). **Feche e recrie o terminal** |
| `não autorizado` | O token do terminal foi invalidado (o terminal encerrou) ou você tentou falar em nome de outro. Recrie o terminal |
| `par '…' não encontrado entre as conexões deste terminal` | Não há conexão com esse nome. Rode `regente peers` e confira nomes e direção |
| `orquestração pausada pelo usuário` | Despause (botão Pausar ou paleta) |
| `limite de profundidade (4) excedido` | Possível loop entre agentes. Digite algo no terminal para zerar a cadeia e revise o fluxo |
| Agente não aparece na lista de perfis | O comando não está no `PATH` do Windows. Instale a ferramenta ou ajuste o comando do perfil |
| Mensagem aparece como `# …` num terminal | É esperado em shell comum (vira comentário). Agentes de interface de texto recebem a mensagem normalmente |
| Terminal "aguardando entrada" parado | O agente pediu aprovação; aprove no próprio terminal |
| App lento com muitos terminais | Afaste o zoom (< 30 %) para dormência; reduza o *scrollback*; veja o alerta de RAM |
| Aviso do SmartScreen na instalação | Veja [INSTALL.md](INSTALL.md#aviso-do-windows-smartscreen) |
| Rotina "ignorada" | A pré-execução não produziu saída (ou falhou). Teste o comando no PowerShell |

Ainda com problema? Abra uma *issue* com: versão do Regente, versão do Windows, o que você fez, o resultado de `regente debug` e (se possível) o conteúdo relevante de `%APPDATA%\Regente\logs\orchestration.jsonl` **sem dados sensíveis**.
