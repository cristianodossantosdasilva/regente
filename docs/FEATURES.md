# Funcionalidades e plano

Objetivo: orquestração automatizada de agentes de código num canvas, leve, local e gratuito (MIT). Legenda: ✅ pronto · 🔜 próximo · 📋 planejado.

## Núcleo de orquestração
| Função | Estado |
|---|---|
| Terminais reais (ConPTY) num canvas infinito; estado do agente; CPU/RAM | ✅ |
| Conexões direcionais, anti-loop, pausa global, confirmação humana, log de auditoria | ✅ |
| CLI `regente` e MCP: `peers`, `send`, `ask --wait`, `reply`, `read` | ✅ |
| `ask --batch` (vários agentes em paralelo, saída JSON) | ✅ |
| Notas compartilhadas: ler por faixa, `add`, `edit` por trecho único, `write` | ✅ |
| `peers` com nome próprio, estado ocioso/ocupado e notas travadas | 🔜 |
| `regente debug` (diagnóstico do pipe/token/terminal) | 🔜 |
| `status` de trabalho por terminal (estado + progresso) visível na barra lateral | 🔜 |
| `notify` ao usuário (notificação do sistema, com limite de taxa) | 🔜 |
| `keys`: enviar teclas/escapes a um par (menus interativos), com permissão por conexão | ✅ |
| Notas ligadas a arquivos `.md` externos (edição reflete no disco) e fichários (pilhas de notas) | 🔜 |
| Papel por agente (instrução inicial) | ✅ |
| Biblioteca de papéis/presets compartilhados e troca de agente mantendo posição e conexões | 📋 |
| Templates de equipe (salvar/instanciar agentes, notas, conexões e papéis) | ✅ |
| Criar/remover colegas e conexões por CLI (papel "coordenador": limite de 6, sem recursão, pausa e auditoria) | ✅ |
| Bandas (grupos de agentes que se alcançam entre si) | 📋 |
| Rotinas agendadas (a cada N, diária, semanal, única; pré-execução com `{{output}}`; lembretes; só criadas pela interface) | ✅ |
| Andares: worktrees por tarefa, checkout de PR, status e integração (`land`) | 📋 |
| Portal web controlável por agentes (árvore de acessibilidade com refs, clique, preencher, screenshot, logs do console, viewport/UA) | 📋 |
| Linux e macOS (broker por socket Unix; backend testado, interface a validar; sem instalador) | 🧪 |
| Ponte para agentes dentro do WSL | 📋 |
| Estado de terminal confiável com parser headless (ocioso, replay exato) | 📋 |

## Fora de escopo (decisão)
Telemetria, atualização automática pela rede, controle de outros aplicativos desktop e espelho de dispositivos Android (risco/custo altos para uso pessoal).
