# 酒馆人生模拟器 · QingHeJi-Tavern

通用 SillyTavern 生活模拟游戏引擎，当前版本 **0.1.3（悬浮 UI 与角色/User 操作模式）**，采用三段版本号，不是副 API 版本。青禾记 / 古代田园只是第一个世界模板。仓库与目录仍为 `QingHeJi-Tavern`。

**人物、世界和状态管理已从扩展设置页移动至聊天内悬浮游戏面板。** 世界与人物仍独立保存，本轮将控制权与查看对象拆分，并兼容此前存档。

本版结构：**一个聊天世界 + 默认跟随当前角色卡 / 一键切换 User + 可查看的 NPC**。每个聊天独立保存，SillyTavern 当前聊天角色与模拟游戏当前操作角色相互解耦。点击人物仅查看详情，不转移控制权，也不切换聊天。

不调用 AI、不开发副 API，不发送消息，不修改聊天文本、角色卡、世界书或 SillyTavern 核心代码。背包、商店、种田、摆摊、NPC 行动等均未实现。

## 安装与使用

仓库：<https://github.com/Ying123ying-rgb/QingHeJi-Tavern>

Android Termux 中正常启动已有 SillyTavern。在扩展管理中用仓库 URL 安装，已有用户更新后刷新浏览器。无需 Server Plugin、Extras、构建或 npm 依赖。

1. 扩展设置找到「酒馆人生模拟器」。插件总开关默认打开，每聊天游戏模式默认关闭。
2. 打开当前聊天游戏模式，在聊天页面右侧点击「人生」悬浮按钮。扩展设置只留下两个开关和入口说明。
3. 首次启用默认跟随当前 SillyTavern 角色卡，缺少对应 actor 时自动按世界模板创建，不需要选择或手动添加。
4. 状态页点击「切换到我」使用该聊天的 User actor，首次使用自动创建；点击「跟随当前角色」返回角色卡模式。
5. 「人物」页可添加自定义 NPC、点击名称查看只读详情。这里没有切换控制按钮，查看与关闭详情都不改变操作对象。
6. 「状态」页分别显示世界日期时间与当前操作角色的货币、stats。货币 +100 / -100 只作用于当前操作角色，即使正在查看其他 NPC。允许负数，仅为测试工具。
7. 删除 NPC 需要确认；当前操作角色不显示删除按钮。删除正在查看的 NPC 后，查看指针回到操作角色。

## 悬浮面板与生命周期

