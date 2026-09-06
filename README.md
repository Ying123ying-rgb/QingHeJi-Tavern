# 酒馆人生模拟器 · QingHeJi-Tavern

通用 SillyTavern 生活模拟游戏引擎，当前版本 **0.1.2**。青禾记 / 古代田园只是第一个世界模板。仓库与目录仍为 `QingHeJi-Tavern`。

本版结构：**一个聊天世界 + 多个人物状态 + 可切换当前主角**。每个聊天独立保存，SillyTavern 当前聊天角色与模拟游戏当前主角相互解耦。切换主角不会切换聊天。

不调用 AI、不开发副 API，不发送消息，不修改聊天文本、角色卡、世界书或 SillyTavern 核心代码。背包、商店、种田、摆摊、NPC 行动等均未实现。

## 安装与使用

仓库：<https://github.com/Ying123ying-rgb/QingHeJi-Tavern>

Android Termux 中正常启动已有 SillyTavern。在扩展管理中用仓库 URL 安装，已有用户更新后刷新浏览器。无需 Server Plugin、Extras、构建或 npm 依赖。

1. 扩展设置找到「酒馆人生模拟器」。插件总开关默认打开，每聊天游戏模式默认关闭。
2. 选择当前聊天世界模板。新聊天初始没有人物，不会自动复制角色设定。
3. 在「人物」区域添加当前角色、添加“我”或添加自定义人物。第一个人物自动成为主角，后来添加的人物不抢占当前主角。
4. 用「当前主角」下拉框或名单中的「切换为当前主角」按钮切换。
5. 开启游戏模式，点击消息区下方、输入区上方的「人生模拟」。面板分别显示世界状态与当前主角的人物状态。
6. 「测试修改」中的货币 +100 / -100 只改当前主角，允许出现负数，仅作状态隔离测试，不是正式经济玩法。
7. 人物「删除」须确认。删除当前主角后选中剩余第一个人物，全部删除后 `activeActorId = null`；空人物面板仍显示世界日期时间及添加提示。

## 人物来源与身份

- **添加当前角色**：只读取 Context 中的 `characterId`、角色名称、`avatar` 文件名，不读取 description、scenario、first message 或世界书。相同角色来源在当前聊天内不能重复添加；同名自定义人物允许存在。
- **添加“我”**：读取公开 Context 的 `name1`，不可用时名称为「我」。每个聊天一个玩家人物，`sourceType: user`、`sourceId: self`。添加后名单提供「修改显示名称」，只改模拟人物，不改 SillyTavern persona。切换 persona 不会自动生成新人物或重命名已保存的人物。
- **添加自定义人物**：只提示填写名称，取消或全空白不创建；`sourceType: custom`。本轮没有人物编辑器或头像编辑器。

**角色身份的重要 API 限制**：官方明确 `characterId` 只是角色数组下标，并非稳定唯一 ID。本项目读取该下标定位当前角色，但 `sourceId` 使用 Context 的 `character.avatar` 文件名，在数组重排后仍能去重；`avatar` 同时保留该文件名，本版不加载头像图片。没有可用文件名时禁用「添加当前角色」，可添加玩家/自定义人物；旧存档迁移则回退为「默认主角」。群聊没有单一当前角色时同样回退。

角色卡重命名若改变文件名、删除后重新导入，可能被识别为新来源；没有修改角色卡来植入 UUID，也不声称拥有跨重导入的永久身份。人物名称是添加时的显示快照，不随角色卡重命名自动更新。

## 世界模板

| 模板 ID | 世界 | 每个新增人物的默认货币 | 世界日期 / 时间 | 每个人物的默认状态 |
| --- | --- | --- | --- | --- |
| `ancient_rural` | 古代田园 | 铜钱 100 | 三月初一 / 辰时 | 体力 100/100、饱腹 100/100 |
| `modern_city` | 现代都市 | 余额 ¥1000 | 9月6日 / 08:00 | 精力 100/100、饱腹 100/100、心情 80/100 |
| `sci_fi` | 星际时代 | 信用点 3000 | 星历2387-104 / 舰时08:00 | 行动力 100/100、氧气 100/100、舰船能源 100/100 |

切换世界提示：“切换世界模板将重置本聊天的世界状态以及所有人物的模拟状态，但不会修改角色卡或聊天记录。”

确认后保留 `enabled`、人物名单、id/name/sourceType/sourceId/avatar，以及原主角（仍存在时）。重置 calendar、worldState 与所有人物模拟字段，包括 currency、stats、inventory、skills、relationships、personalState 及未来扩展占位。每个人按新模板取得独立副本，不做跨世界资产转换。取消保持原样。

## 数据架构

仍使用 `extensionSettings.qingheji_tavern` 保存总开关，使用当前聊天的 `chatMetadata.qingheji_tavern` 保存游戏。`data/` 是静态模板目录，不是手机存档目录。

