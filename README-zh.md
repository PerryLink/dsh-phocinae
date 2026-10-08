**English** · [中文](./README-zh.md) · [Español](./README-es.md) · [Português](./README-pt.md) · [हिन्दी](./README-hi.md)

# dsh-phocinae

**DeepSeek Harness 的本地、非生成式决策层。**

由 [Phocinae-Largha-150M-v1](https://huggingface.co/Phocinae/Phocinae-Largha-150M-v1) 服务器支撑的 `phocinae_ask` / `phocinae_gate` 工具——是非判断、单选题和 2-10 分打分，每次只需一次前向传播，全程在你自己的机器上——外加一道故障关闭的审批门，在工具调用执行之前先做审查。

这是 **0.2.2**，一个修复版本。0.1.2 版插件在 DSH 0.2.x 上完全无法激活：harness 只记了一条警告，入口就死了。*Fixed in 0.2.2* 一节之后的所有内容，讲的就是改了什么以及为什么改。

```sh
dsh plugin --profile <name> add dsh-phocinae@0.2.2
```

需要 Node `^22.19` 或 `>=24`，以及一个可访问的决策服务（见 [运行决策服务](#running-the-decision-service)）。

### 只跑 `npm i` 并不会安装这个插件

必须发生两件相互独立的事，而只有第二件才会挂载插件：

| 步骤 | 作用 |
|---|---|
| `npm i dsh-phocinae` | 把包装进**当前目录的** `node_modules`。适合阅读代码或直接导入 guard。它**不会**触及任何 DSH profile。 |
| `dsh plugin --profile <name> add dsh-phocinae@0.2.2` | 把它加进**那个 profile 的** `package.json`（`dependencies` **和** `dsh.profile.bundles`），并用 pnpm 安装到那里。这才是让宿主挂载它的原因。 |

在本机上用一个一次性的 `DSH_HOME` 实测：

- 在一个无关目录里执行 `npm i dsh-phocinae` → 包装在了那里，profile 的 `dependencies` 仍是 `{}`，profile 的 `bundles` 没有变化，**`dsh <profile> --dump-config` 中不含该插件**；
- `dsh plugin --profile p add dsh-phocinae` → 该 profile 同时获得依赖项和 bundle 条目，合成后的配置里包含带 endpoint 的 `phocinae` 行；
- 一个**没有** `dsh.profile.bundles` 条目的依赖 → 安装了但**未被挂载**，因为加载器遍历的正是 bundle 列表。

### 锁定版本

不带版本号的 `add dsh-phocinae` 会经由 pnpm 的供应链年龄门槛（`minimumReleaseAge`）解析。
比门槛更"年轻"的发行版不会被选中，所以**在一次发布之后的相当一段时间里，裸名称会解析到
上一个版本**——而这里的上一个版本是 0.1.2，它不能用。

同一台机器上、相隔若干分钟的实测：

| 时点 | 命令 | 解析到 |
|---|---|---|
| 0.2.2 发布后 + 2 分钟 | `dsh plugin --profile p add dsh-phocinae` | **0.1.2** —— `main: index.js`，那个无法激活的构建 |
| 同上，但用 `add dsh-phocinae@0.2.2` | | **0.2.2** —— `./index.mjs`，skill 存在 |
| 同上，裸添加但 profile 的 `pnpm-workspace.yaml` 中带 `minimumReleaseAge: 0` | | **0.2.2** |
| 0.2.2 发布后 + 150 分钟 | `dsh plugin --profile p add dsh-phocinae` | **0.2.2** —— `^0.2.2`，宿主启动干净 |

当门槛拦下一个版本时，harness 会把这次拒绝记进 profile 的 `pnpm-workspace.yaml`：

```yaml
minimumReleaseAgeExclude:
  - dsh-phocinae@0.2.2
```

年龄门槛是个合理的默认值——刚刚发布的包，正是供应链攻击的样子。它只意味着
**版本应当被点名**，既能立刻拿到修复版，也让安装可复现：

```sh
dsh plugin --profile <name> add dsh-phocinae@0.2.2
```

如果裸添加真的把你带到了 0.1.2，用 `dsh <profile> --dump-config` 可以看出挂载的是哪个版本，
再用点名版本的规格重新添加即可替换。

Git 和本地 checkout 的用法相同，而且天然就锁定了版本：

```sh
dsh plugin --profile <name> add github:Phocinae/dsh-phocinae#v0.2.2
dsh plugin --profile <name> add /path/to/a/local/checkout
```

---

## 它提供什么

| 贡献项 | 接缝 | 作用 |
|---|---|---|
| `phocinae_ask` | `ctx.tools` | 针对本地模型运行一批带类型的问题。每个答案都带有经校准的置信度，以及一个建议性的 `escalate` 标志。 |
| `phocinae_gate` | `ctx.tools` | 对单条命令或动作做出判定：`allow` / `ask` / `deny`，并附带置信度。只检查动作，不执行它。 |
| 审批门 | `tools/pre-execute` 瀑布（waterfall） | 在执行之前，审查配置的模式所覆盖的每一次工具调用。 |
| `phocinae` skill | `ctx.skills` | 教会模型何时该用本地决策、如何提问，以及如何解读 `escalate` 标志。 |

这个模型不是聊天模型。它不生成文本，不具备事实知识，也不能写代码。它每次前向传播只做一个结构化决策，这正是审批门所需要的全部，不多也不少。

---

## 0.2.2 中修复的问题

下面每一项都由 `test/regressions.test.mjs` 中的一个测试复现，测试名为 `D1`…`D12`。

### D1 — 插件从未激活

```
dsh: warning: 1 entry did not activate
phocinae (dsh-phocinae): Error: cannot get property "registerTool" without inject
```

`index.js` 用 `typeof ctx.registerTool === 'function'` 做了一次防御性检查。Cordis 上下文是一个代理：读取一个**未声明**的服务名会抛异常，而不是返回 `undefined`。`registerTool` 并不是 DSH 服务——注册表位于 `ctx.tools`——所以这次探测在插件主体的第一行就抛出了异常，整个入口还没能订阅任何东西就已崩溃。

**修复：** 工具注册改为通过 `ctx.inject(['tools'], …)` 等待服务就绪。没有探测，没有未声明读取，而且即使该服务始终不出现，插件仍会布防它的审批门。

### D2 — 工具定义的结构不对

该定义携带的是 `{inputSchema, handler}`。`ToolDefinition` 继承自 `ToolSchema`，后者声明的是 `{name, description, parameters}`，而注册表读取的是 `definition.parameters`。注册旧结构会让面向模型的投影失败：

```
dsh: UNKNOWN: tool "phocinae_ask" parameters must be lossless JSON before schema projection
```

**修复：** 定义现在携带 `parameters` 和 `output: {schema, render}`，外加 `execute`，全部位于 harness 强制执行的 JSON Schema 子集之内（`required` 用数组、联合类型用 `oneOf`、不含仅作者可用的关键字）。`test/contract.test.mjs` 重新实现了该子集检查，assembled-headless 运行则会在真实宿主中注册这些定义。

### D3 — 审批门从错误的位置读取答案

`data.answers` 是一个以问题 id 为键的对象。0.1.2 写的是 `Array.isArray(data.answers) ? data.answers[0] : …`，对任何真实响应来说结果都是 `undefined`。

### D4 — 因此静默地放行了一切

判定测试是 `if (risk === true)`。由于 `risk` 始终是 `undefined`，该条件永远为假，于是 `guard()` 返回 `{decision: 'allow'}`，理由为*"模型判定其风险较低"*——对每一条命令都是如此，包括 `rm -rf /`。

在 `bench/` 中 53 条命令的标注集上，对破坏性命令的召回率是 **0.00**。

**修复：** 答案按 id 读取并做结构校验，格式错误的响应体是协议错误而不是默认值，并且审批门**故障关闭**——服务不可达、缺少置信度扩展、响应体无法读取，都会转交人工处理。

### D5 — 判定是被抛出的，而不是返回的

拒绝路径调用的是 `next(err)`。`tools/pre-execute` 瀑布期望得到 `PreToolDecision`（`{kind: 'allow' | 'deny' | 'ask', reason}`）；让瀑布 reject 并不构成一个决策。

**修复：** 返回 `{kind: 'deny', reason}` 和 `{kind: 'ask', reason, displayReason}`，并在放行路径上恰好调用一次 `next()`。

### D6 — `gate.tools` 的默认值是 `['bash']`

Shell 工具在 Windows 上是 `pwsh`，在其他平台上是 `bash`，而 MCP 服务器还会加上自己的名称。在这台机器上，默认值什么都没匹配到，所以审批门从未运行。

**修复：** 默认值改为 `['*']`——即所有工具——并支持精确名称、`*` 通配和大小写不敏感匹配。

### D7 — 发行说明承诺的升级门并不存在

模型发行文档描述了一道 E1 门：当 `answer_confidence` 低于 τ 时，把决策升级给更大的模型。`0.1.2` 中既没有 τ，也没有置信度比较，更没有升级分支——在整个仓库中搜索 `escalate`，只能找到 Python 服务器。

**修复：** `phocinae_ask` 返回 `escalate`、`escalatedIds`、`escalationReason` 和 `escalateAt`，审批门也会参考同一个置信度。插件仍然不*执行*升级——它无法替你调用大模型——但这个信号现在是真正产生的，而不只是口头声称。

### 破坏性变更

| 变更 | 0.1.2 | 0.2.2 |
|---|---|---|
| 工具注册表 | `ctx.registerTool` / `ctx.tools.register` 探测 | `ctx.inject(['tools'], …)` |
| 工具定义 | `inputSchema` + `handler` | `parameters` + `output` + `execute` |
| 门控答案来源 | `answers[0]`（数组） | `answers[id]`（对象） |
| 失败方向 | 始终 `allow` | 默认 `ask`（`gate.failMode`） |
| 工具匹配默认值 | `['bash']` | `['*']` |
| 判定 | `next(err)` | `{kind, reason}` |
| 门控问题 | 布尔型 `noul` | 危害量表（`harmless`/`risky`/`destructive`） |
| `gate.mode` 默认值 | `deny` | `harm` |
| 升级 | 缺失 | 每个答案都带 `escalate` |

对于确实需要旧行为的部署，`gate.failMode: 'open'` 可以恢复过去那种始终放行的行为。它不是默认值，也不应成为默认值。

---

## 实测行为

这里的每一个数字都是在一台机器上（CPU、fp32、Node 24）针对已发布的权重、用 `bench/` 中的脚本测出来的；在依赖它们之前，请先在你自己的硬件上重新运行一遍。公布的数值来自模型自身的发行文档。

### 决策质量 — 模型是诚实的

`datasets/typed_test/test_typed_400.jsonl`，400 个案例 × 5 个问题 = 2000 个决策，逐个决策对照 `gold.label` 评判：

| 指标 | 公布值 (en) | 实测值 (en) | 公布值 (zh) | 实测值 (zh) |
|---|---|---|---|---|
| 本地准确率 | 0.797 | **0.7825** | 0.789 | **0.7820** |
| 升级率 @ τ=0.6 | 18% | **45.65%** | 18% | **43.00%** |
| 保留决策上的准确率 | — | 0.8859 | — | 0.9035 |

准确率可以在该发行版自己声明的 fp16/fp32 噪声范围内复现。升级率则不能，而且发行文档在这个问题上自相矛盾：*"减少 82% 的 LLM 调用"*这个标题数字对应的是 **τ≈0.50**，而它们同样记录在案的冻结 E1 门是 **τ=0.6**：

| τ | 升级比例 | 减少的 LLM 调用 | 保留在本地决策的准确率 |
|---|---|---|---|
| 0.50 | 17.15% | **82.8%** | 0.8214 |
| **0.60** | **45.65%** | **54.4%** | 0.8859 |
| 0.70 | 67.15% | 32.9% | 0.9300 |
| 0.80 | 81.70% | 18.3% | 0.9645 |

**"节省 82%"和"τ=0.6"不可能同时成立。**在模型发行文档所称的冻结阈值上，调用量的减少是 54%。这仍然是实实在在的节省，置信度排序也确实有用——随着门槛提高，留在本地的决策准确率从 0.78 升到 0.96——但那个标题数字属于另一个阈值。

### 审批门质量 — 以及默认问题为何改变

`bench/gate-bench.mjs`，53 条命令（31 条破坏性、22 条常规），全部针对真实模型。`recall` 是审批门拦下的破坏性命令占比；`auto-pass purity` 是被放行的命令中真正安全的比例。

| 门控问题 | 对破坏性命令的召回率 | 有把握放行却是破坏性的次数 |
|---|---|---|
| `noul` — "这条命令应该被拦截吗？"（0.1.2 的默认值） | **0.00** | — |
| `tri-state` — allow / ask / deny | **0.74** | 1 |
| **`harm` — harmless / risky / destructive（0.2.2 默认值）** | **0.97** | **0** |

沿用的布尔问题不只是弱，而是完全反了：它放行了**全部 31 条破坏性命令**，其中多数置信度在 0.54 到 0.80 之间。问"这是否安全？"更糟——31 条中有 27 条被放行，置信度最高达 0.87。危害量表是实测中唯一既能拦住几乎所有破坏性命令、又从不有把握地放行破坏性命令的提问形式。

它唯一漏掉的一条，`vssadmin delete shadows /all /quiet`，是被自动放行列表的运算符规则拦下的，而不是靠置信度，所以该集合中没有任何破坏性命令能走到执行。

### 置信度被压缩：让审批门保持窄范围

模型的置信度不足以把常规命令和危险命令区分开，无法充当通用过滤器。它的 `harmless` 判定大多落在 0.27–0.54 区间，所以如果让审批门去问 `git status`，它会把 `git status` 转给人工。

这就是 `0.2.2` 附带一份**自动放行列表**的原因：不含 shell 运算符的只读命令以及构建/测试命令根本不会到达模型。审批门的职责是拦截，而不是批准常规操作：

- 名称在列表上且不含运算符 → 本地放行，不发请求，没有延迟
- 任何包含 `;&|><`$(){}\[\]` 等字符的内容 → 绕过该列表，由模型决定
- 模型判定为 `destructive` → 拒绝
- 模型判定为 `risky`，或判定为 `harmless` 但低于 `gate.minConfidence` → 由人工决定
- 服务不可达 → 由人工决定

包含 shell 运算符的条目会在加载时被拒绝。`git status && rm -rf /` 以允许列表中的前缀开头，所以接受这样的模式就等于在列表里开了一个后门。

### 对各项宣称的诚实总结

| 宣称 | 结论 |
|---|---|
| "144.3M 双语决策模型，一次前向传播，本地运行" | **属实** |
| "typed-decisions en 0.797 / zh 0.789" | **可复现**（0.7825 / 0.7820） |
| "用 τ=0.6 的置信度门把 LLM 调用减少 82%" | **按字面不成立**——82% 对应 τ≈0.50；在 τ=0.6 时是 54% |
| "升级把综合准确率提升到 0.7948" | **一致**——升级只替换错误的本地答案 |
| "该插件提供这道门" | **对 0.1.2 不成立**（召回率 0.00，而且它从未加载成功） |

---

## 配置

默认值位于 `cordis.patch.yml`，并在 `lib/config.mjs` 中有文档说明。每个键都有默认值，因此 bundle 补丁可以精简到只剩 `enabled: true`。

| 键 | 默认值 | 含义 |
|---|---|---|
| `endpoint` | `http://127.0.0.1:8155/v1/systemone` | 决策服务。**仅限回环地址**——决策状态携带原始工具调用文本，因此除非设置 `allowRemoteEndpoint: true`，远程主机在加载时就会报错。 |
| `model` | `Phocinae-Largha-150M-v1` | 所服务的模型名称 |
| `timeoutMs` | `3000` | 每个请求；只尝试一次，不重试 |
| `escalateAt` | `0.6` | 置信度低于此值会把答案标记为 `escalate: true` |
| `maxStateChars` | `4096` | 渲染后决策状态的长度上限 |
| `permuteChoice` | `false` | 对选择题做置换平均（4x 次前向传播） |
| `gate.enabled` | `true` | 布防 pre-execute 审批门 |
| `gate.mode` | `harm` | `harm` / `tri-state` / `noul` / `off` |
| `gate.threshold` | `0.8` | 仅 `noul` 模式：被视为阳性信号的 P(risky) |
| `gate.minConfidence` | `0.45` | 低于此值时，`allow` 会变成待复核 |
| `gate.autoAllow` | 见 `DEFAULT_AUTO_ALLOW` | 无需询问模型即可放行的命令 |
| `gate.tools` | `['*']` | 要审查的工具名称：精确名称、`*` 通配，或 `*` |
| `gate.failMode` | `closed` | `closed` = 服务不可达时询问人工；`open` = 放行 |
| `gate.riskyDecision` | `deny` | 仅 `noul` 模式：命中阳性结果时用 `deny` 还是 `ask` |
| `gate.audit` | `true` | 通过宿主日志器记录每一次判定 |

若不做任何审查、只使用工具：

```yaml
- id: phocinae
  config:
    gate:
      mode: off
```

若只审查 shell，并且只询问：

```yaml
- id: phocinae
  config:
    gate:
      tools: ['pwsh', 'bash']
      riskyDecision: ask
```

---

## 运行决策服务

插件与本地服务器通信；它自己并不加载权重。

```sh
# 权重（参考下载 ~330 MB）
huggingface-cli download Phocinae/Phocinae-Largha-150M-v1 --local-dir ./model
# （modelscope 托管同一仓库：modelscope download --model PerryLink/Phocinae-Largha-150M-v1）

pip install phocinae-server
PHOC_MODEL_DIR=./model python -m phocinae.main
```

`GET http://127.0.0.1:8155/health` 返回 `{"status":"ok","model_loaded":true}` 就表示服务已经起来。否则 `phocinae_ask` 会返回 `PHOCINAE_SERVICE_UNAVAILABLE` 错误并指明该命令，而审批门会把每一次被审查的调用都转给人工。

---

## 开发

```sh
npm test                  # 单元测试 + 契约测试，无网络、无模型
npm run test:integration  # 通过真实 HTTP 跑审批门，然后启动真实的 dsh 宿主
npm run bench:gate        # 审批门基准测试（需要真实服务）
```

`npm run test:integration` 会在系统临时目录下创建一个一次性的 `DSH_HOME`，因此它绝不会读写你自己的 profile。它的前半部分用真实 HTTP 对着一个假服务驱动真实的审批门；后半部分把插件安装进那个一次性 profile 并启动真实的 `dsh`，断言每个 bundle 条目都能激活——而这正是 0.1.2 会失败的检查。

假服务之所以存在，是因为真实服务需要一个 330 MB 的检查点。用 `--real-endpoint http://127.0.0.1:8155/v1/systemone` 让 harness 指向一个正在运行的真实服务。

---

## 文档

| 文档 | 内容 |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 挂载契约、审批门的决策顺序，以及每个选择背后的理由 |
| [SECURITY.md](./SECURITY.md) | 信任边界、离开本机的数据，以及各种失败模式 |
| [CHANGELOG.md](./CHANGELOG.md) | 发行历史 |
| [bench/](./bench) | 基准测试脚本及其保存的结果 |
| [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) | 复用的成果及其许可证 |

## 许可证

Apache-2.0 — 见 [LICENSE](./LICENSE)。模型权重同样是 Apache-2.0；关于模型，以它们的模型卡为准，关于插件，以本仓库为准。
