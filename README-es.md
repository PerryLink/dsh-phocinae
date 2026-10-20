**English** · [中文](./README-zh.md) · [Español](./README-es.md) · [Português](./README-pt.md) · [हिन्दी](./README-hi.md)

<img src="docs/assets/logo_phocinae.png" width="120" alt="Logotipo de Phocinae">

# dsh-phocinae

**Una capa de decisión local y no generativa para DeepSeek Harness.** Un modelo de 150M responde sí/no, opción única y puntuaciones 2–10 en una pasada, y una puerta fail-closed revisa las llamadas a herramientas antes de ejecutarlas.

- Se ejecuta en tu máquina; sin API en la nube ni clave.
- `phocinae_ask` para decisiones tipadas por lotes; `phocinae_gate` para una orden o acción.
- La puerta se engancha en `tools/pre-execute`: si el servicio no responde, pregunta a una persona; nunca permite en silencio.
- El modelo no escribe prosa ni código. Hace una decisión estructurada.

## Inicio rápido

```sh
pip install phocinae-server
huggingface-cli download Phocinae/Phocinae-Largha-150M-v1 --local-dir ./model
PHOC_MODEL_DIR=./model python -m phocinae.main
dsh plugin --profile web add dsh-phocinae@0.2.5
curl http://127.0.0.1:8155/health
```

`{"status":"ok","model_loaded":true}` significa que el servicio está listo. Fija `dsh-phocinae@0.2.5`: un `add dsh-phocinae` sin versión puede resolver a una compilación anterior mientras `minimumReleaseAge` de pnpm retiene una release reciente.

## Qué obtienes

| Superficie | Qué hace |
|---|---|
| `phocinae_ask` | Hasta 64 preguntas tipadas sobre un estado; devuelve respuestas, confianza calibrada y un indicador `escalate`. |
| `phocinae_gate` | Juzga una orden o acción como `allow`, `ask` o `deny`; la comprueba sin ejecutarla. |
| Puerta `tools/pre-execute` | Revisa cada llamada que coincide con `gate.tools` antes de ejecutar; fail-closed. |
| Skill `phocinae` | Enseña al modelo cuándo usar una decisión local y cómo leer `escalate`. |

## Ejemplos

Haz dos preguntas sobre un estado:

```json
{"state":"El usuario quiere borrar /tmp/build. La ruta está dentro del workspace.","questions":[{"id":"safe","type":"noul","threshold":0.8},{"id":"urgency","type":"score"}]}
```

La forma de la respuesta es:

```json
{"answers":{"safe":true,"urgency":4},"confidence":{"safe":0.92,"urgency":0.71},"escalate":false}
```

Juzga una orden peligrosa:

```json
{"command":"rm -rf /","toolName":"shell","cwd":"/home/me/project"}
```

Devuelve `decision: "deny"` con motivo y confianza; la orden nunca se ejecuta. Estas salidas ilustran el esquema, no son un fixture grabado.

## Cómo funciona

1. El host llama a `phocinae_ask`, `phocinae_gate` o a la puerta pre-execute.
2. El plugin envía el estado bruto a `http://127.0.0.1:8155/v1/systemone`.
3. El servicio devuelve una respuesta estructurada por pregunta.
4. La puerta mapea a `allow` / `ask` / `deny`; la baja confianza produce `escalate` y un servicio inaccesible produce `ask` con `failMode: closed`.

## Configuración

Los valores por defecto están en `cordis.patch.yml` y `lib/config.mjs`. Todas las claves tienen valor por defecto.

| Clave | Valor por defecto | Significado |
|---|---|---|
| `endpoint` | `http://127.0.0.1:8155/v1/systemone` | Servicio de decisión. Solo loopback salvo `allowRemoteEndpoint: true`. |
| `timeoutMs` | `3000` | Tiempo por petición; un solo intento. |
| `escalateAt` | `0.6` | Confianza por debajo de este valor marca `escalate: true`. |
| `gate.mode` | `harm` | `harm`, `tri-state`, `noul` u `off`. |
| `gate.tools` | `['*']` | Herramientas a revisar: nombre exacto, glob o `*`. |
| `gate.failMode` | `closed` | `closed` pregunta a una persona si el servicio no responde; `open` permite. |

Para usar solo las herramientas y no revisar nada:

```yaml
- id: phocinae
  config:
    gate:
      mode: off
```

## Seguridad y límites

- **Solo loopback.** El estado contiene texto bruto de la llamada; un endpoint no loopback es un error de carga salvo permiso explícito.
- **Fail-closed.** Errores o timeouts del servicio envían la llamada a una persona; un nombre de herramienta ausente no se considera seguro.
- **No es un sandbox.** La puerta es una señal de aprobación adicional, no sustituye al sandbox del host ni a la aprobación humana.
- **No genera contenido.** El modelo no responde preguntas de conocimiento, no escribe código ni resume; para eso usa un modelo de chat.

## Compatibilidad

- Node `^22.19` o `>=24`.
- DSH `>=0.2.1-0 <0.3.0`; la fila del bundle monta `phocinae_ask`, `phocinae_gate`, la puerta y la skill.
- `phocinae-server` debe ser accesible en el endpoint configurado.

## Solución de problemas

| Síntoma | Solución |
|---|---|
| `PHOCINAE_SERVICE_UNAVAILABLE` | Inicia el servicio y comprueba `curl http://127.0.0.1:8155/health`. |
| Un add sin versión instala una versión vieja | Reinstala con `dsh-phocinae@0.2.5`; revisa `dsh --profile web --dump-config`. |
| La puerta pregunta por todo | Confirma que el servicio está activo; con `failMode: closed` un servicio caído pregunta a propósito. |
| La puerta es demasiado estricta o laxa | Ajusta `gate.mode`, `gate.tools`, `gate.minConfidence`, `gate.autoAllow`; no la desactives a ciegas. |

## Licencia

Apache-2.0. La tarjeta del modelo y el servidor son proyectos separados: [Phocinae-Largha-150M-v1](https://huggingface.co/Phocinae/Phocinae-Largha-150M-v1) y [phocinae-server](https://github.com/Phocinae/phocinae-server).
