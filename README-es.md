**English** · [中文](./README-zh.md) · [Español](./README-es.md) · [Português](./README-pt.md) · [हिन्दी](./README-hi.md)

# dsh-phocinae

**Una capa de decisión local y no generativa para DeepSeek Harness.**

Herramientas `phocinae_ask` / `phocinae_gate` respaldadas por un servidor [Phocinae-Largha-150M-v1](https://huggingface.co/Phocinae/Phocinae-Largha-150M-v1) — juicios de sí/no, elecciones de una sola opción y puntuaciones de 2 a 10, una pasada forward cada una, en tu propia máquina — más una puerta de aprobación que falla cerrada y examina las llamadas a herramientas antes de que se ejecuten.

Esta es la **0.2.2**, una versión de reparación. El complemento 0.1.2 no se activaba en absoluto en DSH 0.2.x: el harness registraba un solo aviso y la entrada moría. Todo lo que aparece a continuación de la sección *Corregido en 0.2.2* es lo que cambió y por qué.

```sh
dsh plugin --profile <name> add dsh-phocinae@0.2.2
```

Requiere Node `^22.19` o `>=24`, y un servicio de decisión accesible (véase [Ejecutar el servicio de decisión](#running-the-decision-service)).

### `npm i` por sí solo no instala el complemento

Tienen que ocurrir dos cosas distintas, y solo la segunda monta el complemento:

| paso | qué hace |
|---|---|
| `npm i dsh-phocinae` | Coloca el paquete en el `node_modules` **del directorio actual**. Útil para leer el código o importar el guard directamente. **No** llega a ningún perfil de DSH. |
| `dsh plugin --profile <name> add dsh-phocinae@0.2.2` | Lo añade al `package.json` **de ese perfil** (`dependencies` **y** `dsh.profile.bundles`) y lo instala allí con pnpm. Esto es lo que hace que el host lo monte. |

Medido en esta máquina, con un `DSH_HOME` desechable:

- `npm i dsh-phocinae` en un directorio no relacionado → instalado allí, las `dependencies` del perfil siguen siendo `{}`, los `bundles` del perfil no cambian, **complemento ausente de `dsh <profile> --dump-config`**;
- `dsh plugin --profile p add dsh-phocinae` → el perfil gana tanto la dependencia como la entrada de bundle, y la configuración compuesta contiene la fila `phocinae` con su endpoint;
- una dependencia **sin** la entrada `dsh.profile.bundles` → instalada pero **no montada**, porque la lista de bundles es la que recorre el cargador.

### Fija la versión

`add dsh-phocinae` resuelve a través de la puerta de antigüedad de la cadena de suministro de pnpm
(`minimumReleaseAge`). Una versión más reciente que el umbral de la puerta no se selecciona, así que
**durante un tiempo después de una publicación el nombre sin versión resuelve a la versión anterior**
— y la versión anterior aquí es 0.1.2, que no funciona.

Medido, con minutos de diferencia, en la misma máquina:

| cuándo | comando | resolvió a |
|---|---|---|
| 0.2.2 publicado + 2 min | `dsh plugin --profile p add dsh-phocinae` | **0.1.2** — `main: index.js`, la compilación que no puede activarse |
| lo mismo, pero con `add dsh-phocinae@0.2.2` | | **0.2.2** — `./index.mjs`, skill presente |
| lo mismo, add sin versión con `minimumReleaseAge: 0` en el `pnpm-workspace.yaml` del perfil | | **0.2.2** |
| 0.2.2 publicado + 150 min | `dsh plugin --profile p add dsh-phocinae` | **0.2.2** — `^0.2.2`, el host arranca limpio |

Cuando la puerta retiene una versión, el harness registra el rechazo en el `pnpm-workspace.yaml` del
perfil:

```yaml
minimumReleaseAgeExclude:
  - dsh-phocinae@0.2.2
```

La puerta es un buen valor por defecto — un paquete recién publicado es exactamente el aspecto de un
ataque a la cadena de suministro. Solo significa que **hay que nombrar la versión**, tanto para obtener
la compilación corregida de inmediato como para que la instalación sea reproducible:

```sh
dsh plugin --profile <name> add dsh-phocinae@0.2.2
```

Si un add sin versión te deja en 0.1.2, `dsh <profile> --dump-config` muestra qué versión está montada,
y volver a añadir con la especificación fijada la reemplaza.

Las instalaciones desde Git y desde un checkout local funcionan igual, y fijan la versión por
construcción:

```sh
dsh plugin --profile <name> add github:Phocinae/dsh-phocinae#v0.2.2
dsh plugin --profile <name> add /path/to/a/local/checkout
```

---

## Qué aporta

| aportación | punto de enganche | qué hace |
|---|---|---|
| `phocinae_ask` | `ctx.tools` | Ejecuta un lote de preguntas tipadas contra el modelo local. Cada respuesta lleva una confianza calibrada y un indicador `escalate` orientativo. |
| `phocinae_gate` | `ctx.tools` | Juzga un comando o una acción: `allow` / `ask` / `deny`, con confianza. Comprueba una acción sin ejecutarla. |
| puerta de aprobación | cascada `tools/pre-execute` | Examina cada llamada a herramienta que cubran los patrones configurados, antes de que se ejecute. |
| skill `phocinae` | `ctx.skills` | Enseña al modelo cuándo una decisión local es la herramienta adecuada, cómo formularla y cómo leer el indicador `escalate`. |

El modelo no es un modelo de chat. No genera texto, no conoce hechos y no sabe escribir código. Toma una única decisión estructurada por pasada forward, que es exactamente lo que necesita una puerta y nada más.

---

## Corregido en 0.2.2

Cada punto de los siguientes está reproducido por una prueba en `test/regressions.test.mjs`, llamada `D1`…`D12`.

### D1 — el complemento nunca se activaba

```
dsh: warning: 1 entry did not activate
phocinae (dsh-phocinae): Error: cannot get property "registerTool" without inject
```

`index.js` sondeaba `typeof ctx.registerTool === 'function'` como comprobación defensiva. Un contexto de Cordis es un proxy: leer el nombre de un servicio **no declarado** lanza una excepción en lugar de devolver `undefined`. `registerTool` no es un servicio de DSH — el registro vive en `ctx.tools` —, así que la sonda lanzó la excepción en la primera línea del cuerpo del complemento y se llevó por delante toda la entrada antes de que pudiera suscribirse a nada.

**Corregido:** el registro de herramientas espera al servicio mediante `ctx.inject(['tools'], …)`. Sin sonda, sin lectura de nombres no declarados y, si el servicio nunca aparece, el complemento aun así arma su puerta.

### D2 — la definición de la herramienta tenía la forma equivocada

La definición llevaba `{inputSchema, handler}`. `ToolDefinition` extiende `ToolSchema`, que declara `{name, description, parameters}`, y el registro lee `definition.parameters`. Registrar la forma antigua hace fallar la proyección de cara al modelo:

```
dsh: UNKNOWN: tool "phocinae_ask" parameters must be lossless JSON before schema projection
```

**Corregido:** las definiciones ahora llevan `parameters` y `output: {schema, render}` además de `execute`, todo dentro del subconjunto de JSON Schema que el harness impone (`required` como array, `oneOf` para uniones, sin palabras clave exclusivas de autor). `test/contract.test.mjs` reimplementa esa comprobación del subconjunto, y la ejecución headless ensamblada registra las definiciones en un host real.

### D3 — la puerta leía la respuesta del lugar equivocado

`data.answers` es un objeto indexado por el id de la pregunta. La 0.1.2 hacía `Array.isArray(data.answers) ? data.answers[0] : …`, que es `undefined` para toda respuesta real.

### D4 — y por tanto lo permitía todo, en silencio

La prueba del veredicto era `if (risk === true)`. Con `risk` siempre `undefined`, eso es siempre falso, así que `guard()` devolvía `{decision: 'allow'}` con la razón *"el modelo consideró que esto es de bajo riesgo"* — para todos los comandos, incluido `rm -rf /`.

Sobre el conjunto etiquetado de 53 comandos de `bench/`, el recall en comandos destructivos fue **0.00**.

**Corregido:** las respuestas se leen por id y se validan en su forma, un cuerpo malformado es un error de protocolo y no un valor por defecto, y la puerta **falla cerrada** — un servicio inaccesible, una extensión de confianza ausente o un cuerpo ilegible acaban todos en manos de una persona.

### D5 — los veredictos se lanzaban, no se devolvían

La ruta de denegación llamaba a `next(err)`. La cascada `tools/pre-execute` espera una `PreToolDecision` (`{kind: 'allow' | 'deny' | 'ask', reason}`); rechazar la cascada no es una decisión.

**Corregido:** `{kind: 'deny', reason}` y `{kind: 'ask', reason, displayReason}`, con `next()` llamado exactamente una vez en la ruta de permiso.

### D6 — `gate.tools` tenía `['bash']` como valor por defecto

La herramienta de shell es `pwsh` en Windows y `bash` en el resto de plataformas, y los servidores MCP añaden sus propios nombres. En esta máquina el valor por defecto no coincidía con nada, así que la puerta nunca llegaba a ejecutarse.

**Corregido:** el valor por defecto es `['*']` — todas las herramientas —, con nombres exactos, globs `*` y coincidencia sin distinguir mayúsculas y minúsculas.

### D7 — la puerta de escalado que prometían las notas de la versión no existía

La publicación del modelo documenta una puerta E1: escalar una decisión a un modelo mayor cuando `answer_confidence` cae por debajo de τ. La `0.1.2` no contenía ninguna τ, ninguna comparación de confianza y ninguna rama de escalado — una búsqueda de `escalate` en todo el repositorio solo encontraba el servidor de Python.

**Corregido:** `phocinae_ask` devuelve `escalate`, `escalatedIds`, `escalationReason` y `escalateAt`, y la puerta consulta la misma confianza. El complemento sigue sin *realizar* el escalado — no puede llamar a un modelo grande en tu nombre —, pero ahora la señal se produce en lugar de solo anunciarse.

### Cambios incompatibles

| cambio | 0.1.2 | 0.2.2 |
|---|---|---|
| registro de herramientas | sonda sobre `ctx.registerTool` / `ctx.tools.register` | `ctx.inject(['tools'], …)` |
| definición de herramienta | `inputSchema` + `handler` | `parameters` + `output` + `execute` |
| origen de la respuesta de la puerta | `answers[0]` (array) | `answers[id]` (objeto) |
| dirección ante fallos | siempre `allow` | `ask` por defecto (`gate.failMode`) |
| coincidencia de herramientas por defecto | `['bash']` | `['*']` |
| veredicto | `next(err)` | `{kind, reason}` |
| pregunta de la puerta | booleana `noul` | escala de daño (`harmless`/`risky`/`destructive`) |
| `gate.mode` por defecto | `deny` | `harm` |
| escalado | ausente | `escalate` en cada respuesta |

`gate.failMode: 'open'` restaura el antiguo comportamiento de permitir siempre para un despliegue que lo quiera. No es el valor por defecto y no debería llegar a serlo.

---

## Comportamiento medido

Todos los números de esta sección se produjeron en una sola máquina (CPU, fp32, Node 24) contra los pesos publicados, con los scripts de `bench/`; vuelve a ejecutarlos en tu propio hardware antes de confiar en ellos. Las cifras publicadas proceden de los propios documentos de la publicación del modelo.

### Calidad de las decisiones — el modelo es honesto

`datasets/typed_test/test_typed_400.jsonl`, 400 casos × 5 preguntas = 2000 decisiones, evaluadas decisión a decisión contra `gold.label`:

| métrica | publicado (en) | medido (en) | publicado (zh) | medido (zh) |
|---|---|---|---|---|
| exactitud local | 0.797 | **0.7825** | 0.789 | **0.7820** |
| tasa de escalado @ τ=0.6 | 18% | **45.65%** | 18% | **43.00%** |
| exactitud en las decisiones conservadas | — | 0.8859 | — | 0.9035 |

La exactitud se reproduce dentro del propio ruido fp16/fp32 que declara la publicación. La tasa de escalado no, y los documentos publicados se contradicen entre sí al respecto: el titular *"82% menos llamadas al LLM"* es lo que se obtiene con **τ≈0.50**, mientras que la puerta E1 congelada que también documentan es **τ=0.6**:

| τ | escaladas | llamadas al LLM evitadas | exactitud en las decisiones que se quedan en local |
|---|---|---|---|
| 0.50 | 17.15% | **82.8%** | 0.8214 |
| **0.60** | **45.65%** | **54.4%** | 0.8859 |
| 0.70 | 67.15% | 32.9% | 0.9300 |
| 0.80 | 81.70% | 18.3% | 0.9645 |

**"82% de ahorro" y "τ=0.6" no pueden ser ciertos a la vez.** En el umbral que la publicación del modelo llama congelado, la reducción es del 54%. Sigue siendo un ahorro real, y el orden de confianza es genuinamente útil — la exactitud de lo que se queda en local sube de 0.78 a 0.96 a medida que sube el listón —, pero la cifra del titular pertenece a otro umbral.

### Calidad de la puerta — y por qué cambió la pregunta por defecto

`bench/gate-bench.mjs`, 53 comandos (31 destructivos, 22 rutinarios), todos contra el modelo real. `recall` es la proporción de comandos destructivos que la puerta detiene; `auto-pass purity` es la frecuencia con la que un comando que pasó era realmente seguro.

| pregunta de la puerta | recall en destructivos | aprobaciones con confianza que eran destructivas |
|---|---|---|
| `noul` — "¿debería bloquearse esto?" (valor por defecto de 0.1.2) | **0.00** | — |
| `tri-state` — allow / ask / deny | **0.74** | 1 |
| **`harm` — harmless / risky / destructive (valor por defecto de 0.2.2)** | **0.97** | **0** |

La pregunta booleana heredada no es solo débil, está invertida: dejó pasar **los 31 comandos destructivos**, la mayoría con una confianza de entre 0.54 y 0.80. Preguntar "¿esto es seguro?" es aún peor — 27 de 31 pasaron con una confianza de hasta 0.87. La escala de daño es la única formulación medida que atrapó casi todo y que nunca dejó pasar con confianza un comando destructivo.

Su único fallo, `vssadmin delete shadows /all /quiet`, lo atrapa la regla de operadores de la lista de auto-permiso y no la confianza, así que ningún comando destructivo del conjunto llega a ejecutarse.

### La confianza está comprimida: mantén la puerta estrecha

La confianza del modelo no separa los comandos rutinarios de los peligrosos lo bastante bien como para ser un filtro de propósito general. Sus veredictos `harmless` se sitúan en su mayoría en 0.27–0.54, así que una puerta que le preguntara por `git status` mandaría `git status` a una persona.

Por eso la `0.2.2` incluye una **lista de auto-permiso**: los comandos de solo lectura y de compilación/pruebas sin operadores de shell no llegan siquiera al modelo. El trabajo de la puerta es detener cosas, no aprobar lo rutinario:

- nombres en la lista, sin operador → pasan en local, sin petición, sin latencia
- cualquier cosa que contenga `;&|><`$(){}\[\]` etc. → se omite la lista y decide el modelo
- el modelo dice `destructive` → deny
- el modelo dice `risky`, o `harmless` por debajo de `gate.minConfidence` → decide una persona
- servicio inaccesible → decide una persona

Una entrada que contenga un operador de shell se rechaza en el momento de la carga. `git status && rm -rf /` empieza por un prefijo que está en la lista de permiso, así que aceptar ese patrón construiría un bypass dentro de la propia lista.

### Resumen honesto de las afirmaciones

| afirmación | veredicto |
|---|---|
| "modelo de decisión bilingüe de 144.3M, una pasada forward, local" | **verdadero** |
| "decisiones tipadas en 0.797 / zh 0.789" | **se reproduce** (0.7825 / 0.7820) |
| "reduce las llamadas al LLM un 82% con una puerta de confianza τ=0.6" | **falso tal como está escrito** — el 82% corresponde a τ≈0.50; con τ=0.6 es el 54% |
| "el escalado mejora la exactitud combinada hasta 0.7948" | **consistente** — el escalado solo sustituye respuestas locales incorrectas |
| "el complemento proporciona esta puerta" | **era falso en la 0.1.2** (recall 0.00, y nunca llegó a cargarse) |

---

## Configuración

Los valores por defecto están en `cordis.patch.yml` y se documentan en `lib/config.mjs`. Todas las claves tienen un valor por defecto, así que el parche del bundle puede reducirse a `enabled: true`.

| clave | valor por defecto | significado |
|---|---|---|
| `endpoint` | `http://127.0.0.1:8155/v1/systemone` | servicio de decisión. **Solo loopback** — el estado de decisión transporta el texto sin procesar de la llamada a herramienta, así que un host remoto es un error en tiempo de carga salvo que `allowRemoteEndpoint: true`. |
| `model` | `Phocinae-Largha-150M-v1` | nombre del modelo servido |
| `timeoutMs` | `3000` | por petición; un solo intento, sin reintentos |
| `escalateAt` | `0.6` | una confianza por debajo de este valor marca una respuesta con `escalate: true` |
| `maxStateChars` | `4096` | límite del estado de decisión renderizado |
| `permuteChoice` | `false` | promedia por permutación las preguntas de elección (4x pasadas forward) |
| `gate.enabled` | `true` | arma la puerta de pre-ejecución |
| `gate.mode` | `harm` | `harm` / `tri-state` / `noul` / `off` |
| `gate.threshold` | `0.8` | solo en modo `noul`: P(risky) que cuenta como señal positiva |
| `gate.minConfidence` | `0.45` | por debajo de este valor, un `allow` pasa a revisión |
| `gate.autoAllow` | véase `DEFAULT_AUTO_ALLOW` | comandos que pasan sin preguntar al modelo |
| `gate.tools` | `['*']` | nombres de herramientas que examinar: exactos, globs `*`, o `*` |
| `gate.failMode` | `closed` | `closed` = un servicio inaccesible pregunta a una persona; `open` = permitir |
| `gate.riskyDecision` | `deny` | solo en modo `noul`: `deny` o `ask` ante un hallazgo positivo |
| `gate.audit` | `true` | registra cada veredicto a través del logger del host |

Para no examinar nada y usar solo las herramientas:

```yaml
- id: phocinae
  config:
    gate:
      mode: off
```

Para examinar solo el shell, y solo preguntar:

```yaml
- id: phocinae
  config:
    gate:
      tools: ['pwsh', 'bash']
      riskyDecision: ask
```

---

## Ejecutar el servicio de decisión

El complemento habla con un servidor local; no carga los pesos por sí mismo.

```sh
# pesos (la descarga de referencia es de ~330 MB)
huggingface-cli download Phocinae/Phocinae-Largha-150M-v1 --local-dir ./model
# (modelscope aloja el mismo repositorio: modelscope download --model PerryLink/Phocinae-Largha-150M-v1)

pip install phocinae-server
PHOC_MODEL_DIR=./model python -m phocinae.main
```

`GET http://127.0.0.1:8155/health` que responda `{"status":"ok","model_loaded":true}` significa que está en marcha. Sin eso, `phocinae_ask` devuelve un error `PHOCINAE_SERVICE_UNAVAILABLE` que nombra ese comando, y la puerta envía cada llamada examinada a una persona.

---

## Desarrollo

```sh
npm test                  # pruebas unitarias + de contrato, sin red, sin modelo
npm run test:integration  # la puerta sobre HTTP real, luego el arranque de un host dsh real
npm run bench:gate        # el benchmark de la puerta (necesita el servicio real)
```

`npm run test:integration` crea un `DSH_HOME` desechable bajo el directorio temporal del sistema, así que nunca lee ni escribe tus propios perfiles. Su primera mitad ejecuta la puerta real sobre HTTP real contra un servicio falso; su segunda mitad instala el complemento en ese perfil desechable y arranca el `dsh` real, comprobando que cada entrada del bundle se activa — que es la verificación que la 0.1.2 habría fallado.

El servicio falso existe porque el real necesita un checkpoint de 330 MB. Apunta el harness a un servicio real en ejecución con `--real-endpoint http://127.0.0.1:8155/v1/systemone`.

---

## Documentación

| documento | contenido |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | el contrato de montaje, el orden de decisión de la puerta y por qué se tomó cada elección |
| [SECURITY.md](./SECURITY.md) | los límites de confianza, qué sale de la máquina y los modos de fallo |
| [CHANGELOG.md](./CHANGELOG.md) | historial de versiones |
| [bench/](./bench) | los scripts de benchmark y sus resultados guardados |
| [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) | trabajo reutilizado y sus licencias |

## Licencia

Apache-2.0 — véase [LICENSE](./LICENSE). Los pesos del modelo también son Apache-2.0; su ficha es la autoridad sobre el modelo, y este repositorio es la autoridad sobre el complemento.
