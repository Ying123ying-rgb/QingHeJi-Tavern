# 酒馆人生模拟器 · QingHeJi-Tavern

通用 **SillyTavern 生活模拟游戏引擎**，当前版本 **0.1.1**。青禾记 / 古代田园只是第一个世界模板。仓库及本地项目目录仍为 `QingHeJi-Tavern`。

每个聊天拥有独立世界与独立游戏存档。同一张角色卡可以在聊天 A 使用古代田园、聊天 B 使用现代都市、聊天 C 使用星际时代；世界选择不改变角色卡设定。

本轮只有通用架构、模板选择与测试面板。不调用 AI、不发送消息，不修改角色卡、世界书或 SillyTavern 核心代码。无背包、商店、买卖、种田、做饭、关系玩法或随机事件，无 Server Plugin、Extras 或运行时 npm 依赖。

## 安装与更新

仓库：<https://github.com/Ying123ying-rgb/QingHeJi-Tavern>

在 Android Termux 正常启动已有的 SillyTavern。首次安装时，在扩展 → 安装扩展中输入上述仓库 URL；已安装 v0.1 的用户在扩展管理中更新，然后刷新浏览器。

1. 在扩展设置找到「酒馆人生模拟器」。总开关默认打开，每聊天游戏模式默认关闭。
2. 选择一个聊天，通过「当前聊天世界模板」选择古代田园、现代都市或星际时代。
3. 选择不同模板时会提示：“切换世界模板将重置当前聊天的模拟游戏初始状态，但不会修改角色卡、聊天记录或其他聊天存档。”取消不做更改，确认后仅重置当前聊天模拟存档，保留 `enabled`。
4. 开启「当前聊天启用游戏模式」，在消息区下方、输入区上方点击「人生模拟」。
5. 面板显示版本、当前角色、世界、游戏开关状态及当前世界的数据。使用「关闭」按钮或 Escape 收起。

关闭总开关会隐藏入口和面板，保留每个聊天的状态。无有效聊天、总开关关闭或正在保存时，游戏开关与世界选择器不可操作。群聊没有单一当前角色，角色栏显示「群聊（无单一当前角色）」。

## 三个内置世界

| 模板 ID | 世界 | 货币 | 日期 / 时间 | 状态 |
| --- | --- | --- | --- | --- |
| `ancient_rural` | 古代田园 | 铜钱 100 | 三月初一 / 辰时 | 体力 100/100、饱腹 100/100 |
| `modern_city` | 现代都市 | 余额 ¥1000 | 9月6日 / 08:00 | 精力 100/100、饱腹 100/100、心情 80/100 |
| `sci_fi` | 星际时代 | 信用点 3000 | 星历2387-104 / 舰时08:00 | 行动力 100/100、氧气 100/100、舰船能源 100/100 |

## 文件与架构

| 文件 | 职责 |
| --- | --- |
| `manifest.json` | 显示名称、版本、加载顺序及入口 |
| `index.js` | 沿用 v0.1 的加载事件、DOM 挂载和 Context 兼容逻辑；设置、确认、保存与通用面板 |
| `data/world-templates.js` | 统一结构的只读世界定义、显示标签、初始值与未来接口占位 |
| `core/game-state.js` | 初始化、纯数据读取与缺省处理、v0.1 迁移；不依赖 DOM 或 SillyTavern |
| `style.css` | 有作用域的手机布局与触摸尺寸 |
| `scripts/check.cjs` | 本地静态检查、真实 ES Module 解析与链接、模拟 Context/DOM 测试 |
| `data/.gitkeep` | 保留的原目录占位文件 |
| `LICENSE` | MIT 许可证 |

模板采用相同的 `id`、`version`、`displayName`、`currency`、`calendar`、`stats` 结构。初始化时深复制数据，每个聊天有自己的对象，不能修改模板常量。UI 只读取通用字段并遍历 `stats`，没有按三个世界分别判断的面板；未来新增精神值、健康等状态只需增加数据项。

每个模板还预留 `locations`、`items`、`shops`、`actions`、`recipes`、`events` 数组，以及 `rules`、`aiContext` 对象。这些字段当前为空，仅供未来扩展，没有相关页面、执行器或 AI 调用。模板版本与存档结构版本分开记录；未来更改模板版本需要定义对应的升级策略，本轮只实现 v0.1 到 v0.1.1 的迁移。

## 每聊天存档

保留原有命名空间：总开关仍在 `extensionSettings.qingheji_tavern.enabled`，模拟存档仍在 `chatMetadata.qingheji_tavern`。`data/` 不是存档目录；持久化由手机上的 SillyTavern 管理。

```json
{
  "schemaVersion": 2,
  "enabled": false,
  "world": { "templateId": "ancient_rural", "templateVersion": 1 },
  "currency": { "id": "money", "label": "铜钱", "symbol": "", "amount": 100 },
  "calendar": { "dateLabel": "日期", "date": "三月初一", "timeLabel": "时辰", "time": "辰时" },
  "stats": [
    { "id": "stamina", "label": "体力", "value": 100, "max": 100 },
    { "id": "satiety", "label": "饱腹", "value": 100, "max": 100 }
  ],
  "inventory": {},
  "relationships": {},
  "skills": {},
  "worldState": {}
}
```