- 四页签：状态、人物、世界、设置。设置页只显示游戏模式及 AI设置/显示设置/存档管理的未来占位，没有这些功能。技术信息在最下面默认收起的「调试信息」中。
- 手机是底部抽屉，最大高度约可视区域的 88%，桌面宽屏居中。关闭按钮、遮罩点击或 Escape 均可关闭；没有打开浏览器窗口。
- 入口保留 `chat.after(host)` 挂载锚点，固定在聊天右侧。根据聊天及输入区尺寸定位，距输入区至少约 80px；空间不足时暂时隐藏入口，避免挡住导航或输入。
- 页面内原生 `dialog.showModal()` 管理遮罩、焦点和背景不可交互；后打开的宿主原生弹窗仍在上层。参照 [SillyTavern 1.18.0 自身弹窗实现](https://github.com/SillyTavern/SillyTavern/blob/1.18.0/public/scripts/popup.js)，未导入内部弹窗代码。
- 面板内部独立纵向滚动，打开时保存并锁定背景滚动样式，关闭时恢复。查看人物、改变世界后即时刷新，不关闭面板。
- 自定义人物及玩家改名使用「人物」页内名称输入表单。`visualViewport` 跟随软键盘变化，滚动输入框到可见区域。关闭/换聊天/卸载会取消尚未提交的输入。
- `mount/update/unmount` 避免重复节点。游戏模式 OFF 隐藏入口并关闭面板；总开关 OFF 移除入口和浮层，取消浮层/人物按钮监听并断开 ResizeObserver、视口监听。只保留恢复开关和跟随聊天所必需的宿主设置/事件监听。
- 320px 布局、100% 宽 select、按钮换行、至少 44px 触摸尺寸、长名字省略。正常关闭即可恢复聊天输入，无需 hover。

## 人物来源与身份

- **添加当前角色**：只读取 Context 中的 `characterId`、角色名称、`avatar` 文件名，不读取 description、scenario、first message 或世界书。相同角色来源在当前聊天内不能重复添加；同名自定义人物允许存在。
- **添加“我”**：读取公开 Context 的 `name1`，不可用时名称为「我」。每个聊天一个玩家人物，`sourceType: user`、`sourceId: self`。添加后名单提供「修改显示名称」，只改模拟人物，不改 SillyTavern persona。切换 persona 不会自动生成新人物或重命名已保存的人物。
- **添加自定义人物**：只提示填写名称，取消或全空白不创建；`sourceType: custom`。本轮没有人物编辑器或头像编辑器。

**角色身份的重要 API 限制**：官方明确 `characterId` 只是角色数组下标，并非稳定唯一 ID。本项目读取该下标定位当前角色，但 `sourceId` 使用 Context 的 `character.avatar` 文件名，在数组重排后仍能去重；`avatar` 同时保留该文件名，本版不加载头像图片。没有可用文件名时禁用「添加当前角色」，可添加玩家/自定义人物；旧存档迁移则回退为「默认人物」。群聊没有单一当前角色时同样回退。

角色卡重命名若改变文件名、删除后重新导入，可能被识别为新来源；没有修改角色卡来植入 UUID，也不声称拥有跨重导入的永久身份。人物名称是添加时的显示快照，不随角色卡重命名自动更新。

## 世界模板

| 模板 ID | 世界 | 每个新增人物的默认货币 | 世界日期 / 时间 | 每个人物的默认状态 |
| --- | --- | --- | --- | --- |
| `ancient_rural` | 古代田园 | 铜钱 100 | 三月初一 / 辰时 | 体力 100/100、饱腹 100/100 |
| `modern_city` | 现代都市 | 余额 ¥1000 | 9月6日 / 08:00 | 精力 100/100、饱腹 100/100、心情 80/100 |
| `sci_fi` | 星际时代 | 信用点 3000 | 星历2387-104 / 舰时08:00 | 行动力 100/100、氧气 100/100、舰船能源 100/100 |

切换世界提示：“切换世界模板将重置本聊天的世界状态以及所有人物的模拟状态，但不会修改角色卡或聊天记录。”

确认后保留 `enabled`、人物名单、id/name/sourceType/sourceId/avatar，以及 controlMode 和查看指针。重置 calendar、worldState 与所有人物模拟字段，包括 currency、stats、inventory、skills、relationships、personalState 及未来扩展占位。每个人按新模板取得独立副本，不做跨世界资产转换。取消保持原样。

## 数据架构

仍使用 `extensionSettings.qingheji_tavern` 保存总开关，使用当前聊天的 `chatMetadata.qingheji_tavern` 保存游戏。`data/` 是静态模板目录，不是手机存档目录。

```json
{
  "schemaVersion": 5,
  "enabled": true,
  "world": { "templateId": "modern_city", "templateVersion": 1 },
  "calendar": { "dateLabel": "日期", "date": "9月6日", "timeLabel": "时间", "time": "08:00" },
  "worldState": {},
  "controlMode": "character",
  "inspectedActorId": "actor_1",
  "nextActorNumber": 2,
  "actors": {
    "actor_1": {
      "id": "actor_1",
      "name": "砚绒",
      "sourceType": "character",
      "sourceId": "yanrong.png",
      "avatar": "yanrong.png",
      "currency": { "id": "money", "label": "余额", "symbol": "¥", "amount": 1000 },
      "stats": [
        { "id": "energy", "label": "精力", "value": 100, "max": 100 },
        { "id": "satiety", "label": "饱腹", "value": 100, "max": 100 },
        { "id": "mood", "label": "心情", "value": 80, "max": 100 }
      ],
      "inventory": {}, "skills": {}, "relationships": {}, "personalState": {},
      "location": null, "occupation": null, "schedule": [], "needs": {}, "memory": [], "flags": {}
    }
  }
}
```

`world/calendar/worldState` 为共享世界状态；其余人物模拟字段在各 actor 内。模板只读且初始化深复制，不同 actor 不共享嵌套对象。`nextActorNumber` 是聊天内递增的 ID 分配器，删除人物不复用其 ID。人物 id 无须跨聊天唯一。

- `controlMode`：每聊天独立保存，默认 `character`，另一取值为 `user`。切换聊天后读取该聊天自己的模式；character 跟随该聊天当前角色，user 使用该聊天自己的 User actor。
- `resolveControlledActor(game, ctx)`：统一解析当前操作角色，必要时在传入的独立游戏对象中创建人物。由宿主适配层持久化，不直接写聊天文本。没有可识别角色卡时返回 null，UI 提供「切换到我」。
- `inspectedActorId`：只决定人物详情显示谁，不影响操作模式或行动目标。初次解析时默认指向操作角色，已保存的有效查看指针继续保留。
- `resolveActorContext(game, ctx)`：分别返回 controlledActor、currentCharacter、inspectedActor，允许三者不同。本轮只提供辅助函数，不开发 AI。
- 所有普通行动通过统一解析函数取得目标；当前货币测试已使用它，未来背包/技能行动也应使用此入口。本轮不新增这些玩法。

UI 遍历统一的 currency、calendar、stats，不根据古代/现代/星际分别硬编码。未来新增状态只需数据项。模板原有 locations/items/shops/actions/recipes/events/rules/aiContext 占位保留；人物 location/occupation/schedule/needs/memory/flags 仅是容器，没有自主行为。

## 旧存档迁移

初始化及切换聊天时自动检测旧存档，转换为 schemaVersion 5 并请求保存：

- v0.1 先沿用原迁移逻辑：归入古代田园，money → currency.amount，date/time → calendar，stamina/satiety 的 current/max → stats 的 value/max。
- v0.1.1 无 actors、只有 currency/stats 的旧结构，保留 world/calendar/worldState，将 currency/stats/inventory/skills/relationships/personalState 放进一个新 actor。
- 单人物旧存档优先采用当前角色的最小身份信息；不可读取时为自定义来源「默认人物」，原数据仍保留供查看。
- 旧 playerActorId 优先，失效或不存在再读取 activeActorId；对应人物为 user 时迁移为 controlMode=user，其余默认 character。已有合法 controlMode 优先。
- 两个旧控制 ID 字段迁移后移除，但对应 actors 的数据全部保留。有效 inspectedActorId 保留；缺失时先沿用历史查看对象，再由解析函数补充。
- 金额零值、日期时间、自定义状态值和最大值均保留，不重置为模板初始值。其他元数据命名空间不受影响，聊天文本不变。
- 缺少当前操作来源的 actor 时自动初始化并请求保存；已有同来源人物复用原数据。迁移幂等，重复打开不重置人物。

继续使用原保存/回滚机制：每次操作获取最新 Context，拒绝过期聊天操作，保存中禁用编辑；失败抛错时恢复旧对象，不循环重试迁移。重新加载或手动修改可重试。异步完成不会把旧聊天人物写进新聊天。

宿主保存 API 不提供独立的指定聊天写盘确认，部分网络失败只由宿主提示而不抛错。“保存请求已完成”不代表已独立验证落盘；请刷新检查，快速切换期间的实际保存仍需手机验收。复制/分支/导入聊天可能由宿主复制初始元数据，复制后分别保存。

## 文件与加载兼容

- `manifest.json`：0.1.3，最低 SillyTavern 1.18.0，加载顺序仍为 100。
- `index.js`：现有 Context、人物管理和保存回调，精简设置及浮层挂载/更新/卸载。
- `ui/floating-panel.js`：浮层 DOM、四页签、名称输入、滚动锁定、视口定位及清理；不处理存档。
- `core/game-state.js`：世界/actor 初始化、角色/User 解析、只读查看指针、统一行动入口与旧存档迁移；不访问 DOM 或 SillyTavern。
- `core/actor-sources.js`：从公开 Context 提取最少身份信息。
- `data/world-templates.js`：三个统一结构的只读模板，保持原定义。
- `style.css`：手机 select、44px 按钮、长名字省略及可换行布局。
- `scripts/check.cjs`：静态和模拟 Context/DOM 测试。
- `scripts/browser-check.cjs`：无依赖的可选无头 Chromium 浏览器布局检查，使用本机模拟宿主页面。
- `data/.gitkeep`、`LICENSE`：保留原文件。

保留 `APP_INITIALIZED`、`CHAT_CHANGED`、`#extensions_settings2`（回退 `#extensions_settings`）、`chat.after(host)`，以及 `eventTypes/event_types`、`chatId/getCurrentChatId()` 兼容方式。所有项目模块使用相对路径，未导入宿主内部模块。宿主原本以 ES Module 加载 manifest 入口，无需新加载器。

依据：[官方扩展规范与 characterId 限制](https://docs.sillytavern.app/for-contributors/writing-extensions/)、[公开 Context](https://github.com/SillyTavern/SillyTavern/blob/1.18.0/public/scripts/st-context.js)、[扩展加载器](https://github.com/SillyTavern/SillyTavern/blob/1.18.0/public/scripts/extensions.js)。

## 验证和发布

用户已确认 v0.1.2 的世界、人物与迁移通过 Android 实机测试。**本次 UI 重构尚未在 Android SillyTavern 实机验证。**

```sh
node scripts/check.cjs
node scripts/browser-check.cjs
```

测试器使用 Node 内置 VM Module 解析并链接真实项目模块，自动在测试子进程使用 `--experimental-vm-modules`；实验提示仅属于测试器，不是手机依赖。覆盖三个模板、默认角色跟随、User 切换、自动创建、货币/stats 隔离、NPC 查看及详情关闭重开、旧 playerActorId/activeActorId 和单人物迁移、世界日期不变、失败回滚、过期操作及语法/路径。

新增覆盖入口 ON/OFF、关闭与遮罩、页签切换、设置精简、聊天切换关闭浮层、总开关卸载/重新挂载、监听清理和唯一 DOM。浏览器脚本需要带内置 WebSocket 的现代 Node.js 及本机 Chrome/Edge；可用 `QHJT_CHROME` 指定浏览器程序。它只向本机回环地址提供项目模块与模拟页面，不访问 SillyTavern；浏览器临时配置放在系统临时目录。

已用无头 Chrome 检查 320×740、320×400 模拟视口、长人物名、名称输入及关闭按钮可见、横向溢出、入口与输入区距离、遮罩关闭、原生弹窗层级，以及桌面居中布局。缩小视口近似软键盘占用空间，并不等于真实 Android 输入法测试。

Android 重点验收：首次自动显示当前角色；「切换到我 / 跟随当前角色」即时刷新；切换聊天自动跟随并保持各聊天状态独立；查看 NPC 后货币修改只影响操作角色；旧存档迁移并刷新保留；320px、真实软键盘和浮层关闭。

本次修正 amend 尚未推送的控制/查看架构提交。在项目普通 PowerShell 中发布本地提交：

```sh
git push origin main
```

不在 Codex 中 push。本轮仅修正控制/查看架构，不开发副 API 或任何后续玩法。
