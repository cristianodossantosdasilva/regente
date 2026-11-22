# Política de segurança

O Regente executa agentes de código e media a comunicação entre eles; levamos a segurança a sério. O modelo de ameaças e as limitações conhecidas estão em [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md).

## Versões suportadas
Enquanto o projeto estiver na série **0.x**, apenas a **versão mais recente** recebe correções de segurança.

## Como reportar uma vulnerabilidade
**Não abra uma issue pública** para falhas de segurança.

1. Use o recurso **"Report a vulnerability"** (aba *Security* → *Advisories*) do repositório no GitHub, que abre um relato **privado** com os mantenedores.
2. Se esse recurso não estiver disponível, abra uma issue pública **apenas pedindo um canal privado de contato**, sem detalhes técnicos.

Inclua, se possível:
- versão do Regente e do Windows;
- passos para reproduzir e o impacto (o que um atacante consegue);
- se envolve um agente induzido (prompt injection), código de terceiros num terminal, um workspace importado ou outro processo local;
- uma sugestão de correção, se tiver.

## O que esperar
- Confirmação do recebimento em alguns dias (o projeto é mantido por voluntários).
- Avaliação, correção com **teste que reproduz o problema** e liberação de uma versão corrigida.
- Crédito no CHANGELOG, se você quiser.
- Pedimos **divulgação coordenada**: aguarde a correção antes de publicar detalhes.

## O que é e o que não é uma vulnerabilidade
**É** (exemplos): um agente conseguir se passar por outro terminal; contornar a pausa global, a confirmação humana ou a permissão de teclas; criar/disparar rotinas ou executar comandos pelo broker sem ação do usuário; um workspace importado ganhar poderes sem aviso; injeção de sequências de escape ou de comandos em terminais; vazamento de token; acesso ao broker por outro usuário ou pela rede.

**Não é** (comportamento esperado, descrito no modelo de segurança): um agente executando comandos com as permissões do seu usuário (o Regente não é um sandbox); um processo **dentro de um terminal** usando o token **daquele** terminal; mensagens de um agente contendo instruções que outro agente decide obedecer.

## Boas práticas para usuários
- Conecte apenas agentes que você deseja que conversem; use **confirmação humana** em conexões sensíveis.
- Não ative "Permitir teclas" sem necessidade.
- Revise workspaces e templates de terceiros antes de usar; rotinas importadas vêm desligadas.
- Confira o SHA-256 do instalador.
