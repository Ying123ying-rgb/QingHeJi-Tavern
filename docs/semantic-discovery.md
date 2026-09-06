# v0.3.0 Semantic Discovery

## 存档

所有知识与应用账本都属于当前聊天元数据 `qingheji_tavern`，不进入全局渠道设置。

```js
inventory: {
  item_id: {
    id: 'item_id', label: '物品名', quantity: null, quantityKnown: false,
    unit: '', category: 'other', description: '', discovered: true,
    metadata: {}, sourceRefs: [], updatedAt: null
  }
}
npcs: {
  npc_id: {
    id: 'npc_id', name: '姓名或身份', mentioned: false,
    encountered: false, known: false,
    appearance: { status: 'unknown', facts: [] },
    basicInfo: { gender: null, age: null, occupation: null, identity: null },
    personality: { confirmed: [], impressions: [] },
    preferences: { likes: [], dislikes: [] },
    relationship: { label: '', familiarity: 0 }, history: [],
    currentLocationId: null, knowledge: {}, knowledgeProgress: 0,
    sourceRefs: [], metadata: {}
  }
}
processedMessageIds: {} // 消息 ID -> {hashes: [], updatedAt}
semanticEvents: {}      // 轮次及事实指纹 -> 已应用标记
pendingDiscoveries: []
```

`sourceRefs` 保存 messageId、消息 hash、roundId、evidence 和 confidence。数量未知存 null；已知数值必须有限、非负且不超过 1e9，并在证据中与对应物品相邻。不会借用同一句中另一物品的数字。未知库存再获得明确数量仍无法算出总量，继续显示未知；明确清点使用 set。

## Provider 与应用边界

```text
完整聊天轮次 / 手动历史同步
  → semanticInput（世界模板、已知实体、当前角色、消息）
  → LocalSemanticProvider 或 SecondaryAIDiscoveryProvider
  → validateSemanticDelta
  → applyValidatedDelta（再次校验、在副本上应用）
  → 保存当前聊天
```

统一输出为 locations、actorLocation、inventory.add/remove/set、npcs、actions、locationUpdates；精确条目契约在 `core/secondary-api.js` 的 SEMANTIC_PROMPT。实体与 NPC 每项资料均须附 messageId、原文连续片段 evidence、0–1 confidence。校验限制结构、字符串长度、集合大小、危险属性、ID、引用、数值和证据来源，非法 JSON 或结构不会部分写入存档。没有货币、技能、剧情或随机奖励修改通道。

置信度至少 0.9 且无疑问/计划语气的事实才自动应用；模糊项进入 pendingDiscoveries。地点名称、物品名称和资料还需要原文证据。模型依然可能误读主语或语义，数值和原文校验不能证明所有事实正确，因此保留手动纠错。

mentioned 地点不标记到达，mentioned NPC 不进入图鉴。实际互动才能首次遇见；不根据当前角色卡自动建立 NPC。容貌/基础信息/偏好/经历分别附证据，逐渐合并。性格单次行为作为 impression；至少两个独立轮次且不同原文证据才 confirmed，明确一向/一直等强证据可以直接确认。资料进度按已解锁项数量计算，上限 100%，familiarity 固定为 0，不是好感度。

人物手动纠错替换所选资料项，保留其他项和来源历史。原有世界自动发现撤销继续针对地点、行动及地点知识；本版物资和 NPC 通过各自手动修正，不纳入旧世界撤销补丁。

## 本地模式

继承保守地点/行动规则，新增「在某地转了转/逛了逛/活动了」等完成式；识别明确清点列表、获得数量、总数和一些物品的未知数量。包含计划、假设、传闻等表达时宁可跳过。不按具体世界名词分支，不根据「收集了点东西」猜物品名称。复杂语义及 NPC 提取主要交给已配置渠道；无渠道可手动补录。

## 请求与同步

全局 `extensionSettings.qingheji_tavern.secondary` 保存 `{channels: [], activeChannelId}`，每个渠道有 id、name、baseUrl、apiKey、model、temperature、maxTokens、timeout、reasoning、enabled。默认 0.1 / 2048 / 60 秒 / none。

地址去除尾部斜线，再拼接 `/chat/completions`，保留已有 `/v1`；完整 completion 地址不重复拼接。发送 model、messages、temperature、max_tokens、stream:false，非 none 时带 reasoning_effort。none 默认省略以兼容不支持该字段的服务。使用严格 JSON 提示词，不强制所有兼容服务实现 response_format。传输形状参考 [OpenAI Chat Completions 官方接口](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)；具体兼容服务需支持所选参数与浏览器 CORS。

处理 400、401、403、404、429、非 JSON、空 choices、截断、超时和取消。错误提示不回显响应正文、密钥或原始网络异常。没有渠道时不发请求；启用渠道请求失败时提示错误，不标记该批已处理。切聊天/关闭插件/切配置会取消未完成请求并拒绝过期写入。

自动扫描等待正常生成完成事件，包含最后 User 与对应完整 Assistant，流式事件逆序也只执行一次。历史同步默认最近 30 条，可选 10/50/全部；边界补齐同一轮 User，因此实际消息数可能略多于所选范围。逐轮串行，每轮一个请求，单轮超过 60000 字符时拒绝截断扫描并提示。

消息 ID 由角色和时间（缺失时索引）构成指纹，hash 包含角色与全文。已处理未变更消息跳过，轮次事实账本进一步抑制 User/Assistant 重复描述同一收获。编辑过的已处理消息以及「重新分析」只进入候选，不再次应用。指纹用于去重，不是加密签名；同一轮两次完全相同的收获可能被保守合并，可手动校正总数。

本地已处理过的消息也参与去重；之后开启副 API，可用重新分析查看新候选并手动补录。本版待确认发现提供查看/忽略，不提供自动批量确认，以免重分析重复改数。

## 验证边界

`scripts/check.cjs` 覆盖旧引擎回归、地点活动与传闻、清点与未知数量、重复扫描、NPC 渐进知识、消息证据、错误 JSON、渠道关闭、API 错误和密钥不回显。`scripts/browser-check.cjs` 覆盖真实 Chromium 的 320px 布局、表单、模拟完整轮次/API、切聊天、刷新、重复事件和挂载恢复。

所有网络测试使用模拟响应；真实渠道、Android 网络跨域、SillyTavern 实际保存与输入法尚须实机验收。
