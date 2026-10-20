**English** · [中文](./README-zh.md) · [Español](./README-es.md) · [Português](./README-pt.md) · [हिन्दी](./README-hi.md)

<img src="docs/assets/logo_phocinae.png" width="120" alt="斑海豹 Phocinae logo">

# dsh-phocinae

**DeepSeek Harness 的本机非生成式决策层。** 一个 1.5 亿参数模型用一次前向回答是/否、单选与 2–10 评分，并用 fail-closed 审批门在工具调用执行前筛查。

- 全在本机运行；不调用云 API，不需要 API key。
- `phocinae_ask` 做批量结构化判断；`phocinae_gate` 判断单条命令或动作。
- 审批门挂在 `tools/pre-execute`：服务不可达时转人工，绝不静默放行。
- 模型不写文章、不写代码；每次只做一个结构化判断。

## 快速开始

```sh
pip install phocinae-server
huggingface-cli download Phocinae/Phocinae-Largha-150M-v1 --local-dir ./model
PHOC_MODEL_DIR=./model python -m phocinae.main
dsh plugin --profile web add dsh-phocinae@0.2.5
curl http://127.0.0.1:8155/health
```

`{"status":"ok","model_loaded":true}` 表示服务就绪。安装时请固定 `dsh-phocinae@0.2.5`：直接 `add dsh-phocinae` 可能在 pnpm 的 `minimumReleaseAge` 窗口内解析到旧版本。

## 你会得到什么

| 能力面 | 作用 |
|---|---|
| `phocinae_ask` | 对同一个 state 最多 64 个结构化问题；返回答案、校准置信度与建议性的 `escalate` 标记。 |
| `phocinae_gate` | 把一条命令或动作判为 `allow`、`ask`、`deny`；只判断，不执行。 |
| `tools/pre-execute` 门 | 执行前筛查所有匹配 `gate.tools` 的工具调用；失败关闭。 |
| `phocinae` skill | 告诉模型何时该用本机决策，以及如何读 `escalate`。 |

## 示例

对同一个 state 问两个问题：

```json
{"state":"用户想删除 /tmp/build。该路径在工作区内。","questions":[{"id":"safe","type":"noul","threshold":0.8},{"id":"urgency","type":"score"}]}
```

返回结构如下：

```json
{"answers":{"safe":true,"urgency":4},"confidence":{"safe":0.92,"urgency":0.71},"escalate":false}
```

判断一条危险命令：

```json
{"command":"rm -rf /","toolName":"shell","cwd":"/home/me/project"}
```

返回 `decision: "deny"` 及原因、置信度；命令不会被执行。以上输出只说明结构，不是录制夹具。

## 工作方式

1. 宿主调用 `phocinae_ask`、`phocinae_gate` 或 pre-execute 门。
2. 插件把原始 state 发到 `http://127.0.0.1:8155/v1/systemone`。
3. 服务对每个问题返回一个结构化答案。
4. 审批门把答案映射为 `allow` / `ask` / `deny`；低置信度变成 `escalate`，服务不可达在 `failMode: closed` 下转人工。

## 配置

默认值在 `cordis.patch.yml` 与 `lib/config.mjs`；每个键都有默认值。

| 键 | 默认 | 含义 |
|---|---|---|
| `endpoint` | `http://127.0.0.1:8155/v1/systemone` | 决策服务地址；除非 `allowRemoteEndpoint: true`，否则只允许回环。 |
| `timeoutMs` | `3000` | 单次请求超时；只尝试一次。 |
| `escalateAt` | `0.6` | 置信度低于此值标记 `escalate: true`。 |
| `gate.mode` | `harm` | `harm`、`tri-state`、`noul` 或 `off`。 |
| `gate.tools` | `['*']` | 要筛查的工具名：精确名、glob 或 `*`。 |
| `gate.failMode` | `closed` | `closed` 在服务不可达时转人工；`open` 放行。 |

只使用工具、不启用审批门：

```yaml
- id: phocinae
  config:
    gate:
      mode: off
```

## 安全与边界

- **仅回环。** state 含原始工具调用文本；除非显式允许，非回环 endpoint 会在加载时报错。
- **Fail-closed。** 服务错误/超时会转人工；缺失工具名不会被当作安全。
- **不是沙箱。** 审批门是额外审批信号，不替代宿主沙箱与人工审批。
- **不生成内容。** 模型不能回答知识问题、写代码或总结；这些请用聊天模型。

## 兼容性

- Node `^22.19` 或 `>=24`。
- DSH `>=0.2.1-0 <0.3.0`；bundle 行会挂载 `phocinae_ask`、`phocinae_gate`、审批门与 skill。
- `phocinae-server` 必须在配置的 endpoint 可达。

## 排查

| 症状 | 处理 |
|---|---|
| `PHOCINAE_SERVICE_UNAVAILABLE` | 启动服务并检查 `curl http://127.0.0.1:8155/health`。 |
| 直接 add 装到旧版本 | 用 `dsh-phocinae@0.2.5` 重新安装；检查 `dsh --profile web --dump-config`。 |
| 审批门什么都问 | 先确认服务在跑；`failMode: closed` 下服务不可达本来就会转人工。 |
| 审批门太严/太松 | 调整 `gate.mode`、`gate.tools`、`gate.minConfidence`、`gate.autoAllow`；不要直接关掉。 |

## 许可证

Apache-2.0。模型卡与服务是独立项目：[Phocinae-Largha-150M-v1](https://huggingface.co/Phocinae/Phocinae-Largha-150M-v1) 与 [phocinae-server](https://github.com/Phocinae/phocinae-server)。
