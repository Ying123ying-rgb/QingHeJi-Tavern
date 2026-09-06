# 青禾记 Tavern

SillyTavern 第三方 UI Extension，版本 **0.1.0**。第一阶段仅验证设置、每聊天存档和测试面板。不需要 Server Plugin、Extras、构建工具或 npm 依赖。

## 兼容依据

2026-09-06 查阅的官方最新 release 为 **1.18.0**，manifest 将其设为最低版本。本项目依据官方文档及 release 源码开发，**尚未在真实 SillyTavern 或 Android 手机上运行验证**。

- [官方 UI Extension 规范](https://docs.sillytavern.app/for-contributors/writing-extensions/)
- [1.18.0 release](https://github.com/SillyTavern/SillyTavern/releases/tag/1.18.0)
- [release Context API](https://github.com/SillyTavern/SillyTavern/blob/1.18.0/public/scripts/st-context.js)
- [release 页面挂载点](https://github.com/SillyTavern/SillyTavern/blob/1.18.0/public/index.html)
- [release 保存实现](https://github.com/SillyTavern/SillyTavern/blob/1.18.0/public/script.js)

只通过 `SillyTavern.getContext()` 使用 Context API，不导入 SillyTavern 内部模块。监听 `APP_INITIALIZED` 和 `CHAT_CHANGED`；使用 `extensionSettings`、`saveSettingsDebounced()`、`chatMetadata` 和 `saveMetadata()`。

## 手机安装

1. 将本目录文件上传到 GitHub 仓库根目录，确保根目录直接有 `manifest.json`，不要再嵌套一层项目文件夹。
2. 在 Android Termux 正常启动你已有的 SillyTavern，浏览器进入界面。
3. 打开「扩展」→「安装扩展」，输入 `https://github.com/你的用户名/QingHeJi-Tavern`，完成安装后刷新页面。
4. 扩展设置区找到「青禾记 Tavern」。插件总开关默认打开，但每个聊天的游戏模式默认关闭。
5. 选择一个角色聊天，打开「当前聊天启用游戏模式」。聊天消息区下方、输入区上方出现「青禾记」按钮。
6. 点击按钮查看面板，点击「关闭」收起。关闭总开关会隐藏入口和面板，但保留各聊天的游戏存档；重新打开总开关会恢复当前聊天原有的开关状态。

本项目不寻找或修改电脑上的 SillyTavern，不涉及《青禾记》独立游戏项目。

## v0.1 内容

- 扩展设置标题、插件总开关、当前聊天游戏模式开关。
- 读取并显示 `characterId`、角色名称和聊天标识；无有效聊天时禁用游戏模式开关。
- 群聊有独立聊天元数据；由于群聊没有单一当前角色，角色栏明确显示「群聊（无单一当前角色）」和 characterId「无」。
- 入口及面板使用正常文档布局，不使用悬浮定位；触屏按钮最小高度 44px，面板可滚动，支持关闭按钮及 Escape。
- 初始面板：青禾记 Tavern v0.1、当前角色、游戏模式已开启、铜钱 100、三月初一、辰时、体力 100/100、饱腹 100/100。
- 不调用 AI、不自动发消息、不修改角色卡和世界书，不包含背包、商店、种田或剧情系统。

## 存档结构

总开关位于当前 SillyTavern 用户的 `extensionSettings.qingheji_tavern.enabled`。游戏状态位于当前聊天的 `chatMetadata.qingheji_tavern`，首次操作游戏模式开关时才创建：

```json
{
  "schemaVersion": 1,
  "enabled": false,
  "money": 100,
  "date": "三月初一",
  "time": "辰时",
  "stamina": { "current": 100, "max": 100 },
  "satiety": { "current": 100, "max": 100 }
}
```

每次操作重新获取 Context，不以角色名称、角色数组下标或全局单例作为存档键。同一角色的不同聊天也各用自己的元数据。仅在一次保存调用期间保留目标元数据引用，用于异常回滚，异步完成后不会向新聊天复制旧状态。

读取时补充缺省字段，写入时保留未知字段；未来可增加 `inventory`、`relationships`、`skills`、`worldState`，本版本不实现这些系统。`data/` 预留静态资源，**不是实际存档目录**；实际保存由手机上的 SillyTavern 管理。

聊天复制、分支、导入可能由 SillyTavern 同时复制元数据，因此可能继承初始游戏状态；复制后分别保存在各自聊天中。删除聊天也会删除其随附游戏存档。

## 检查与已知限制

本地检查命令（需要 Node.js，仅供开发检查，手机安装无需运行）：

```sh
node --check index.js
node scripts/check.cjs
```

检查脚本验证 manifest、入口路径和 JavaScript，并在模拟 DOM/Context 中检查默认状态、角色 ID 0、同角色不同聊天隔离、总开关、面板、保存失败及保存期间切换聊天。模拟检查不代表真实浏览器或手机测试。

必须在手机上验证：URL 安装与加载、设置区挂载、切换角色/同角色不同聊天/群聊、刷新后持久化、快速切换聊天、总开关恢复、软键盘与横竖屏、不同主题及其他 UI 扩展共存。

已知兼容点：设置区使用 `#extensions_settings2`（回退 `#extensions_settings`），入口依赖 `#chat` 的父布局。它们不是稳定的 UI 插槽 API，宿主升级或其他扩展改动 DOM 后可能需要适配。缺失挂载点或必要 API 时输出控制台错误并停止挂载。

官方 `saveMetadata()` 内部等待并调用聊天保存流程，部分失败可能只由宿主提示而不抛出异常，且不提供指定聊天的持久化确认。因此“保存请求已完成”不等于已独立确认写盘成功。保存期间请等待完成再切换聊天；快速切换时是否可靠持久化需实机验收。扩展本身不将旧状态写入新聊天。

资源路径均为相对路径，没有电脑绝对路径或外部资源请求。未来 JS 资源可用 `new URL('./data/文件名', import.meta.url)`，CSS 资源用 `url('./data/文件名')`。

## 初始化 Git 并上传 GitHub

在 GitHub 创建空的公开仓库 `QingHeJi-Tavern`，不要自动生成 README 或 LICENSE。在当前项目根目录执行（替换用户名）：

```sh
git init -b main
git add manifest.json index.js style.css README.md LICENSE data/.gitkeep scripts/check.cjs
git commit -m "Initial QingHeJi-Tavern v0.1.0 UI extension"
git remote add origin https://github.com/你的用户名/QingHeJi-Tavern.git
git push -u origin main
```

若 Git 提示缺少作者信息，先设置自己的 `git config user.name` 和 `git config user.email`，再提交。推送时使用你已有的 GitHub 登录凭据。本项目未代为初始化 Git、创建远程仓库或上传。

`LICENSE` 为 MIT。到此停止 v0.1，不包含 v0.2。