普通开关操作保留额外字段和状态项；确认切换世界才重新初始化整份模拟存档。新聊天只读展示默认值，不主动创建存档，直到用户切换模板或操作游戏开关。未知模板 ID 不自动覆盖为其他世界，选择器显示“未识别模板”；可以确认选择一个已知模板重新初始化。

每次操作获取最新 Context，并用聊天标识和元数据对象检查过期操作。切换聊天会关闭旧面板、重新读取当前状态。异步保存完成后不会将旧对象写入新聊天。复制、分支或导入聊天时，SillyTavern 可能复制元数据，因此会继承初始状态；此后仍分别保存。删除聊天也会删除随附存档。

## v0.1 自动迁移

初始化或 `CHAT_CHANGED` 时，如果存在旧字段而没有 `world.templateId`，自动转换为 `ancient_rural` 并通过原有 `saveMetadata()` 请求保存：

| 旧字段 | 新字段 |
| --- | --- |
| `enabled` | 保持原值 |
| `money` | `currency.amount` |
| `date` / `time` | `calendar.date` / `calendar.time` |
| `stamina.current` / `stamina.max` | `stats` 中 `id="stamina"` 的 `value` / `max` |
| `satiety.current` / `satiety.max` | `stats` 中 `id="satiety"` 的 `value` / `max` |

零值与原有最大值会保留；缺失或无效值使用模板缺省值。迁移后移除旧底层字段，保留未来扩展字段及聊天元数据中的其他命名空间。不会修改聊天文本。迁移幂等，不会每次打开面板重置进度。

保存抛出异常时恢复原存档对象，不循环自动重试；重新加载聊天/页面或手动操作游戏开关可以重试。显示层仍可以读取旧结构，不会因升级而直接报错。

## 加载兼容依据

保持最低 SillyTavern 版本 **1.18.0**，保留 `loading_order: 100`、`js: index.js`、`css: style.css` 及 Context API 能力检查。

SillyTavern 1.18.0 的官方 `addExtensionScript` 本来就用 `script.type = 'module'` 加载 manifest 入口。v0.1.1 使用相对 ES Module 导入分离项目自身文件，不修改宿主加载方式、不依赖电脑路径，也不导入宿主内部文件。无需另加加载器、全局脚本注册、构建步骤或 JSON 网络请求。

- [官方 UI Extension 规范](https://docs.sillytavern.app/for-contributors/writing-extensions/)
- [1.18.0 扩展加载器](https://github.com/SillyTavern/SillyTavern/blob/1.18.0/public/scripts/extensions.js)
- [1.18.0 Context API](https://github.com/SillyTavern/SillyTavern/blob/1.18.0/public/scripts/st-context.js)
- [1.18.0 页面结构](https://github.com/SillyTavern/SillyTavern/blob/1.18.0/public/index.html)
- [1.18.0 保存流程](https://github.com/SillyTavern/SillyTavern/blob/1.18.0/public/script.js)

挂载沿用 `APP_INITIALIZED`、`CHAT_CHANGED`、`#extensions_settings2`（回退 `#extensions_settings`）和 `chat.after(host)`。设置、保存仍使用 `SillyTavern.getContext()`。保留 `eventTypes` / `event_types`、`chatId` / `getCurrentChatId()` 兼容方式。

## 检查与实机验收

用户已确认 **v0.1 在 Android SillyTavern 安装成功且正常显示面板**。**本次 v0.1.1 只完成本地检查，尚未实机验证。**

```sh
node scripts/check.cjs
```

需要本地 Node.js。检查器使用 Node 自带 VM Module 解析与链接真实入口及相对依赖，并模拟 DOM/Context；运行时自动为子进程添加 `--experimental-vm-modules`。Node 的实验特性提示仅属于测试器，不是手机插件运行依赖。

覆盖三个模板初始化及面板数据、额外状态动态渲染、同角色不同聊天世界隔离、确认/取消/失败的模板重置、保留 enabled、旧存档迁移和幂等性、迁移失败回滚、保存期间切换聊天、manifest JSON、JS 语法与相对导入路径。模拟检查不验证真实网络写盘或 CSS 布局。

手机重点验收：

1. 更新并刷新后，设置区与入口仍正常挂载，新增模块无加载错误。
2. 已有 v0.1 存档保留金额、日期、时辰、体力和饱腹，刷新后仍保留迁移结果。
3. 同角色的 A/B/C 聊天分别选择三个世界，往返切换及刷新后不串档。
4. 模板确认与取消、关闭游戏模式后切换世界、总开关关闭再恢复。
5. 320px 宽度、长状态名称、横竖屏和软键盘；选择器及按钮约 44px 触摸高度，面板不横向溢出，输入框不被遮挡。
6. 保存期间快速切换聊天、网络失败与群聊行为，以及主题/其他 UI 扩展共存。

已知限制：挂载点属于宿主 DOM，升级或其他扩展可能影响布局。官方 `saveMetadata()` 不提供指定聊天的独立写盘确认，部分失败仅由宿主提示而不抛出；“保存请求已完成”不保证已核实持久化。保存完成前请等待，快速切换聊天的实际写盘行为仍需手机验收。

## 发布 v0.1.1

保留 v0.1 历史提交，在现有 `main` 上创建新提交：

```text
Refactor v0.1.1 into world-template simulation engine
```

本次交付只做本地提交。随后在本项目的普通 PowerShell 终端执行：

```sh
git push origin main
```

如出现 GitHub 登录或浏览器授权，按提示完成；不使用强制推送。不继续开发 v0.2。