```json
{
  "schemaVersion": 3,
  "enabled": true,
  "world": { "templateId": "modern_city", "templateVersion": 1 },
  "calendar": { "dateLabel": "日期", "date": "9月6日", "timeLabel": "时间", "time": "08:00" },
  "worldState": {},
  "activeActorId": "actor_1",
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

UI 遍历统一的 currency、calendar、stats，不根据古代/现代/星际分别硬编码。未来新增状态只需数据项。模板原有 locations/items/shops/actions/recipes/events/rules/aiContext 占位保留；人物 location/occupation/schedule/needs/memory/flags 仅是容器，没有自主行为。

## v0.1 / v0.1.1 迁移

初始化及切换聊天时自动检测旧存档，转换为 schemaVersion 3 并请求保存：

- v0.1 先沿用原迁移逻辑：归入古代田园，money → currency.amount，date/time → calendar，stamina/satiety 的 current/max → stats 的 value/max。
- v0.1.1 无 actors、只有 currency/stats 的旧结构，保留 world/calendar/worldState，将 currency/stats/inventory/skills/relationships/personalState 放进一个新 actor。
- 新 actor 优先取当前角色的最小身份信息；不可读取时为自定义来源「默认主角」。`activeActorId` 指向它。
- 金额零值、日期时间、自定义状态值和最大值均保留，不重置为模板初始值。其他元数据命名空间不受影响，聊天文本不变。
- 已有 actors（包括空对象）的存档不会再自动创建人物。迁移幂等，重复打开不会丢进度。

继续使用原保存/回滚机制：每次操作获取最新 Context，拒绝过期聊天操作，保存中禁用编辑；失败抛错时恢复旧对象，不循环重试迁移。重新加载或手动修改可重试。异步完成不会把旧聊天人物写进新聊天。

宿主保存 API 不提供独立的指定聊天写盘确认，部分网络失败只由宿主提示而不抛错。“保存请求已完成”不代表已独立验证落盘；请刷新检查，快速切换期间的实际保存仍需手机验收。复制/分支/导入聊天可能由宿主复制初始元数据，复制后分别保存。

## 文件与加载兼容

- `manifest.json`：0.1.2，最低 SillyTavern 1.18.0，加载顺序仍为 100。
- `index.js`：现有 Context/挂载逻辑、人物管理、模板确认、分区面板与保存。
- `core/game-state.js`：世界和 actor 初始化、操作及两代迁移；不访问 DOM 或 SillyTavern。
- `core/actor-sources.js`：从公开 Context 提取最少身份信息。
- `data/world-templates.js`：三个统一结构的只读模板，保持原定义。
- `style.css`：手机 select、44px 按钮、长名字省略及可换行布局。
- `scripts/check.cjs`：静态和模拟 Context/DOM 测试。
- `data/.gitkeep`、`LICENSE`：保留原文件。

保留 `APP_INITIALIZED`、`CHAT_CHANGED`、`#extensions_settings2`（回退 `#extensions_settings`）、`chat.after(host)`，以及 `eventTypes/event_types`、`chatId/getCurrentChatId()` 兼容方式。所有项目模块使用相对路径，未导入宿主内部模块。宿主原本以 ES Module 加载 manifest 入口，无需新加载器。

依据：[官方扩展规范与 characterId 限制](https://docs.sillytavern.app/for-contributors/writing-extensions/)、[公开 Context](https://github.com/SillyTavern/SillyTavern/blob/1.18.0/public/scripts/st-context.js)、[扩展加载器](https://github.com/SillyTavern/SillyTavern/blob/1.18.0/public/scripts/extensions.js)。

## 验证和发布

用户已确认 v0.1.1 通过 Android 实机测试。**本次 v0.1.2 只有本地静态/模拟测试，尚未实机验证。**

```sh
node scripts/check.cjs
```

测试器使用 Node 内置 VM Module 解析并链接真实项目模块，自动在测试子进程使用 `--experimental-vm-modules`；实验提示仅属于测试器，不是手机依赖。覆盖三个模板的人物初始化、三个人物货币/stats 深度隔离、主角与日期解耦、增删/玩家改名、确认/取消切换世界、两代迁移、空人物、每聊天隔离、失败回滚、过期操作、角色卡与聊天文本不变、manifest/语法/相对路径。

Android 重点验收：升级加载；旧金额日期状态迁移并刷新保留；同聊天三种来源共存与去重；主角切换及 ±100 不影响其他人物；删除确认和删空；玩家显示名修改；世界切换保留名单并重置全员；不同聊天隔离；320px 长名、软键盘、横竖屏且输入框不被遮挡。挂载 DOM 仍可能受宿主或其他扩展影响。

本次创建新的本地提交 `Add multi-actor protagonist state system`，保留历史提交。在项目普通 PowerShell 中发布：

```sh
git push origin main
```

不在 Codex 中执行交互式 push。不开发副 API 或 v0.1.3。
