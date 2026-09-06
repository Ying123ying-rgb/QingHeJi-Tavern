# v0.2.0 动态世界发现接口

所有运行时数据属于 `chatMetadata.qingheji_tavern`。模板不生成默认地点；新聊天的 locations、actions 为空。下文使用通用示例 ID，不代表内置玩法。

## Location 与人物位置

```json
{
  "locations": {
    "location_a": {
      "id": "location_a",
      "label": "地点 A",
      "type": "custom",
      "mentioned": false,
      "discovered": true,
      "visited": false,
      "description": "用户可选填的简介",
      "capabilities": [{ "id": "custom_capability", "label": "自定义功能", "source": "user", "metadata": {} }],
      "resources": [{ "id": "resource_a", "label": "已知资源", "known": true, "source": "user", "metadata": {} }],
      "services": [{ "id": "service_a", "label": "自定义服务", "type": "custom", "source": "user", "metadata": {} }],
      "actions": ["action_a"],
      "tags": [],
      "discoveredAt": "2026-09-07T00:00:00.000Z",
      "updatedAt": "2026-09-07T00:00:00.000Z",
      "source": "user",
      "metadata": {}
    }
  },
  "actions": {
    "action_a": { "id": "action_a", "label": "自定义行动", "enabled": true, "temporary": true, "source": "user", "locationIds": ["location_a"], "metadata": {} }
  },
  "discoveryLog": [],
  "discoveryScan": {}
}
```

- mentioned 是传闻/提及；仅有 mentioned 不进入地点列表。discovered 为确认知道；visited 为已到达，并蕴含 discovered。
- Capability 不存在枚举白名单。输入可以是字符串 ID 或 `{id,label,metadata}`，写入时统一成对象；无显示名时以 ID 显示。服务和资源也允许任意 ID/动态名称，同 ID 或已知同名知识复用。
- 空 resources 显示“未知”，不补猜测资源。数组按 ID 合并追加，不用一次更新替换旧知识。资源 known=false 不显示为已知。
- 每个 actor 独立保存 `locationId: null | string`；旧 location 占位不用于定位。当前地点从 `resolveControlledActor(game, ctx).locationId` 读取。手动“设为当前人物所在”只调整当前人物并确认该地点已到达，不执行移动消耗或剧情。
- Action.locationIds 为空表示不受地点限制。关联时同步 location.actions 与 action.locationIds；删除行动清理地点中的引用。当前位置视图展示该地点可用的已启用行动，“全部行动”展示聊天全部行动。查看地点详情不会移动人物。
- 旧存档新增空 locations、discoveryLog、discoveryScan，旧 actor 补 locationId=null，旧 Action 补 locationIds=[]；采用 schemaVersion 5 的增量兼容，不重置现有世界/人物/行动。切换世界模板保留发现知识及行动、清空人物当前位置，沿用原人物模拟数值重置行为。

## 流程与校验

```text
完整 user + assistant 一轮
  -> extractDiscoveryCandidates(detachedInput, provider)
  -> validateDiscovery(candidate, latestGame, { source })
  -> applyWorldDelta(latestGame, validatedDelta, { source, turnId })
  -> 当前聊天 saveMetadata()
```

提取器不访问宿主；校验和应用都是纯函数，返回副本，不原地修改存档。宿主适配层在异步边界后再次核对聊天身份、元数据对象、当前操作人物和开关，拒绝过期结果。保存失败沿用回滚；不会修改聊天消息。

World Delta 的完整键为：

```json
{
  "locationsToAdd": [],
  "locationsToUpdate": [],
  "actionsToAdd": [],
  "actionsToUpdate": [],
  "actorLocationChanges": [],
  "discoveries": []
}
```

未提供的键补空数组。新增实体可提供稳定 id，或根据 label 生成；更新须指向存在的实体。同名实体复用，冲突 ID 拒绝。actorLocationChanges 条目只允许 `{actorId, locationId}`，且引用必须存在并指向已发现地点。

校验限制字段、类型、大小、引用与非法对象键；不接受 currency、inventory、stats 等状态改动。行动扩展字段 duration/costs/requirements/effects/location/cooldown/aiRoute/handler 仅作为数据保留，不执行 handler 或 effects。自动 Delta 要求 discoveries 提供 `status: "fact"`、confidence >= 0.95 及非空原文 evidence。这是结构与来源约束，不能证明自然语言事实一定正确，因此保留撤销。

## 本地保守规则

LocalDiscoveryProvider 只读最近一轮的两条消息，不读完整历史、角色卡正文或世界书。不调用 AI。

