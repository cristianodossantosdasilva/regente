# Protocolo do broker

O broker é o servidor local do Regente. O CLI `regente`, o servidor `regente-mcp` e qualquer integração própria falam com ele por este protocolo. Estável o suficiente para uso, mas ainda **0.x**: pode mudar entre versões (veja o [CHANGELOG](CHANGELOG.md)).

## Transporte
- **Windows**: *named pipe* `\\.\pipe\regente-broker-<pid do app>`, com `reject_remote_clients` (clientes remotos são recusados).
- O nome do pipe, o token e o id do terminal chegam ao processo pelas variáveis de ambiente do terminal:

| Variável | Conteúdo |
|---|---|
| `REGENTE_PIPE` | Caminho do pipe |
| `REGENTE_TOKEN` | Segredo **deste terminal** (256 bits, gerado ao criar o PTY, revogado ao encerrá-lo) |
| `REGENTE_TERMINAL` | Id deste terminal (informativo; o broker não confia nele) |

- **Uma requisição por conexão**: abra o pipe, escreva **uma linha** JSON terminada em `\n`, leia **uma linha** de resposta e feche. Se o pipe estiver ocupado (erro 231), tente de novo após ~100 ms (o cliente oficial faz até 20 tentativas).
- Linha de requisição: no máximo **1 MiB** (acima disso o broker responde erro e fecha).

## Formato
Requisição:
```json
{"id": 1, "method": "ask", "params": {"token": "<REGENTE_TOKEN>", "to": "kiro", "body": "revise X", "wait": true, "timeoutS": 300}}
```
Resposta de sucesso: `{"id": 1, "result": { ... }}`  
Resposta de erro: `{"id": 1, "error": {"message": "texto legível"}}`

- `params.token` é **obrigatório**. O remetente é deduzido dele. Se `params.from` vier e for diferente do dono do token, a chamada é negada (`não autorizado`) e a tentativa é registrada.
- Mensagens de erro são em português e destinadas a humanos/agentes; **não** faça parsing delas. Use apenas a presença de `error`.

## Métodos

Legenda de permissões: **P** = respeita a pausa global; **C** = só coordenador; **conexão** = só para pares conectados (direção importa).

### Descoberta e diagnóstico
| Método | Params | Resultado |
|---|---|---|
| `ping` | — | `{ok, version, terminal{id,name,profile}, paused, connections, notes}` |
| `peers` | — | `{self{id,name,profile,state,work}, peers[{id,name,profile,canSend,canReceive,state,work}], notes[{id,title}], paused}` |

### Mensagens
| Método | Params | Resultado | Regras |
|---|---|---|---|
| `send` | `to`, `body` | `{id}` | P, conexão, anti-loop, 30/min, ≤ 32 KiB; confirmação humana se a conexão a exigir |
| `ask` | `to`, `body`, `wait?`, `timeoutS?` (5–3600, padrão 300) | `{id}` ou, com `wait`, `{id, reply}` | Igual a `send`; com `wait` bloqueia até o par responder ou estourar o tempo |
| `reply` | `id`, `body` | `{ok}` | P; só o destinatário da mensagem `id`; ≤ 32 KiB; o texto é sanitizado |
| `read` | `peer`, `last?` (1–500, padrão 40) | `{text}` | conexão; saída recente do par sem sequências ANSI |
| `keys` | `to`, `keys` | `{text, to}` | P, conexão, a conexão precisa ter **Permitir teclas** (origem→destino) e **não** exigir confirmação; escapes `\n` `\t` `\e` `\xNN` `\\`; ≤ 512 bytes; devolve as últimas linhas do alvo |

Resolução de `to`/`peer`: id, nome exato ou prefixo único do nome, **entre as conexões do remetente**.

### Notas (somente notas conectadas ao terminal)
| Método | Params | Resultado | Regras |
|---|---|---|---|
| `note_list` | — | `{notes[{id,title}]}` | |
| `note_read` | `note`, `offset?` (1-based), `limit?` | `{title, text, totalLines}` | sem offset/limit devolve tudo |
| `note_add` | `note`, `text` | `{ok}` | P; acrescenta ao final; nota ≤ 256 KiB |
| `note_edit` | `note`, `old`, `new` | `{ok}` | P; falha se `old` não existir ou aparecer mais de uma vez |
| `note_write` | `note`, `text` | `{ok}` | P; substitui todo o conteúdo; ≤ 256 KiB |

### Status e notificação
| Método | Params | Resultado | Regras |
|---|---|---|---|
| `status` | `text` (≤ 120), `state` (`working`\|`blocked`\|`review`\|`done`), `progress?` (`n/m`) | `{ok}` | 1 a cada 2 s por terminal |
| `notify` | `text` (≤ 500) | `{ok}` | P; 1 a cada 10 s por terminal |

### Coordenador (C, P)
Exigem que o terminal tenha sido marcado como coordenador pelo usuário.
| Método | Params | Resultado | Regras |
|---|---|---|---|
| `recruit` | `profile` (id ou nome exato), `name?`, `cwd?` | `{id, name, profile}` | Máx. 6 vivos por coordenador; `cwd` dentro do workspace; o recrutado nasce conectado (bidirecional) e **sem** ser coordenador |
| `connect` | `a`, `b`, `bidirectional?` (padrão `true`) | `{ok}` | Só entre o coordenador e os que ele recrutou; sem duplicar |
| `dismiss` | `name` | `{ok}` | Só recrutados por ele; não dispensa a si mesmo |

`recruit`, `connect` e `dismiss` somam no máximo **10 operações por minuto** por coordenador.

## Eventos para a interface (não fazem parte do protocolo do pipe)
O broker emite eventos Tauri que a interface consome: `activity`, `confirm-request`, `note-updated`, `work-status`, `agent-notify`, `coord-request`. Os comandos Tauri `confirm_answer` e `coord_answer` voltam ao broker. Não são acessíveis pelo pipe.

## Auditoria
Toda ação relevante (e toda negação) gera uma entrada `{id, ts, kind, from, to, depth, body}` com `kind` em `send`, `ask`, `reply`, `read`, `keys`, `note`, `status`, `notify`, `recruit`, `connect`, `dismiss`, `routine`, `denied`. Fica em memória (2000) e em `%APPDATA%\Regente\logs\orchestration.jsonl`.

## Implementação de referência
O cliente oficial está em [`cli/src/lib.rs`](../cli/src/lib.rs) (função `call`): abre o pipe com repetição em caso de ocupado, injeta `token` nos `params`, escreve a linha e lê a resposta. Os testes de integração em [`src-tauri/tests/broker_e2e.rs`](../src-tauri/tests/broker_e2e.rs) exercitam **todos** os métodos contra um broker real com PTYs reais e são a melhor fonte de exemplos executáveis.
