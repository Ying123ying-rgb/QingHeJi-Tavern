(() => {
    'use strict';

    const KEY = 'qingheji_tavern';
    const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const defaults = () => ({
        schemaVersion: 1,
        enabled: false,
        money: 100,
        date: '三月初一',
        time: '辰时',
        stamina: { current: 100, max: 100 },
        satiety: { current: 100, max: 100 },
    });
    const context = () => globalThis.SillyTavern.getContext();
    let ui;
    let busy = false;
    let renderedMetadata;
    let renderedIdentity;

    function identity(ctx) {
        const chatId = ctx.chatId ?? ctx.getCurrentChatId?.();
        const group = ctx.groupId !== undefined && ctx.groupId !== null && ctx.groupId !== '';
        const character = ctx.characters?.[ctx.characterId];
        return {
            chatId,
            name: group ? '群聊（无单一当前角色）' : (character?.name ?? '未选择角色'),
            valid: chatId !== undefined && chatId !== null && chatId !== '' && (group || Boolean(character)),
            key: JSON.stringify([group ? 'group' : 'character', group ? ctx.groupId : character?.avatar ?? ctx.characterId, chatId]),
        };
    }

    // Read-only default merging: merely viewing a chat does not create a save.
    // Unknown fields are preserved for future schema additions.
    function state(ctx) {
        const saved = ctx.chatMetadata?.[KEY];
        const result = { ...defaults(), ...(isObject(saved) ? saved : {}) };
        result.enabled = result.enabled === true;
        for (const field of ['stamina', 'satiety']) {
            result[field] = { current: 100, max: 100, ...(isObject(result[field]) ? result[field] : {}) };
        }
        return result;
    }

    function pluginEnabled(ctx) {
        return ctx.extensionSettings?.[KEY]?.enabled !== false;
    }

    function element(tag, text, className) {
        const node = document.createElement(tag);
        if (text !== undefined) node.textContent = String(text);
        if (className) node.className = className;
        return node;
    }

    function toggle(labelText, id) {
        const label = element('label', undefined, 'qhjt-toggle');
        const input = element('input');
        input.type = 'checkbox';
        input.id = id;
        label.htmlFor = id;
        label.append(input, element('span', labelText));
        return { label, input };
    }

    function closePanel(focus = false) {
        ui.panel.hidden = true;
        ui.entry.setAttribute('aria-expanded', 'false');
        if (focus && !ui.host.hidden) ui.entry.focus();
    }

    function refresh() {
        if (!ui) return;
        const ctx = context();
        const info = identity(ctx);
        const game = state(ctx);
        renderedMetadata = ctx.chatMetadata;
        renderedIdentity = info.key;
        ui.master.checked = pluginEnabled(ctx);
        ui.game.checked = info.valid && game.enabled;
        ui.master.disabled = busy;
        ui.game.disabled = busy || !pluginEnabled(ctx) || !info.valid || !isObject(ctx.chatMetadata);
        ui.info.textContent = `角色：${info.name}；characterId：${ctx.characterId ?? '无'}；聊天标识：${info.chatId ?? '无'}`;
        ui.host.hidden = !pluginEnabled(ctx) || !info.valid || !game.enabled;
        if (ui.host.hidden) closePanel();
    }

    async function changeGame() {
        const desired = ui.game.checked;
        const ctx = context();
        const info = identity(ctx);
        // Reject a click on stale UI during a chat transition.
        if (busy || !pluginEnabled(ctx) || !info.valid || !isObject(ctx.chatMetadata)
            || ctx.chatMetadata !== renderedMetadata || info.key !== renderedIdentity) {
            refresh();
            return;
        }
        const metadata = ctx.chatMetadata;
        const hadState = Object.hasOwn(metadata, KEY);
        const previous = metadata[KEY];
        const next = { ...state(ctx), enabled: desired };
        metadata[KEY] = next;
        busy = true;
        ui.status.textContent = '正在请求保存…';
        closePanel();
        refresh();
        try {
            // Invoke immediately, without a debounce that could target another chat.
            await ctx.saveMetadata();
            if (context().chatMetadata === metadata) {
                ui.status.textContent = '保存请求已完成；可刷新页面检查是否保留。';
            }
        } catch (error) {
            if (metadata[KEY] === next) {
                if (hadState) metadata[KEY] = previous;
                else delete metadata[KEY];
            }
            if (context().chatMetadata === metadata) ui.status.textContent = '保存失败，请稍后重试。';
            console.error('[青禾记 Tavern] 保存失败', error);
        } finally {
            busy = false;
            refresh();
        }
    }

    function openPanel() {
        refresh();
        if (ui.host.hidden) return;
        const ctx = context();
        const game = state(ctx);
        const rows = [
            ['当前角色', identity(ctx).name], ['游戏模式', '已开启'],
            ['铜钱', game.money], ['日期', game.date], ['时辰', game.time],
            ['体力', `${game.stamina.current}/${game.stamina.max}`],
            ['饱腹', `${game.satiety.current}/${game.satiety.max}`],
        ];
        ui.values.replaceChildren();
        for (const [label, value] of rows) ui.values.append(element('dt', label), element('dd', value));
        ui.panel.hidden = false;
        ui.entry.setAttribute('aria-expanded', 'true');
        ui.close.focus();
    }

    function initialize() {
        if (ui || document.getElementById('qhjt-settings')) return;
        const settingsRoot = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
        const chat = document.getElementById('chat');
        if (!settingsRoot || !chat?.parentElement) {
            console.error('[青禾记 Tavern] 缺少扩展设置区或聊天区，未挂载 UI。');
            return;
        }
        const settings = element('section', undefined, 'qhjt-settings');
        settings.id = 'qhjt-settings';
        const master = toggle('插件总开关', 'qhjt-master');
        const game = toggle('当前聊天启用游戏模式', 'qhjt-game');
        const info = element('p', undefined, 'qhjt-info');
        const status = element('p', '游戏模式默认关闭；请先选择聊天。', 'qhjt-info');
        status.setAttribute('role', 'status');
        settings.append(element('h3', '青禾记 Tavern'), master.label, game.label, info, status);

        const host = element('section', undefined, 'qhjt-host');
        host.id = 'qhjt-host';
        host.hidden = true;
        const entry = element('button', '青禾记', 'menu_button qhjt-button');
        entry.type = 'button';
        entry.setAttribute('aria-controls', 'qhjt-panel');
        entry.setAttribute('aria-expanded', 'false');
        const panel = element('section', undefined, 'qhjt-panel');
        panel.id = 'qhjt-panel';
        panel.hidden = true;
        panel.setAttribute('aria-labelledby', 'qhjt-title');
        const header = element('div', undefined, 'qhjt-panel-header');
        const title = element('h3', '青禾记 Tavern v0.1');
        title.id = 'qhjt-title';
        const close = element('button', '关闭', 'menu_button qhjt-button');
        close.type = 'button';
        const values = element('dl', undefined, 'qhjt-values');
        header.append(title, close);
        panel.append(header, values);
        host.append(entry, panel);
        settingsRoot.append(settings);
        // Sibling of #chat: core message rerenders cannot remove our entry.
        chat.after(host);
        ui = { master: master.input, game: game.input, info, status, host, entry, panel, close, values };
        master.input.addEventListener('change', () => {
            const ctx = context();
            const existing = ctx.extensionSettings[KEY];
            ctx.extensionSettings[KEY] = { ...(isObject(existing) ? existing : {}), enabled: master.input.checked };
            ctx.saveSettingsDebounced();
            closePanel();
            refresh();
        });
        game.input.addEventListener('change', changeGame);
        entry.addEventListener('click', openPanel);
        close.addEventListener('click', () => closePanel(true));
        panel.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.stopPropagation(); closePanel(true); }
        });
        refresh();
    }

    if (typeof globalThis.SillyTavern?.getContext !== 'function') {
        console.error('[青禾记 Tavern] 需要 SillyTavern UI Extension 环境。');
        return;
    }
    const ctx = context();
    const events = ctx.eventTypes ?? ctx.event_types;
    if (!ctx.eventSource?.on || !events?.APP_INITIALIZED || !events?.CHAT_CHANGED
        || !isObject(ctx.extensionSettings) || typeof ctx.saveMetadata !== 'function'
        || typeof ctx.saveSettingsDebounced !== 'function') {
        console.error('[青禾记 Tavern] 缺少必要的 Context API，请使用 SillyTavern 1.18.0。');
        return;
    }
    ctx.eventSource.on(events.CHAT_CHANGED, () => {
        if (ui) {
            closePanel();
            ui.status.textContent = '已切换聊天，游戏状态来自当前聊天。';
            refresh();
        }
    });
    ctx.eventSource.on(events.APP_INITIALIZED, initialize);
})();
