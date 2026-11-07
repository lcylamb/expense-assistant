# expense-assistant

[![CI](https://github.com/lcylamb/expense-assistant/actions/workflows/ci.yml/badge.svg)](https://github.com/lcylamb/expense-assistant/actions/workflows/ci.yml)

**[English](README.md)**

用自然语言提问一张报销单，返回**结构化、可校验**的回答：结论、依据字段，以及数据是否不足以回答。答案通过 SSE 逐块返回。

**在线演示：<https://assistant-demo-0rgz.onrender.com>**（免费实例，第一次访问需要等约 40 秒唤醒）。本地运行：`npm run dev` 之后打开 <http://localhost:5173>，默认使用 mock provider，不需要任何 API key。

## 特性

- **结构化输出**：模型必须返回 JSON；完整答案逐字段校验，不合格返回 `502`，不会把半个答案交给用户。
- **依据可核对**：`evidence` 只接受本次实际查询过的字段，不存在的字段会被剔除并记录。
- **工具调用**：模型通过 3 个只读工具自行取数；单号由服务端绑定，模型无法指定其他单据。
- **流式输出**：从半截 JSON 中增量提取结论；流式与非流式共用同一套最终校验。接入真实厂商时为首字即达的真流式，mock 为分块模拟。
- **多轮对话**：客户端回传上一轮的结构化结论，服务端不保存会话。
- **先登录，再谈可见性**：真实的用户名密码登录（scrypt 加盐哈希 + 签名会话 cookie）；密码对了才进得去，进去之后能看到哪些单据由服务端按角色决定。
- **可评测**：24 条用例覆盖工具轨迹、提示注入和越权，CI 使用真实数据库运行。
- **真前端，不是演示页**：React 18 + TypeScript + Ant Design 5，react-router 管路由，Vite 构建进 `public/`，和 API 同一个进程托管（同源，免 CORS）。身份层和数据层是两个 context，页面只读它们；页面按组件拆分并有 Testing Library 测试；源码在 `web/`，构建产物不进仓库。
- **可观测**：请求 id、访问日志、延迟 / 首字 / token / 成本指标、被拒绝请求计数。
- **默认 mock**：规则表 provider 让全部测试无需网络与密钥即可复现。

## 快速开始

前置：Node 22.12+、Docker。

```bash
cp .env.example .env      # 默认连接本机 5433 上的 PostgreSQL
npm install
npm run db:up             # 启动 PostgreSQL 容器
npm run db:migrate        # 建表
npm run db:seed           # 写入 10 张虚构报销单
npm run dev               # 接口 :3100 + 前端 :5173（热更新，开 5173）
```

`npm run dev` 会同时起两个进程：Nest 在 3100 上 `--watch`（改后端自动重启），Vite 在 5173 上（改前端热替换，不刷新页面）。**开发时看 5173**；3100 只是接口，它顺手托管的那份页面是上一次 `npm run build` 的产物，所以根路径会被转到 5173，省得你对着旧页面怀疑代码没生效。

只有三种改动需要手动重来：改 `.env`、改 `prisma/schema.prisma`、装新依赖。

常用脚本：

| 命令 | 作用 |
|---|---|
| `npm run db:reset` | 清库并重新 seed |
| `npm run db:studio` | 数据浏览器（localhost:5555） |
| `npm run probe:stream` | 请求流式端点，打印每块数据的到达时间 |
| `npm run mcp` | 启动 MCP server（stdio），把只读工具暴露给任意 MCP 客户端 |
| `npm run eval` / `eval:real` | 用 mock / 真实模型运行评测 |
| `npm run lint` / `npm test` / `npm run test:e2e` | 静态检查与测试 |
| `npm run dev:web` | 前端 Vite 开发服务器（`/auth`、`/assistant` 代理到 :3100） |
| `npm run test:web` | 前端组件测试（Testing Library + jsdom） |
| `docker compose up --build` | 数据库 + 迁移 + 应用，整套运行在容器里 |

## 账号与可见性

网页是一个真正的登录表单。密码以 scrypt 加盐哈希存库；登录成功后服务端在 **httpOnly** cookie 里种一张签名令牌（JWT，8 小时有效，`SameSite=Lax`）。令牌里只放用户 id —— 姓名和角色每次请求都从库里读，所以改了权限立刻生效，不用等令牌过期。

seed 里的账号（密码统一 `demo1234`，演示数据，公开写在这里）：

| 登录名 | 姓名 | 角色 | 可见 |
|---|---|---|---|
| `zhangsan` / `lisi` / `wangwu` / `zhaoliu` / `sunqi` | 张三 / 李四 / 王五 / 赵六 / 孙七 | `applicant` | 只有自己提交的单 |
| `wangjl` | 王经理 | `approver` | 全部已提交的单（草稿不可见） |
| `zhengshi` | 郑十 | `auditor` | 全部，含草稿（只读对账） |

可见性规则只有一份实现（`viewer.ts`），在三个地方强制执行：列表接口按它收窄集合，`prepare()` 在会话开始前拦下不可见的单号，每个工具的查询把同一条条件拼进 `where` —— 就算绑定层出了 bug，行也漏不出去。归属认 `applicantId` 而不是姓名：真实公司里确实会有两个张三。

询问别人的单据，返回和「单号不存在」完全一致的 `404`。接口不替任何人确认别人单据的存在性。

以下是**刻意没有做**的部分，写出来而不是藏起来：

- **身份不是入参。** 请求体里没有 `viewer` 字段，塞一个进来会被 `400` 打回。旧的「客户端声明身份」已经删掉 —— 那时一句 curl 就能当审批人。
- **没有吊销列表。** 会话是无状态的，退出只清浏览器里的 cookie；被复制走的令牌在过期前仍然有效。这是不维护会话表的代价，也是令牌必须放 httpOnly 的原因（页面脚本拿不到副本）。
- **登录和提问共用一个按 IP 的额度。** 一分钟内连续输错三次密码，同时也会被挡住提问。
- **没有改密码 / 用户管理。** 账号来自 seed。

生产环境要配 `SESSION_SECRET`（≥32 字符）。不配也能启动，但每次启动随机生成一把密钥 —— 重启后所有人重新登录，多实例之间也互不认账。TLS 在应用前面终止时，用 `COOKIE_SECURE` 覆盖 `Secure` 标记。

## MCP server

模型用的那批只读工具，同时以 MCP server（stdio 传输）对外提供 —— Claude Code、Cursor 等任何 MCP 客户端都能直接查这份数据：

```
expense-assistant (mcp/server.ts)
  ├─ list_expenses        发现单子（可按状态过滤）
  ├─ get_expense_summary  按单号查表头
  ├─ list_expense_items   按单号查明细 + 合计
  └─ get_approval_record  按单号查状态 / 决策时间 / 审批人 / 审批意见 / 驳回原因
```

在 MCP 客户端配置里注册（把绝对路径换成你的）：

```json
{
  "mcpServers": {
    "expense-assistant": {
      "command": "/path/to/expense-assistant/node_modules/.bin/tsx",
      "args": ["/path/to/expense-assistant/mcp/server.ts"]
    }
  }
}
```

依赖与应用相同：`.env` 里的 `DATABASE_URL`、Postgres 已起且已 seed。server 从仓库根目录读 `.env`，与客户端拉起子进程时的工作目录无关；数据库连不上会在启动时直接失败，不带病启动。

关于安全边界：Web 版把单号绑在服务端，模型不能选查哪张单；MCP 的调用者是操作者本人（本机进程、本机库），等同直接读库的权限，所以这里的工具接受 `code` 参数、也提供了发现单号的工具。不变的两条：全部只读，没有自由 SQL 的口子。

## 用法

### 一次性问答

```bash
# 1. 先登录，cookie 存进文件，后面带着它
curl -c /tmp/ea.jar -X POST localhost:3100/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"zhengshi","password":"demo1234"}'

# 2. 提问。请求体里没有身份 —— 服务端从会话里读
curl -b /tmp/ea.jar -X POST localhost:3100/assistant/ask \
  -H 'Content-Type: application/json' \
  -d '{"code":"BX-2026-0003","question":"这张单子为什么被驳回了？"}'
```

```json
{
  "conclusion": "BX-2026-0003 已被驳回，驳回原因：招待费超出部门月度预算，且缺少参与人员清单",
  "evidence": ["code", "status", "rejectReason"],
  "insufficient": false,
  "trace": [{ "tool": "get_approval_record", "ok": true }],
  "metrics": {
    "elapsedMs": 912,
    "ttftMs": null,
    "modelCalls": 2,
    "toolMs": 18,
    "usage": { "promptTokens": 1820, "completionTokens": 96 }
  }
}
```

数据中没有答案时，返回值明确标记为信息不足：

```json
{
  "conclusion": "BX-2026-0005 还没走到审批环节（草稿），数据里没有审批意见。",
  "evidence": ["code", "status"],
  "insufficient": true,
  "trace": [{ "tool": "get_approval_record", "ok": true }]
}
```

### 流式

`POST /assistant/askStream` 的请求体相同，响应为 `text/event-stream`：

```
event: delta
data: {"text":"这张"}

event: delta
data: {"text":"单子"}

event: done
data: {"conclusion":"…","evidence":["status"],"insufficient":false,"trace":[…],"metrics":{…}}

event: error
data: {"message":"模型调用失败，请重试"}
```

`delta` 是增量文本，可能被后续内容修正；只有 `done` 是最终结果，其结构与 `/assistant/ask` 完全相同。空闲超过 `SSE_HEARTBEAT_MS` 时服务端发送注释帧 `: ping`，客户端应按 SSE 规范忽略。

### 多轮对话

在请求体中传入 `history`，内容为上一轮经过校验的结论：

```json
{
  "code": "BX-2026-0002",
  "question": "那这钱都花在哪些项目上了？",
  "history": [
    {
      "question": "这张单子一共多少钱？",
      "conclusion": "BX-2026-0002 的报销金额是 ¥12800.00。",
      "evidence": ["code", "amount"],
      "insufficient": false
    }
  ]
}
```

最多 3 轮；历史只作为上下文，不扩大本轮可引用的字段范围。

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/auth/login` | `{username, password}` → 会话 cookie + 账号画像（公开） |
| `POST` | `/auth/logout` | 清除会话 cookie（公开） |
| `GET` | `/auth/me` | 当前账号画像，未登录返回 `401` |
| `POST` | `/assistant/ask` | 一次性返回 `AskResult` |
| `POST` | `/assistant/askStream` | SSE：`delta` → `done`，或中途 `error` |
| `GET` | `/assistant/expenses[?category=TRAVEL]` | 当前登录账号可见的单据 + 概览统计 |
| `GET` | `/assistant/metrics` | 进程内指标快照 |
| `GET` | `/health` | 执行一次 `select 1`，数据库不可用时返回 `503` |

除 `/auth/login`、`/auth/logout`、`/health` 之外，所有端点都要求会话 cookie，否则 `401`。所有响应带 `X-Request-Id`，日志为 JSON 行，其中 `reqId` 字段与响应头同值。

| 状态码 | 含义 |
|---|---|
| `400` | 入参校验失败 |
| `404` | 单号不存在 |
| `429` | 触发限流、并发上限或日额度 |
| `502` | 模型调用失败，或输出无法通过格式校验 |
| `503` | 数据库不可用 |
| `504` | 超过单次提问总预算 |

流式端点开始写响应头之后无法修改状态码，因此调用失败、格式异常、数据库中途不可用表现为 `200` + `error` 帧。

## 设计概览

```
请求 → 参数校验 → 限流 / 并发守卫 → 查询单号 → Agent 循环（模型 ↔ 工具）→ 解析与剔除 → 响应
```

几个关键选择：

- **输出不可信任。** 完整答案经过类型校验；依据字段必须来自本次工具返回值，否则剔除。返回 `502` 只用于格式错误，不用于「措辞不够好」。
- **工具参数里没有单号。** 单号由服务端绑定；不提供全表搜索。模型可触及的数据范围由服务端决定。
- **流式不另起一套解析。** 两条端点共用 `prepare()` 和 `settle()`；增量文本在流结束后仍要经过完整校验。
- **取消信号早于响应头。** 流式端点在查询单号之前就监听连接关闭，客户端提前离开时不会调用模型或消耗额度。
- **三层限制。** 频率、并发、日额度分别处理刷接口、请求堆积和额度耗尽。
- **错误按来源分类。** 厂商故障是 `502`，数据库故障是 `503`，超时是 `504`，用户取消不计入错误。

详见 [docs/design.md](docs/design.md)。

## 评测

24 条用例，每条同时请求两条端点；期望值大多从数据库计算得出，不是手写常量。

```
npm run eval        （mock）   ：通过 14　已知不足 9　不符预期 0
npm run eval:real   （DeepSeek）：通过 23　已知不足 0　不符预期 0
```

- 结构底线永远算失败，不豁免：依据字段必须存在、金额与日期必须可溯源、工具不能失败、确定性 provider 下两条端点结论相同。
- 轨迹断言要求每条用例调用指定工具，避免「答案碰巧正确」。
- mock 上的 9 条已知不足对应规则表缺失的能力；真实模型上全部通过。
- 评测通过注入变异验证过会失败，因此全绿不是「断言失效」。

用例表、判定层次与真实模型结果见 [docs/evaluation.md](docs/evaluation.md)。

## 测试与 CI

```bash
npm test          # 单元测试，不依赖数据库
npm run test:e2e  # 端到端测试与评测，需要数据库
npm run lint      # oxlint（含类型检查）
```

CI 在推送到 `main` 以及发起 PR 时执行 `lint` → `tsc --noEmit` → `build` → 单元测试 → 端到端测试。数据库由 Actions service 容器提供，每次从零迁移并 seed；末尾构建并启动真实容器，验证探活、一次请求、镜像中无密钥、进程非 root、`docker stop` 正常退出。

CI 只运行 mock；真实模型评测在本地手动执行。

## 配置

主要变量：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `LLM_PROVIDER` | `mock` | `mock` 或 `openai`（OpenAI 兼容协议） |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | — | `openai` 模式必填 |
| `RATE_LIMIT_PER_MINUTE` | `30` | 每 IP 每分钟请求数 |
| `MAX_CONCURRENT_ASKS` | `8` | 同时在途的模型请求上限，`0` 关闭 |
| `LLM_DAILY_LIMIT` | 关闭 | 每日模型调用上限 |
| `ASK_TIMEOUT_MS` | `90000` | 单次提问总预算 |
| `LLM_TIMEOUT_MS` | `30000` | 单轮调用上限 |
| `SSE_HEARTBEAT_MS` | `15000` | 流式空闲心跳间隔 |
| `TRUST_PROXY` | 未设置 | 反向代理跳数，仅在确实有代理时设置 |

换成真实模型只需修改 `.env`，代码无需改动：

```bash
LLM_PROVIDER=openai
LLM_API_KEY=...
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-chat
```

`npm run eval:real` 会用同一份评测集重新运行。

完整列表与取值说明见 [`.env.example`](.env.example) 和 [docs/operations.md](docs/operations.md)。

## 部署

```bash
docker compose up --build   # 数据库 + 迁移 + 应用
```

镜像分五段构建，运行时以非 root 执行，不包含密钥；启动时检查数据库，关闭时不等待活跃连接。部署目标为 Render + Neon，迁移需从本机手动执行一次。

细节见 [docs/operations.md](docs/operations.md)。

## 已知限制

这是一个练习项目，不是生产系统：

- 权限只到「三种角色 × 可见性」这一层，没有按部门、按金额分级的细分权限；也没有多租户隔离 —— 一个部署服务一个组织；
- 指标、限流、并发上限、日额度都保存在单个进程的内存中，多实例各算各的、重启清零；
- 没有 tracing、日志聚合或跨实例聚合；
- 增量解析器不保证 `conclusion` 是顶层键，兜底是流结束后的完整校验；
- 成本估算不含缓存价，结果是上界而非账单；
- mock 的 token 用量按字符数估算，不是分词器结果；
- 真实模型评测是一次采样，输出不保证可复现。

范围之外：**单据**问答不做 RAG（数据本身是结构化的，直接查库更合适）、复杂 Agent 编排、消息持久化。**不做审批流**：没有审批节点、流转、加签、催办，也没有审批记录表 —— 单据上只保留决策结果（状态、决策时间、审批人、审批意见或驳回原因），制度手册里的三级审批是公司制度条款，不是本系统实现的能力。费用政策问答是另一个模块（`/knowledge/ask`，本地 embedding + 向量检索 + 引用校验，需要真实模型），见 [docs/knowledge.md](docs/knowledge.md)。

## 数据

仓库中的所有数据均为虚构：姓名为「张三 / 李四 / 王五 / 赵六 / 孙七」等占位名，不含真实人员、证件号、手机号，也没有来自真实业务系统的数据。金额同样是编造的。

seed 写入 10 张报销单，覆盖草稿、待审批、已通过、已驳回、已支付等状态，用于评测中的正常路径与陷阱用例。已决策的单还带审批人和审批意见 —— 通过和打款的单答「审批意见是什么」要答得出正文，草稿和待审批的才答「信息不足」。

## 许可证

[MIT](LICENSE)
