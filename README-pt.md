**English** · [中文](./README-zh.md) · [Español](./README-es.md) · [Português](./README-pt.md) · [हिन्दी](./README-hi.md)

<img src="docs/assets/logo_phocinae.png" width="120" alt="Logotipo Phocinae">

# dsh-phocinae

**Uma camada de decisão local e não generativa para o DeepSeek Harness.** Um modelo de 150M responde sim/não, escolha única e notas 2–10 em uma passada, e um portão fail-closed verifica chamadas de ferramentas antes de executá-las.

- Roda na sua máquina; sem API na nuvem, sem chave.
- `phocinae_ask` para decisões tipadas em lote; `phocinae_gate` para um comando ou ação.
- O portão pluga em `tools/pre-execute`: serviço inacessível → pergunta a uma pessoa, nunca permite em silêncio.
- O modelo não escreve prosa nem código. Faz uma decisão estruturada.

## Início rápido

```sh
pip install phocinae-server
huggingface-cli download Phocinae/Phocinae-Largha-150M-v1 --local-dir ./model
PHOC_MODEL_DIR=./model python -m phocinae.main
dsh plugin --profile web add dsh-phocinae@0.2.5
curl http://127.0.0.1:8155/health
```

`{"status":"ok","model_loaded":true}` significa que o serviço está pronto. Fixe `dsh-phocinae@0.2.5`: um `add dsh-phocinae` sem versão pode resolver para uma build antiga enquanto o `minimumReleaseAge` do pnpm segura uma release recente.

## O que você recebe

| Superfície | O que faz |
|---|---|
| `phocinae_ask` | Até 64 perguntas tipadas sobre um estado; devolve respostas, confiança calibrada e um indicador `escalate`. |
| `phocinae_gate` | Julga um comando ou ação como `allow`, `ask` ou `deny`; verifica sem executar. |
| Portão `tools/pre-execute` | Verifica cada chamada que casa com `gate.tools` antes de executar; fail-closed. |
| Skill `phocinae` | Ensina o modelo quando usar uma decisão local e como ler `escalate`. |

## Exemplos

Faça duas perguntas sobre um estado:

```json
{"state":"O usuário quer apagar /tmp/build. O caminho está dentro do workspace.","questions":[{"id":"safe","type":"noul","threshold":0.8},{"id":"urgency","type":"score"}]}
```

A forma da resposta é:

```json
{"answers":{"safe":true,"urgency":4},"confidence":{"safe":0.92,"urgency":0.71},"escalate":false}
```

Julgue um comando perigoso:

```json
{"command":"rm -rf /","toolName":"shell","cwd":"/home/me/project"}
```

Devolve `decision: "deny"` com motivo e confiança; o comando nunca é executado. Essas saídas ilustram o schema, não são um fixture gravado.

## Como funciona

1. O host chama `phocinae_ask`, `phocinae_gate` ou o portão pre-execute.
2. O plugin envia o estado bruto para `http://127.0.0.1:8155/v1/systemone`.
3. O serviço devolve uma resposta estruturada por pergunta.
4. O portão mapeia para `allow` / `ask` / `deny`; baixa confiança vira `escalate` e serviço inacessível vira `ask` com `failMode: closed`.

## Configuração

Os padrões ficam em `cordis.patch.yml` e `lib/config.mjs`. Toda chave tem padrão.

| Chave | Padrão | Significado |
|---|---|---|
| `endpoint` | `http://127.0.0.1:8155/v1/systemone` | Serviço de decisão. Somente loopback, salvo `allowRemoteEndpoint: true`. |
| `timeoutMs` | `3000` | Tempo por requisição; uma tentativa. |
| `escalateAt` | `0.6` | Confiança abaixo disso marca `escalate: true`. |
| `gate.mode` | `harm` | `harm`, `tri-state`, `noul` ou `off`. |
| `gate.tools` | `['*']` | Ferramentas a verificar: nome exato, glob ou `*`. |
| `gate.failMode` | `closed` | `closed` pergunta a uma pessoa se o serviço cair; `open` permite. |

Para usar só as ferramentas e não verificar nada:

```yaml
- id: phocinae
  config:
    gate:
      mode: off
```

## Segurança e limites

- **Somente loopback.** O estado contém texto bruto da chamada; endpoint não loopback é erro de carga salvo permissão explícita.
- **Fail-closed.** Erros/timeouts do serviço mandam a chamada para uma pessoa; nome de ferramenta ausente não é considerado seguro.
- **Não é sandbox.** O portão é um sinal extra de aprovação, não substitui o sandbox do host nem a aprovação humana.
- **Não gera conteúdo.** O modelo não responde perguntas de conhecimento, não escreve código nem resume; use um modelo de chat para isso.

## Compatibilidade

- Node `^22.19` ou `>=24`.
- DSH `>=0.2.1-0 <0.3.0`; a linha do bundle monta `phocinae_ask`, `phocinae_gate`, o portão e a skill.
- `phocinae-server` precisa estar acessível no endpoint configurado.

## Solução de problemas

| Sintoma | Correção |
|---|---|
| `PHOCINAE_SERVICE_UNAVAILABLE` | Inicie o serviço e verifique `curl http://127.0.0.1:8155/health`. |
| Add sem versão instala versão antiga | Reinstale com `dsh-phocinae@0.2.5`; veja `dsh --profile web --dump-config`. |
| O portão pergunta por tudo | Confirme que o serviço está ativo; com `failMode: closed` um serviço caído pergunta de propósito. |
| O portão é rígido/frouxo demais | Ajuste `gate.mode`, `gate.tools`, `gate.minConfidence`, `gate.autoAllow`; não desligue às cegas. |

## Licença

Apache-2.0. O cartão do modelo e o servidor são projetos separados: [Phocinae-Largha-150M-v1](https://huggingface.co/Phocinae/Phocinae-Largha-150M-v1) e [phocinae-server](https://github.com/Phocinae/phocinae-server).
