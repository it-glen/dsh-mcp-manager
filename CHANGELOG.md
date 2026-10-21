# Changelog

本文件记录本包的用户可见变更。版本号遵循语义化版本。

## 0.3.2

修复 `ws_mcp_call` 在 DSH 2.0.18（宿主 `@deepseek-ai/dsh-tools` 0.2.1-rc.2）上**全部调用失败**
的问题。两个错误依次出现，互为因果，必须一起修：

### 修复：`Cannot read properties of undefined (reading 'seq')`

远端转发子调用此前**刻意不带 `agent`**（注释口径：带了就等于把子调用挂回该 agent 的
作用域）。实际后果是宿主的 `tools/pre-execute` 拦截链拿到一个 agent-less 的执行体，链上
某个钩子对它读 `.seq` 当场抛 TypeError，整条 `ws_mcp_call` 在 8ms 内失败——请求根本没到
MCP 传输层（`dbx-mcp.exe` 全程没被通知过）。`dbx_list_connections` 与不存在的
`dbx_detail` 报同一个错，可为佐证。

现在转发带上调用方 `agent`，进得去各钩子的正常工作分支。

### 修复：`unknown tool "mcp__<id>__<tool>"`（UNKNOWN_TOOL）

补上 agent 之后，`ctx.tools.execute` 会拿这个 agent 去 `view(scope)` 里解析注册名，而
visibility 域为了让模型面看不到 `mcp__*`，恰恰对每个 agent 做了
`restrict({ deny: [...] })`——同一个 agent 既被 deny 又被用来查工具，子调用被自己的限制
挡死，`resolveExecution` 返回 `undefined`，表现为 `UNKNOWN_TOOL`。

修法：转发执行不再走 `ctx.tools.execute`，改为从宿主注册表用 `get(name)`（省略 scope，
即全局视图；`restrict` 只作用于 agent 作用域）取出官方 `ToolDefinition`，直接调用它的
`execute`。取得的是官方 mcp-client 的原实现（`callTool` + 图片准入），返回值就是
`output.schema` 声明的 canonical value，与旧链路一致。

一处文案变化：远端 `isError: true` 此前经调度层收敛后会走 `远端工具返回错误：`，现在官方
executor 的抛错直接冒泡到 `executeRemoteCall` 的 catch，统一成 `调用失败：<原文>`——与官方
`createExecutor` 的 `throw new Error(text)`、以及宿主任何工具体抛错同一条路。失败语义不变，
只少了「这是远端业务错误」这一层区分。

已知代价：子调用不再经过宿主 `tools/pre-execute` 策略链（沙箱 / 审计 / 超时策略钩子对
MCP 子调用不生效）。MCP 是网络请求、不落本地文件，工具级禁用仍由 `isToolDenied` 裁决，
转发登记表仍是 `mcp__` 直呼的唯一放行位。

另一条同等重要的边界：**转发执行取全局视图，`restrict` 与 agent 作用域可见性对其不生效**。
这是绕开 `UNKNOWN_TOOL` 的必要条件——同一 agent 上正是本包自己下的
`restrict({ deny: [...] })`。副作用是宿主上其它来源的 agent 作用域可见性限制也拦不住
MCP 子调用；本包自己的两道工具级禁用（`ws_mcp_call` 入口 + `mcp__` 直呼守卫）不受影响。

### 加固：目录扫描不再被无 `seq` 的占位条目污染

- `catalogHistory` 读会话事件流时先滤掉 `seq` 不是数字的条目。宿主的持久化日志可能夹着
  无 `seq` 的占位条目（截断 / 种子恢复），此前 `visible.has(undefined)` 会让可见目录判定
  静默退化。全无 `seq` 时仍报 `{published: false}`，不抛。
- `renderMcpCatalogUpdate` 不再用 `content![0].text!` 的非空断言取正文——读不到就按空正文
  渲染更新帧。该组件的任何抛错都会连带整步工具面。

### 其他

- 新增 `test/unit/catalog.test.ts` 中「无 seq 的占位条目不得污染扫描与可见目录」用例。
- README（中 / 英）「已知限制」补充上述两条绕过的说明。

### 修复：升级链补登记 0.2.9 → 0.3.2

rename 到 `@it-glen` 后的 0.3.0 / 0.3.1 / 0.3.2 三个版本发布时都漏了往步骤表追加一格，刻度
因此永久停在 `0.2.9`，每次启动都告警「存储版本 0.2.9 落后于插件版本 0.3.x，缺少对应的升级
步骤」。本版补一个空步（这三个版本无 home 级存储形态变化），重启即把刻度推到 `0.3.2`，
告警消失；已升级过的安装再启动时无事可做。`test/unit/upgrade/steps.test.ts` 的刻度断言改为
锚定 `newestTargetVersion(STEPS)` 并补一条「刻度停在 0.2.9」的现场用例。

## 0.3.1

修复深色模式下输入控件底色写死白色的问题，快速接入表单三列对齐。

## 0.3.0

首个公开版本。
