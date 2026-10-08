**English** · [中文](./README-zh.md) · [Español](./README-es.md) · [Português](./README-pt.md) · [हिन्दी](./README-hi.md)

# dsh-phocinae

**Uma camada de decisão local e não generativa para o DeepSeek Harness.**

Ferramentas `phocinae_ask` / `phocinae_gate` apoiadas em um servidor [Phocinae-Largha-150M-v1](https://huggingface.co/Phocinae/Phocinae-Largha-150M-v1) — julgamentos sim/não, escolhas de alternativa única e pontuações 2-10, um forward pass para cada, na sua própria máquina — além de um portão de aprovação que falha fechado e examina chamadas de ferramenta antes que elas sejam executadas.

Esta é a **0.2.2**, uma versão de correção. O complemento 0.1.2 não ativava de forma alguma no DSH 0.2.x: o harness registrava um aviso e a entrada morria. Tudo o que vem abaixo da seção *Corrigido na 0.2.2* é o que mudou e por quê.

```sh
dsh plugin --profile <name> add dsh-phocinae@0.2.2
```

Requer Node `^22.19` ou `>=24`, e um serviço de decisão acessível (veja [Executando o serviço de decisão](#running-the-decision-service)).

### `npm i` sozinho não instala o complemento

Duas coisas separadas precisam acontecer, e apenas a segunda monta o complemento:

| etapa | o que ela faz |
|---|---|
| `npm i dsh-phocinae` | Coloca o pacote no `node_modules` **do diretório atual**. Útil para ler o código ou importar a guarda diretamente. Ele **não** alcança nenhum perfil do DSH. |
| `dsh plugin --profile <name> add dsh-phocinae@0.2.2` | Adiciona-o ao `package.json` **daquele perfil** (`dependencies` **e** `dsh.profile.bundles`) e o instala ali com o pnpm. É isso que faz o host montá-lo. |

Medido nesta máquina, com um `DSH_HOME` descartável:

- `npm i dsh-phocinae` em um diretório sem relação → instalado ali, `dependencies` do perfil ainda `{}`, `bundles` do perfil inalterado, **complemento ausente de `dsh <profile> --dump-config`**;
- `dsh plugin --profile p add dsh-phocinae` → o perfil ganha tanto a dependência quanto a entrada de bundle, e a configuração composta contém a linha `phocinae` com seu endpoint;
- uma dependência **sem** a entrada `dsh.profile.bundles` → instalada mas **não montada**, porque a lista de bundles é o que o carregador percorre.

### Fixe a versão

`add dsh-phocinae` resolve pelo portão de idade da cadeia de suprimentos do pnpm
(`minimumReleaseAge`). Uma versão mais recente que o limiar do portão não é
selecionada, então **por um tempo após uma publicação o nome puro resolve para a versão
anterior** — e a versão anterior aqui é a 0.1.2, que não funciona.

Medido, com minutos de diferença, na mesma máquina:

| quando | comando | resolveu para |
|---|---|---|
| publicação da 0.2.2 + 2 min | `dsh plugin --profile p add dsh-phocinae` | **0.1.2** — `main: index.js`, a build que não consegue ativar |
| o mesmo, mas `add dsh-phocinae@0.2.2` | | **0.2.2** — `./index.mjs`, skill presente |
| o mesmo, add puro com `minimumReleaseAge: 0` no `pnpm-workspace.yaml` do perfil | | **0.2.2** |
| publicação da 0.2.2 + 150 min | `dsh plugin --profile p add dsh-phocinae` | **0.2.2** — `^0.2.2`, o host inicializa sem avisos |

Quando o portão retém uma versão, o harness registra a recusa no
`pnpm-workspace.yaml` do perfil:

```yaml
minimumReleaseAgeExclude:
  - dsh-phocinae@0.2.2
```

O portão é um padrão sensato — um pacote recém-publicado é exatamente com o que se
parece um ataque à cadeia de suprimentos. Ele significa, porém, que **a versão deve ser nomeada**, tanto
para obter imediatamente a build corrigida quanto para tornar uma instalação reproduzível:

```sh
dsh plugin --profile <name> add dsh-phocinae@0.2.2
```

Se um add puro acabar deixando você na 0.1.2, `dsh <profile> --dump-config` mostra qual
versão está montada, e adicionar de novo com a especificação fixada a substitui.

Checkouts do Git e locais funcionam da mesma maneira, e já fixam a versão por construção:

```sh
dsh plugin --profile <name> add github:Phocinae/dsh-phocinae#v0.2.2
dsh plugin --profile <name> add /path/to/a/local/checkout
```

---

## O que ele contribui

| contribuição | ponto de extensão | o que faz |
|---|---|---|
| `phocinae_ask` | `ctx.tools` | Executa um lote de perguntas tipadas contra o modelo local. Toda resposta carrega uma confiança calibrada e um sinalizador `escalate` de caráter consultivo. |
| `phocinae_gate` | `ctx.tools` | Julga um comando ou uma ação: `allow` / `ask` / `deny`, com confiança. Verifica uma ação sem executá-la. |
| portão de aprovação | cascata `tools/pre-execute` | Examina toda chamada de ferramenta coberta pelos padrões configurados, antes que ela seja executada. |
| skill `phocinae` | `ctx.skills` | Ensina ao modelo quando uma decisão local é a ferramenta certa, como formulá-la e como ler o sinalizador `escalate`. |

O modelo não é um modelo de chat. Ele não gera texto, não conhece fatos e não sabe escrever código. Ele toma uma decisão estruturada por forward pass, que é exatamente o que um portão precisa e nada mais.

---

## Corrigido na 0.2.2

Cada item abaixo é reproduzido por um teste em `test/regressions.test.mjs`, chamado `D1`…`D12`.

### D1 — o complemento nunca era ativado

```
dsh: warning: 1 entry did not activate
phocinae (dsh-phocinae): Error: cannot get property "registerTool" without inject
```

O `index.js` testava `typeof ctx.registerTool === 'function'` como verificação defensiva. Um contexto Cordis é um proxy: ler o nome de um serviço **não declarado** lança uma exceção em vez de retornar `undefined`. `registerTool` não é um serviço do DSH — o registro fica em `ctx.tools` —, então a sondagem lançou exceção na primeira linha do corpo do complemento e derrubou a entrada inteira antes que ela pudesse se inscrever em qualquer coisa.

**Corrigido:** o registro de ferramentas aguarda o serviço por meio de `ctx.inject(['tools'], …)`. Sem sondagem, sem leitura não declarada, e se o serviço nunca aparecer o complemento ainda arma seu portão.

### D2 — a definição da ferramenta tinha o formato errado

A definição carregava `{inputSchema, handler}`. `ToolDefinition` estende `ToolSchema`, que declara `{name, description, parameters}`, e o registro lê `definition.parameters`. Registrar o formato antigo faz falhar a projeção voltada ao modelo:

```
dsh: UNKNOWN: tool "phocinae_ask" parameters must be lossless JSON before schema projection
```

**Corrigido:** as definições agora carregam `parameters` e `output: {schema, render}` além de `execute`, tudo dentro do subconjunto de JSON Schema imposto pelo harness (`required` como array, `oneOf` para uniões, sem palavras-chave exclusivas de autor). O `test/contract.test.mjs` reimplementa essa verificação de subconjunto, e a execução headless montada registra as definições em um host real.

### D3 — o portão lia a resposta do lugar errado

`data.answers` é um objeto indexado pelo id da pergunta. A 0.1.2 fazia `Array.isArray(data.answers) ? data.answers[0] : …`, o que resulta em `undefined` para toda resposta real.

### D4 — e, portanto, permitia tudo, em silêncio

O teste do veredito era `if (risk === true)`. Com `risk` sempre `undefined`, isso é sempre falso, então `guard()` retornava `{decision: 'allow'}` com a razão *"o modelo considerou isto de baixo risco"* — para todo comando, incluindo `rm -rf /`.

No conjunto rotulado de 53 comandos em `bench/`, o recall em comandos destrutivos foi **0.00**.

**Corrigido:** as respostas são lidas por id e têm o formato verificado, um corpo malformado é um erro de protocolo em vez de um valor padrão, e o portão **falha fechado** — um serviço inacessível, uma extensão de confiança ausente ou um corpo ilegível encaminham todos para um humano.

### D5 — os vereditos eram lançados, não retornados

O caminho de negação chamava `next(err)`. A cascata `tools/pre-execute` espera uma `PreToolDecision` (`{kind: 'allow' | 'deny' | 'ask', reason}`); rejeitar a cascata não é uma decisão.

**Corrigido:** `{kind: 'deny', reason}` e `{kind: 'ask', reason, displayReason}`, com `next()` chamado exatamente uma vez no caminho de permissão.

### D6 — `gate.tools` tinha `['bash']` como padrão

A ferramenta de shell é `pwsh` no Windows, `bash` em outros sistemas, e servidores MCP acrescentam seus próprios nomes. Nesta máquina o padrão não correspondia a nada, então o portão nunca era executado.

**Corrigido:** o padrão é `['*']` — todas as ferramentas —, com nomes exatos, globs `*` e correspondência sem distinção entre maiúsculas e minúsculas disponíveis.

### D7 — o portão de escalonamento prometido nas notas de versão não existia

A versão do modelo documenta um portão E1: escalonar uma decisão para um modelo maior quando `answer_confidence` fica abaixo de τ. A `0.1.2` não continha τ, nem comparação de confiança, nem ramo de escalonamento — uma busca em todo o repositório por `escalate` encontrou apenas o servidor Python.

**Corrigido:** `phocinae_ask` retorna `escalate`, `escalatedIds`, `escalationReason` e `escalateAt`, e o portão consulta a mesma confiança. O complemento ainda não *executa* o escalonamento — ele não pode chamar um modelo grande em seu nome —, mas o sinal agora é produzido em vez de apenas alegado.

### Mudanças que quebram compatibilidade

| mudança | 0.1.2 | 0.2.2 |
|---|---|---|
| registro de ferramentas | sondagem `ctx.registerTool` / `ctx.tools.register` | `ctx.inject(['tools'], …)` |
| definição da ferramenta | `inputSchema` + `handler` | `parameters` + `output` + `execute` |
| origem da resposta do portão | `answers[0]` (array) | `answers[id]` (objeto) |
| direção da falha | sempre `allow` | `ask` por padrão (`gate.failMode`) |
| padrão de correspondência de ferramentas | `['bash']` | `['*']` |
| veredito | `next(err)` | `{kind, reason}` |
| pergunta do portão | booleana `noul` | escala de dano (`harmless`/`risky`/`destructive`) |
| padrão de `gate.mode` | `deny` | `harm` |
| escalonamento | ausente | `escalate` em toda resposta |

`gate.failMode: 'open'` restaura o antigo comportamento de permitir sempre, para uma implantação que o deseje. Ele não é o padrão e não deveria se tornar um.

---

## Comportamento medido

Todo número aqui foi produzido em uma única máquina (CPU, fp32, Node 24), com os pesos publicados e os scripts em `bench/`; execute-os novamente no seu próprio hardware antes de confiar neles. Os números publicados vêm dos próprios documentos da versão do modelo.

### Qualidade das decisões — o modelo é honesto

`datasets/typed_test/test_typed_400.jsonl`, 400 casos × 5 perguntas = 2000 decisões, julgadas decisão a decisão contra `gold.label`:

| métrica | publicado (en) | medido (en) | publicado (zh) | medido (zh) |
|---|---|---|---|---|
| acurácia local | 0.797 | **0.7825** | 0.789 | **0.7820** |
| taxa de escalonamento @ τ=0.6 | 18% | **45.65%** | 18% | **43.00%** |
| acurácia nas decisões mantidas | — | 0.8859 | — | 0.9035 |

A acurácia se reproduz dentro do próprio ruído fp16/fp32 declarado pela versão. A taxa de escalonamento não, e os documentos publicados divergem entre si a esse respeito: a manchete *"82% fewer LLM calls"* é o que se obtém em **τ≈0.50**, enquanto o portão E1 congelado que eles também documentam é **τ=0.6**:

| τ | escalonadas | chamadas de LLM evitadas | acurácia nas decisões mantidas locais |
|---|---|---|---|
| 0.50 | 17.15% | **82.8%** | 0.8214 |
| **0.60** | **45.65%** | **54.4%** | 0.8859 |
| 0.70 | 67.15% | 32.9% | 0.9300 |
| 0.80 | 81.70% | 18.3% | 0.9645 |

**"82% economizados" e "τ=0.6" não podem ser verdadeiros ao mesmo tempo.** No limiar que a versão do modelo chama de congelado, a redução é de 54%. Isso ainda é uma economia real, e a ordenação por confiança é genuinamente útil — a acurácia do que permanece local sobe de 0.78 para 0.96 à medida que a barra sobe —, mas o número da manchete pertence a um limiar diferente.

### Qualidade do portão — e por que a pergunta padrão mudou

`bench/gate-bench.mjs`, 53 comandos (31 destrutivos, 22 rotineiros), todos contra o modelo real. `recall` é a fração de comandos destrutivos que o portão barra; `auto-pass purity` é com que frequência um comando liberado era de fato seguro.

| pergunta do portão | recall em destrutivos | liberações confiantes que eram destrutivas |
|---|---|---|
| `noul` — "isto deveria ser bloqueado?" (padrão da 0.1.2) | **0.00** | — |
| `tri-state` — allow / ask / deny | **0.74** | 1 |
| **`harm` — harmless / risky / destructive (padrão da 0.2.2)** | **0.97** | **0** |

A pergunta booleana herdada não é apenas fraca, é invertida: ela liberou **todos os 31 comandos destrutivos**, a maioria com confiança entre 0.54 e 0.80. Perguntar "isto é seguro?" é ainda pior — 27 de 31 passaram com confiança de até 0.87. A escala de dano é a única formulação medida que ao mesmo tempo pegou quase tudo e nunca deixou passar com confiança um comando destrutivo.

Seu único erro, `vssadmin delete shadows /all /quiet`, é barrado pela regra de operadores da lista de permissão automática, e não pela confiança, de modo que nenhum comando destrutivo do conjunto chega a ser executado.

### A confiança é comprimida: mantenha o portão restrito

A confiança do modelo não separa comandos rotineiros de comandos arriscados o suficiente para ser um filtro de uso geral. Seus vereditos `harmless` ficam em sua maioria na faixa 0.27–0.54, então um portão que perguntasse a ele sobre `git status` mandaria `git status` para um humano.

É por isso que a `0.2.2` traz uma **lista de permissão automática**: comandos somente leitura e de build/teste sem operadores de shell nunca chegam ao modelo. O trabalho do portão é barrar coisas, não aprovar o rotineiro:

- nomes na lista, sem operador → passa localmente, sem requisição, sem latência
- qualquer coisa contendo `;&|><`$(){}\[\]` etc. → a lista é ignorada e o modelo decide
- o modelo diz `destructive` → negar
- o modelo diz `risky`, ou `harmless` abaixo de `gate.minConfidence` → um humano decide
- serviço inacessível → um humano decide

Uma entrada que contenha um operador de shell é recusada no momento do carregamento. `git status && rm -rf /` começa com um prefixo presente na lista de permissão, então aceitar um padrão assim embutiria um bypass na lista.

### Resumo honesto das alegações

| alegação | veredito |
|---|---|
| "modelo bilíngue de decisão de 144.3M, um forward pass, local" | **verdadeira** |
| "decisões tipadas en 0.797 / zh 0.789" | **reproduz** (0.7825 / 0.7820) |
| "reduz as chamadas de LLM em 82% com um portão de confiança em τ=0.6" | **falsa como escrita** — 82% é τ≈0.50; em τ=0.6 é 54% |
| "o escalonamento melhora a acurácia combinada para 0.7948" | **consistente** — o escalonamento só substitui respostas locais erradas |
| "o complemento fornece este portão" | **era falsa na 0.1.2** (recall 0.00, e ele nunca carregava) |

---

## Configuração

Os padrões ficam em `cordis.patch.yml` e estão documentados em `lib/config.mjs`. Toda chave tem um padrão, então o patch do bundle pode ser reduzido a `enabled: true`.

| chave | padrão | significado |
|---|---|---|
| `endpoint` | `http://127.0.0.1:8155/v1/systemone` | serviço de decisão. **Somente loopback** — o estado de decisão carrega o texto bruto da chamada de ferramenta, então um host remoto é um erro no carregamento, a menos que `allowRemoteEndpoint: true`. |
| `model` | `Phocinae-Largha-150M-v1` | nome do modelo servido |
| `timeoutMs` | `3000` | por requisição; uma tentativa, sem retentativa |
| `escalateAt` | `0.6` | confiança abaixo deste valor marca uma resposta como `escalate: true` |
| `maxStateChars` | `4096` | limite do estado de decisão renderizado |
| `permuteChoice` | `false` | média por permutação em perguntas de escolha (4x forwards) |
| `gate.enabled` | `true` | arma o portão de pré-execução |
| `gate.mode` | `harm` | `harm` / `tri-state` / `noul` / `off` |
| `gate.threshold` | `0.8` | apenas no modo `noul`: P(risky) que conta como sinal positivo |
| `gate.minConfidence` | `0.45` | abaixo deste valor, um `allow` vira uma revisão |
| `gate.autoAllow` | veja `DEFAULT_AUTO_ALLOW` | comandos liberados sem consultar o modelo |
| `gate.tools` | `['*']` | nomes de ferramenta a examinar: exatos, globs `*`, ou `*` |
| `gate.failMode` | `closed` | `closed` = serviço inacessível pergunta a um humano; `open` = permitir |
| `gate.riskyDecision` | `deny` | apenas no modo `noul`: `deny` ou `ask` diante de um achado positivo |
| `gate.audit` | `true` | registra cada veredito pelo logger do host |

Para não examinar nada e usar apenas as ferramentas:

```yaml
- id: phocinae
  config:
    gate:
      mode: off
```

Para examinar apenas o shell e apenas perguntar:

```yaml
- id: phocinae
  config:
    gate:
      tools: ['pwsh', 'bash']
      riskyDecision: ask
```

---

## Executando o serviço de decisão

O complemento conversa com um servidor local; ele mesmo não carrega os pesos.

```sh
# pesos (o download de referência tem ~330 MB)
huggingface-cli download Phocinae/Phocinae-Largha-150M-v1 --local-dir ./model
# (o modelscope hospeda o mesmo repositório: modelscope download --model PerryLink/Phocinae-Largha-150M-v1)

pip install phocinae-server
PHOC_MODEL_DIR=./model python -m phocinae.main
```

`GET http://127.0.0.1:8155/health` respondendo `{"status":"ok","model_loaded":true}` significa que ele está no ar. Sem isso, `phocinae_ask` retorna um erro `PHOCINAE_SERVICE_UNAVAILABLE` citando esse comando, e o portão encaminha toda chamada examinada para um humano.

---

## Desenvolvimento

```sh
npm test                  # testes de unidade + contrato, sem rede, sem modelo
npm run test:integration  # portão por HTTP real, depois um boot real do host dsh
npm run bench:gate        # o benchmark do portão (precisa do serviço real)
```

`npm run test:integration` cria um `DSH_HOME` descartável sob o diretório temporário do sistema, então ele nunca lê nem grava nos seus próprios perfis. Sua primeira metade aciona o portão real por HTTP real contra um serviço falso; sua segunda metade instala o complemento nesse perfil descartável e inicializa o `dsh` real, verificando que toda entrada do bundle é ativada — que é a checagem que a 0.1.2 teria falhado.

O serviço falso existe porque o real precisa de um checkpoint de 330 MB. Aponte o harness para um serviço real em execução com `--real-endpoint http://127.0.0.1:8155/v1/systemone`.

---

## Documentação

| documento | conteúdo |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | o contrato de montagem, a ordem de decisão do portão e por que cada escolha foi feita |
| [SECURITY.md](./SECURITY.md) | fronteiras de confiança, o que sai da máquina e os modos de falha |
| [CHANGELOG.md](./CHANGELOG.md) | histórico de versões |
| [bench/](./bench) | os scripts de benchmark e seus resultados salvos |
| [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) | trabalho reutilizado e suas licenças |

## Licença

Apache-2.0 — veja [LICENSE](./LICENSE). Os pesos do modelo também são Apache-2.0; o card deles é a autoridade sobre o modelo, e este repositório é a autoridade sobre o complemento.
