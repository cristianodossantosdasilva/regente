# Modelo de segurança

O Regente executa **agentes de código** com acesso ao seu computador e deixa que eles conversem entre si. Este documento diz o que o app protege, o que **não** protege e quais são as limitações conhecidas. Para reportar uma falha, veja [SECURITY.md](../SECURITY.md).

## O que o Regente é (e não é)
- É um **orquestrador local**: um canvas de terminais, mais um servidor local (broker) que entrega mensagens entre eles.
- **Não é um sandbox.** Os agentes e qualquer processo que eles iniciem rodam **com as permissões do seu usuário do Windows**, como se você os tivesse aberto num terminal comum. O Regente não limita arquivos, rede ou processos desses programas.
- **Não liga modos de "pular permissões"** dos agentes. A aprovação de comandos continua sendo sua, no terminal do agente.

## Ativos protegidos
1. **O controle de quem fala com quem** (topologia e direção das conexões).
2. **O seu aval** em ações sensíveis (confirmação humana, pausa global).
3. **A integridade dos terminais** (ninguém digita num terminal que não deveria).
4. **Seus dados** em `%APPDATA%\Regente` e nos arquivos de workspace.

## Quem pode atacar
| Atacante | Exemplo |
|---|---|
| **Agente induzido (prompt injection)** | Um agente lê uma página/arquivo/issue com instruções hostis e tenta agir além do que deveria |
| **Código de terceiros num terminal** | Um script de `npm`, um pacote ou um repositório clonado, executado por um agente, tenta usar o broker |
| **Arquivo de workspace malicioso** | Um `.json` compartilhado que tenta abrir já com poderes (coordenador, teclas, rotinas) |
| **Outro usuário/processo local** | Quer falar com o broker sem ser um terminal do app |
| **Rede** | Tenta alcançar o broker ou o app de fora |

## Proteções

### Identidade e acesso ao broker
| Proteção | Como |
|---|---|
| Só local | Named pipe com recusa de clientes remotos; nenhuma porta de rede é aberta |
| Identidade por terminal | Cada terminal recebe um **token próprio** (256 bits). O remetente é **deduzido do token**; o campo `from` enviado pelo cliente é só conferido, e divergência é negada e registrada. Um agente **não consegue se passar por outro** terminal, mesmo conhecendo o id dele |
| Revogação | O token é invalidado quando o terminal encerra |
| Sem rotinas pelo pipe | Não existe método de rotina no broker: agentes não criam nem disparam rotinas nem pré-execuções |

### Autorização das ações
| Proteção | Como |
|---|---|
| Alcance = conexões | Um agente só enxerga e endereça pares **conectados a ele**; a direção importa |
| Confirmação humana | Opcional por conexão; a pausa e a conexão são **reconferidas depois** que você aprova |
| `keys` | Exige "Permitir teclas" na conexão, só no sentido origem→destino, e é **recusado** em conexões que exigem confirmação |
| Coordenador | Precisa ser marcado por você; limite de 6 recrutados; recrutados não coordenam; só perfil por id/nome **exato**; `cwd` dentro do workspace; 10 operações/min; tudo no log |
| Pausa global | Bloqueia mensagens, respostas, `keys`, rotinas e o coordenador; é reconferida imediatamente antes de cada efeito |
| Anti-loop e taxa | Profundidade máxima 4 (10 min), 30 mensagens/min por agente, `notify` 1/10 s, `status` 1/2 s |

### Entrada não confiável
| Proteção | Como |
|---|---|
| Sanitização de texto | Caracteres de controle (inclui ESC), separadores de linha Unicode, marcas bidi e zero-width são removidos de mensagens, respostas, status, nomes e notificações |
| Injeção segura | Em shell comum a mensagem entra como **comentário**; em agentes de interface de texto, por *bracketed paste* |
| Tetos de tamanho | Mensagem 32 KiB, nota 256 KiB, linha do pipe 1 MiB |
| Workspaces importados | Tratados como **não confiáveis**: você escolhe a pasta raiz; coordenador, teclas, papéis e rotinas são removidos; toda conexão passa a exigir confirmação |
| Conteúdo exibido | HTML cru em Markdown é descartado; links só `http(s)`/`mailto`/relativos; navegador embutido só `localhost`; CSP restrita |
| Pré-execução de rotinas | Só a interface cria; limite de 60 s e 8 KB; sem saída ou com erro, a rotina **não** dispara; rotinas de arquivos importados vêm desligadas |

### Privacidade
Sem telemetria, sem atualização automática, sem rede por padrão. Segredos (token) não são gravados em logs nem em eventos.

## O que o Regente **não** garante (limites conhecidos)
Estes pontos são conhecidos e estão documentados por honestidade; contribuições para resolvê-los são bem-vindas.

1. **O token vale para todo processo do terminal.** Qualquer programa que um agente execute naquele terminal herda `REGENTE_TOKEN` e pode usar as permissões **daquele terminal** (não as de outros). É inerente ao modelo; proteja-se limitando o que os agentes executam.
2. **`read` e as notas expõem texto.** Um agente conectado pode ler a saída do par e as notas conectadas, inclusive segredos que apareçam ali.
3. **Mensagens entre agentes são texto não confiável.** O Regente impede injeção de escapes, mas não impede que um agente receba **instruções** hostis de outro e as obedeça. Use confirmação humana em conexões sensíveis.
4. **Shell comum e `cmd.exe`.** O "vira comentário" depende de o shell tratar `#` como comentário (PowerShell e shells POSIX tratam; `cmd.exe` **não**). Os terminais de shell do app usam PowerShell por padrão, mas um perfil que rode `cmd.exe` deve ficar com `paste` desligado e ser tratado como não seguro para receber mensagens. *(Mitigação planejada: nunca injetar texto em shell.)*
5. **Mensagens pendentes sem validade.** Uma pergunta sem resposta fica registrada até o app fechar. Não é um vazamento, mas é uma pequena retenção de memória.
6. **Log de auditoria** rotaciona em 5 MB mantendo uma cópia; um agente barulhento pode empurrar entradas antigas para fora.
7. **Nome do pipe previsível** (`regente-broker-<pid>`). O broker cria a primeira instância e rejeita remotos, e o token impede uso por quem não é um terminal do app.
8. **Sem assinatura de código por autoridade certificadora** nas versões publicadas (veja [INSTALL.md](INSTALL.md)). Confira o SHA-256.

## Revisões
O código de orquestração foi revisado por agentes de código independentes durante o desenvolvimento (relatórios resumidos em [REVIEWS.md](REVIEWS.md)). As correções vieram com testes. Uma auditoria humana externa **ainda não foi feita**: se você tem experiência, leia o broker e abra uma issue ou um aviso de segurança.

## Contribuindo com segurança
Qualquer mudança em `broker.rs`, `orchestrator.rs`, `state.rs`, `pty.rs`, `actions.ts` (coordenador, importação, rotinas) ou `lib/workspace.ts` (`migrate`, `hardenImported`) **precisa** de teste cobrindo o caso negativo (o que deve ser recusado) e seguir as invariantes de [ARCHITECTURE.md](ARCHITECTURE.md#decisões-e-invariantes-não-quebre-sem-discutir).