- 接受以“我们”、当前人物名称开头的“来到/来到了/到达/到达了/进入/进入了 + 短地点名”，可含“终于/已经/现已”。登记为 discovered+visited，并修改当前操作人物位置。不会自动移动所有 NPC。
- “我”只在消息角色与当前操作人物来源一致时使用：user 消息对应 User，assistant 消息对应角色卡。主语不明确则跳过。
- “发现了地点 XX / 发现了一处地点 XX”只确认 discovered，不改位置。无类型限定的“发现了 XX”可能指物品，故不自动当地点。
- 已有当前位置时，“这里可以 XX / 这里允许 XX”产生地点关联的行动和动态功能；“现在可以 XX / 当前人物学会了 XX”可产生不限定地点的行动。短语原样作为名称，不推导商店、资源数量或游戏结算。
- “这里有资源 XX / 这里发现了资源 XX”仅追加该地点的已知资源。其他资源描述可通过手动入口逐步补充；不试图从景色推断产出。
- 任一消息含计划、愿望、将来、传闻、转述、假设、回忆、否定、疑问、引用符号、代码符号等不确定信号时，整条消息跳过；避免把多句引用或回忆中的到达误当当前事实。
- 名称限制为短字母/数字/文字短语；复杂并列句、不明确实体、长叙述宁可漏掉。地点/玩法词汇不是分支条件。用户可随时手动添加。

## 扫描时序

依据 [SillyTavern 1.18.0 官方源码](https://github.com/SillyTavern/SillyTavern/blob/1.18.0/public/script.js)，监听 `GENERATION_AFTER_COMMANDS`、`MESSAGE_RECEIVED` 和 `GENERATION_ENDED`，同时处理 `GENERATION_STOPPED`。流式输出中 ENDED 可能早于最终 MESSAGE_RECEIVED，因此等待两个信号都到齐，不能只凭 ENDED 扫描。

仅正常生成类型、完整 user/assistant 配对、确实新增的最终助手消息触发。停止/错误流、dryRun、quiet、续写、重生成、滑动、命令和页面刷新不主动扫描。记录每聊天 `discoveryScan.lastTurnId`（用户消息索引与发送时间）；运行时也记录已尝试轮次，重复事件和失败回调不循环调用 provider。保存忙时仅保留待处理完整轮次，保存结束再处理；切聊天或关闭游戏取消等待中的发现。

本版按钮 AI 调用为 0，本地自动扫描 AI 调用也为 0。未来 provider 每轮最多调用一次，不得挂到普通游戏按钮或 DOM 变化回调上。长时间异步 provider 期间只保留最新待处理轮次，允许漏扫，不同时运行多个 provider。

## DiscoveryProvider 与未来副 API

`DiscoveryProvider.extractDiscoveryCandidates(input)` 返回 World Delta 或 Promise<WorldDelta>。`extractDiscoveryCandidates()` 包装器先深复制 input，provider 无法写宿主存档。实现者只替换 provider，应用层不需要了解具体模型或规则来源。

目前仅实现 LocalDiscoveryProvider。未来 SecondaryAIDiscoveryProvider 按同一接口接入，持久化来源设为 secondary_ai。本版没有请求实现、配置页面、API Key 或网络客户端。

`SECONDARY_DISCOVERY_CONTRACT` 预留输入键、输出键和任务约束。未来输入：worldTemplate、locations、actions、controlledActor、messages（最近 user + assistant）。输出只能为上面的严格 JSON；只理解已确认的新世界事实，不得修改钱、背包数量、技能数值，不得决定重大剧情。actionsToUpdate 为可选增量键，省略时归一为空数组。

## 日志与撤销

每次产生改动，discoveryLog 追加一条批次记录，含 id/type/label/source/timestamp/turnId、明细 discoveries、undo.patches、undoneAt。手动确认还记录 touches，即使值未变也能保护用户刚确认的位置或知识。设置页展示最近 50 批，完整日志仍在当前聊天保存。

“撤销最近自动发现”仅选择最近尚未撤销的 auto/secondary_ai 批次。patch 记录实体或字段的 before/after，数组使用条目 ID，因此能分别撤销新增地点、行动及资源/服务/功能，并恢复本批次人物位置和关联。不会把整个世界恢复成旧快照。

如果目标已经被后续修改，或者存在必须保留的关联，撤销跳过冲突部分；同一字段/知识被用户手动更新或确认后保留。新增实体只有未被修改、且没有存活引用时才删除。撤销结果记录 reverted/skipped 和 undoneAt，界面提示保留项数量，不会自动继续撤销其他批次。手动来源日志不作为撤销目标。

本版本不实现商店、交易、资源采集结算、行动消耗或任何副 API 请求。
