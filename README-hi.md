**English** · [中文](./README-zh.md) · [Español](./README-es.md) · [Português](./README-pt.md) · [हिन्दी](./README-hi.md)

# dsh-phocinae

**DeepSeek Harness के लिए एक स्थानीय, नॉन-जनरेटिव decision layer।**

`phocinae_ask` / `phocinae_gate` tools, जो एक [Phocinae-Largha-150M-v1](https://huggingface.co/Phocinae/Phocinae-Largha-150M-v1) server पर टिके हैं — हाँ/ना के निर्णय, single-choice चुनाव और 2-10 तक के scores, हर एक के लिए एक forward pass, और वह भी आपकी ही मशीन पर — साथ में एक fail-closed approval gate जो tool calls को चलने से पहले छान लेता है।

यह **0.2.0** है, एक repair release। 0.1.2 plugin DSH 0.2.x पर बिल्कुल activate ही नहीं हुआ: harness ने एक warning log की और entry दम तोड़ गई। *0.2.0 में क्या ठीक हुआ* section से नीचे का हर हिस्सा बताता है कि क्या बदला और क्यों।

```sh
npm i dsh-phocinae
dsh plugin --profile <name> add dsh-phocinae
```

Node `^22.19` या `>=24` चाहिए, और एक पहुँच में आने वाली decision service (देखें [Running the decision service](#running-the-decision-service))।

---

## यह क्या जोड़ता है

| योगदान | seam | यह क्या करता है |
|---|---|---|
| `phocinae_ask` | `ctx.tools` | local model पर typed questions का एक batch चलाता है। हर उत्तर के साथ एक calibrated confidence और एक advisory `escalate` flag आता है। |
| `phocinae_gate` | `ctx.tools` | एक command या action का फैसला करता है: `allow` / `ask` / `deny`, confidence के साथ। Action को चलाए बिना उसे जाँचता है। |
| approval gate | `tools/pre-execute` waterfall | Configured patterns के दायरे में आने वाली हर tool call को execute होने से पहले छान लेता है। |

यह model chat model नहीं है। यह text generate नहीं करता, facts नहीं जानता और code नहीं लिख सकता। यह हर forward pass पर एक structured decision लेता है — एक gate को ठीक इतना ही चाहिए, इससे ज़्यादा कुछ नहीं।

---

## 0.2.0 में क्या ठीक हुआ

नीचे की हर बात `test/regressions.test.mjs` में एक test से reproduce होती है, जिनके नाम `D1`…`D12` हैं।

### D1 — plugin कभी activate ही नहीं हुआ

```
dsh: warning: 1 entry did not activate
phocinae (dsh-phocinae): Error: cannot get property "registerTool" without inject
```

`index.js` ने defensive check के तौर पर `typeof ctx.registerTool === 'function'` probe किया। Cordis context एक proxy है: किसी **undeclared** service का नाम पढ़ने पर `undefined` लौटने के बजाय error throw होता है। `registerTool` कोई DSH service नहीं है — registry `ctx.tools` पर रहता है — इसलिए यह probe plugin body की पहली ही line पर throw हो गया और पूरी entry को गिरा दिया, इससे पहले कि वह किसी चीज़ को subscribe कर पाती।

**ठीक किया गया:** tool registration अब `ctx.inject(['tools'], …)` के ज़रिए service का इंतज़ार करता है। न कोई probe, न कोई undeclared read, और अगर service कभी आए ही नहीं तो भी plugin अपना gate तैयार कर लेता है।

### D2 — tool definition का shape गलत था

Definition में `{inputSchema, handler}` था। `ToolDefinition`, `ToolSchema` को extend करता है, जो `{name, description, parameters}` declare करता है, और registry `definition.parameters` पढ़ता है। पुराना shape register करने पर model-facing projection fail हो जाता है:

```
dsh: UNKNOWN: tool "phocinae_ask" parameters must be lossless JSON before schema projection
```

**ठीक किया गया:** definitions में अब `parameters` और `output: {schema, render}` के साथ `execute` भी है — सब कुछ harness के enforced JSON Schema subset के अंदर (`required` एक array के रूप में, unions के लिए `oneOf`, कोई author-only keyword नहीं)। `test/contract.test.mjs` उसी subset check को दोबारा implement करता है, और assembled-headless run असली host में definitions register करता है।

### D3 — gate ने उत्तर गलत जगह से पढ़ा

`data.answers` एक object है जिसकी keys question id होती हैं। 0.1.2 में `Array.isArray(data.answers) ? data.answers[0] : …` लिखा था, जो हर असली response के लिए `undefined` देता है।

### D4 — और इसीलिए चुपचाप सब कुछ allow कर दिया

Verdict की जाँच `if (risk === true)` थी। `risk` जब हमेशा `undefined` हो, तो यह सदा false रहती है, इसलिए `guard()` हर command के लिए `{decision: 'allow'}` लौटाता था, वजह के साथ *"the model judged this low risk"* — हर command के लिए, `rm -rf /` समेत।

`bench/` के 53-command labelled set पर destructive commands की recall **0.00** थी।

**ठीक किया गया:** answers अब id से पढ़े जाते हैं और उनका shape check होता है, malformed body default मानने के बजाय protocol error है, और gate **fail closed** करता है — unreachable service, गायब confidence extension, या unreadable body — तीनों ही मामले किसी इंसान तक पहुँचते हैं।

### D5 — verdict throw होते थे, return नहीं

Deny path `next(err)` call करता था। `tools/pre-execute` waterfall एक `PreToolDecision` (`{kind: 'allow' | 'deny' | 'ask', reason}`) की अपेक्षा करता है; waterfall को reject करना कोई decision नहीं है।

**ठीक किया गया:** `{kind: 'deny', reason}` और `{kind: 'ask', reason, displayReason}`, तथा allow path पर `next()` ठीक एक बार call होता है।

### D6 — `gate.tools` का default `['bash']` था

Shell tool Windows पर `pwsh` है, बाक़ी जगह `bash`, और MCP servers अपने-अपने नाम जोड़ देते हैं। इस मशीन पर default किसी से match नहीं हुआ, इसलिए gate कभी चला ही नहीं।

**ठीक किया गया:** default अब `['*']` है — यानी हर tool — और exact names, `*` globs तथा case-insensitive matching उपलब्ध हैं।

### D7 — release notes में जिस escalation gate का वादा था, वह वहाँ था ही नहीं

Model release में एक E1 gate का ज़िक्र है: जब `answer_confidence` τ से नीचे गिरे तो decision को किसी बड़े model तक escalate कर दो। `0.1.2` में न τ था, न confidence comparison, न कोई escalation branch — पूरे repository में `escalate` खोजने पर सिर्फ़ Python server मिला।

**ठीक किया गया:** `phocinae_ask` अब `escalate`, `escalatedIds`, `escalationReason` और `escalateAt` लौटाता है, और gate उसी confidence को देखता है। Plugin अब भी escalation *करता* नहीं — वह आपकी ओर से किसी बड़े model को call नहीं कर सकता — लेकिन अब यह signal दावे के बजाय सचमुच पैदा होता है।

### ब्रेकिंग बदलाव

| बदलाव | 0.1.2 | 0.2.0 |
|---|---|---|
| tool registry | `ctx.registerTool` / `ctx.tools.register` probe | `ctx.inject(['tools'], …)` |
| tool definition | `inputSchema` + `handler` | `parameters` + `output` + `execute` |
| gate उत्तर का स्रोत | `answers[0]` (array) | `answers[id]` (object) |
| failure की दिशा | हमेशा `allow` | default में `ask` (`gate.failMode`) |
| tool match default | `['bash']` | `['*']` |
| verdict | `next(err)` | `{kind, reason}` |
| gate का सवाल | boolean `noul` | harm scale (`harmless`/`risky`/`destructive`) |
| `gate.mode` default | `deny` | `harm` |
| escalation | मौजूद नहीं | हर उत्तर पर `escalate` |

`gate.failMode: 'open'` उस deployment के लिए पुराना हमेशा-allow वाला व्यवहार वापस ले आता है जिसे वह चाहिए। यह default नहीं है और इसे default नहीं बनना चाहिए।

---

## मापा गया व्यवहार

यहाँ का हर आँकड़ा एक ही मशीन (CPU, fp32, Node 24) पर, release किए गए weights के साथ, `bench/` की scripts से बनाया गया है; इन पर भरोसा करने से पहले इन्हें अपने hardware पर दोबारा चलाएँ। Published figures model release के अपने documents से लिए गए हैं।

### निर्णय की गुणवत्ता — model ईमानदार है

`datasets/typed_test/test_typed_400.jsonl`, 400 cases × 5 questions = 2000 decisions, हर decision को `gold.label` के सामने परखा गया:

| मापदंड | प्रकाशित (en) | मापा गया (en) | प्रकाशित (zh) | मापा गया (zh) |
|---|---|---|---|---|
| local accuracy | 0.797 | **0.7825** | 0.789 | **0.7820** |
| escalation rate @ τ=0.6 | 18% | **45.65%** | 18% | **43.00%** |
| kept decisions पर accuracy | — | 0.8859 | — | 0.9035 |

Accuracy तो release के खुद बताए fp16/fp32 noise के अंदर reproduce हो जाती है। Escalation rate नहीं होती, और release के documents इस पर आपस में ही नहीं मिलते: *"82% fewer LLM calls"* वाला headline **τ≈0.50** पर मिलता है, जबकि वही documents जिस frozen E1 gate का ज़िक्र करते हैं वह **τ=0.6** है:

| τ | escalated | LLM calls cut | local रखे गए decisions पर accuracy |
|---|---|---|---|
| 0.50 | 17.15% | **82.8%** | 0.8214 |
| **0.60** | **45.65%** | **54.4%** | 0.8859 |
| 0.70 | 67.15% | 32.9% | 0.9300 |
| 0.80 | 81.70% | 18.3% | 0.9645 |

**"82% saved" और "τ=0.6" — दोनों एक साथ सच नहीं हो सकते।** जिस threshold को model release frozen कहता है, उस पर कटौती 54% है। यह फिर भी असली बचत है, और confidence का क्रम वाक़ई उपयोगी है — जैसे-जैसे कसौटी ऊँची होती है, local रहने वाले decisions की accuracy 0.78 से 0.96 तक चढ़ती जाती है — लेकिन headline वाला आँकड़ा किसी और threshold का है।

### Gate की गुणवत्ता — और default सवाल क्यों बदला

`bench/gate-bench.mjs`, 53 commands (31 destructive, 22 routine), सब असली model के खिलाफ़। `recall` उन destructive commands का हिस्सा है जिन्हें gate रोकता है; `auto-pass purity` बताती है कि pass हुई command असल में कितनी बार सुरक्षित थी।

| gate का सवाल | destructive पर recall | भरोसे के साथ pass हुईं, पर destructive थीं |
|---|---|---|
| `noul` — "should this be blocked?" (0.1.2 का default) | **0.00** | — |
| `tri-state` — allow / ask / deny | **0.74** | 1 |
| **`harm` — harmless / risky / destructive (0.2.0 default)** | **0.97** | **0** |

विरासत में मिला यह boolean सवाल सिर्फ़ कमज़ोर नहीं है, उल्टा है: इसने **31 में से हर एक destructive command** pass कर दिया, ज़्यादातर 0.54 से 0.80 के बीच confidence के साथ। "is this safe?" पूछना तो और भी बुरा है — 31 में से 27 pass हो गए, confidence 0.87 तक पहुँच गया। मापी गई formulations में harm scale अकेली ऐसी है जिसने लगभग सब कुछ पकड़ा और किसी destructive command को भरोसे के साथ कभी पार नहीं जाने दिया।

इसकी एकमात्र चूक, `vssadmin delete shadows /all /quiet`, confidence से नहीं, auto-allow list के operator नियम से पकड़ी जाती है, इसलिए set में कोई भी destructive command execution तक नहीं पहुँचता।

### Confidence सिमटी हुई है: gate को संकीर्ण रखें

Model की confidence routine commands को risky commands से इतना अलग नहीं कर पाती कि वह general-purpose filter बन सके। इसके `harmless` verdict ज़्यादातर 0.27–0.54 में बैठते हैं, इसलिए जो gate `git status` के बारे में इसे पूछता, वह `git status` को किसी इंसान के पास भेज देता।

इसीलिए `0.2.0` एक **auto-allow list** के साथ आता है: बिना shell operator वाले read-only और build/test commands model तक पहुँचते ही नहीं। Gate का काम चीज़ों को रोकना है, नियमित कामों को approve करना नहीं:

- list में नाम है, कोई operator नहीं → local पर ही pass, न request, न latency
- ऐसा कुछ भी जिसमें `;&|><`$(){}\[\]` आदि हों → list bypass हो जाती है और फैसला model करता है
- model कहे `destructive` → deny
- model कहे `risky`, या `harmless` `gate.minConfidence` से नीचे → फैसला इंसान करता है
- service unreachable → फैसला इंसान करता है

Shell operator वाली entry load के समय ही ठुकरा दी जाती है। `git status && rm -rf /` एक allow-listed prefix से शुरू होता है, इसलिए ऐसा pattern स्वीकार करना list में ही एक bypass बना देता।

### दावों का ईमानदार सार

| दावा | फैसला |
|---|---|
| "144.3M bilingual decision model, one forward pass, local" | **सच** |
| "typed-decisions en 0.797 / zh 0.789" | **reproduce होता है** (0.7825 / 0.7820) |
| "cuts LLM calls by 82% with a τ=0.6 confidence gate" | **जैसा लिखा है वैसा झूठा** — 82% तो τ≈0.50 पर है; τ=0.6 पर यह 54% है |
| "escalation improves combined accuracy to 0.7948" | **संगत** — escalation सिर्फ़ गलत local उत्तरों की जगह लेता है |
| "the plugin provides this gate" | **0.1.2 के लिए झूठा था** (recall 0.00, और वह load ही नहीं हुआ) |

---

## कॉन्फ़िगरेशन

Defaults `cordis.patch.yml` में रहते हैं और `lib/config.mjs` में documented हैं। हर key का एक default है, इसलिए bundle patch को घटाकर `enabled: true` तक लाया जा सकता है।

| key | default | अर्थ |
|---|---|---|
| `endpoint` | `http://127.0.0.1:8155/v1/systemone` | decision service। **सिर्फ़ loopback** — decision state में raw tool-call text होता है, इसलिए remote host load-time error है, जब तक `allowRemoteEndpoint: true` न हो। |
| `model` | `Phocinae-Largha-150M-v1` | serve किए गए model का नाम |
| `timeoutMs` | `3000` | प्रति request; एक ही attempt, कोई retry नहीं |
| `escalateAt` | `0.6` | इससे नीचे की confidence उत्तर को `escalate: true` चिह्नित कर देती है |
| `maxStateChars` | `4096` | render किए गए decision state पर सीमा |
| `permuteChoice` | `false` | choice questions का permutation-average (4x forwards) |
| `gate.enabled` | `true` | pre-execute gate तैयार करें |
| `gate.mode` | `harm` | `harm` / `tri-state` / `noul` / `off` |
| `gate.threshold` | `0.8` | सिर्फ़ `noul` mode: P(risky) जिसे positive signal गिना जाए |
| `gate.minConfidence` | `0.45` | इससे नीचे `allow` review बन जाता है |
| `gate.autoAllow` | देखें `DEFAULT_AUTO_ALLOW` | वे commands जो model से पूछे बिना pass हो जाती हैं |
| `gate.tools` | `['*']` | screen होने वाले tool names: exact, `*` globs, या `*` |
| `gate.failMode` | `closed` | `closed` = unreachable service इंसान से पूछती है; `open` = allow |
| `gate.riskyDecision` | `deny` | सिर्फ़ `noul` mode: positive finding पर `deny` या `ask` |
| `gate.audit` | `true` | हर verdict को host logger से log करें |

कुछ भी screen न करना हो और सिर्फ़ tools इस्तेमाल करने हों:

```yaml
- id: phocinae
  config:
    gate:
      mode: off
```

सिर्फ़ shell screen करना हो, और सिर्फ़ पूछना हो:

```yaml
- id: phocinae
  config:
    gate:
      tools: ['pwsh', 'bash']
      riskyDecision: ask
```

---

## Decision service चलाना

Plugin एक local server से बात करता है; यह खुद weights load नहीं करता।

```sh
# weights (the reference download is ~330 MB)
huggingface-cli download Phocinae/Phocinae-Largha-150M-v1 --local-dir ./model
# (modelscope hosts the same repo: modelscope download --model PerryLink/Phocinae-Largha-150M-v1)

pip install phocinae-server
PHOC_MODEL_DIR=./model python -m phocinae.main
```

`GET http://127.0.0.1:8155/health` का जवाब `{"status":"ok","model_loaded":true}` आने का मतलब है कि service चालू है। इसके बिना `phocinae_ask` उस command का नाम लेते हुए `PHOCINAE_SERVICE_UNAVAILABLE` error लौटाता है, और gate हर screened call किसी इंसान तक भेज देता है।

---

## डेवलपमेंट

```sh
npm test                  # unit + contract tests, no network, no model
npm run test:integration  # gate over real HTTP, then a real dsh host boot
npm run bench:gate        # the gate benchmark (needs the real service)
```

`npm run test:integration` system temp directory के नीचे एक throwaway `DSH_HOME` बनाता है, इसलिए यह आपकी अपनी profiles को कभी पढ़ता या लिखता नहीं। इसका पहला हिस्सा असली gate को असली HTTP पर एक fake service के खिलाफ़ चलाता है; दूसरा हिस्सा plugin को उसी throwaway profile में install करता है और असली `dsh` boot करता है, यह जाँचते हुए कि हर bundle entry activate होती है — यही वह check है जिसमें 0.1.2 फेल हो जाता।

Fake service इसलिए है क्योंकि असली service को 330 MB का checkpoint चाहिए। Harness को किसी चल रहे असली service की ओर `--real-endpoint http://127.0.0.1:8155/v1/systemone` से इंगित करें।

---

## दस्तावेज़ीकरण

| doc | विषय-वस्तु |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | mounting contract, gate का decision order, और हर चुनाव क्यों किया गया |
| [SECURITY.md](./SECURITY.md) | trust boundaries, मशीन से क्या बाहर जाता है, और failure modes |
| [CHANGELOG.md](./CHANGELOG.md) | release history |
| [bench/](./bench) | benchmark scripts और उनके सहेजे गए नतीजे |
| [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) | दोबारा इस्तेमाल किया गया काम और उसके licences |

## लाइसेंस

Apache-2.0 — देखें [LICENSE](./LICENSE)। Model weights भी Apache-2.0 हैं; model के बारे में अधिकार model card का है, और plugin के बारे में इस repository का।
