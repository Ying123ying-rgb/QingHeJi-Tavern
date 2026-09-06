import { worldTemplates } from './data/world-templates.js';
import { createState, readState, isLegacyState, isObject, getTemplate } from './core/game-state.js';

(() => {
    'use strict';

    const KEY = 'qingheji_tavern';
    const context = () => globalThis.SillyTavern.getContext();
    let ui;
    let busy = false;
    let renderedMetadata;
    let renderedIdentity;
    const migrationAttempts = new WeakSet();

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

    function state(ctx) {
        return readState(ctx.chatMetadata?.[KEY]);
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
        ui.world.disabled = ui.game.disabled;
        ui.world.value = getTemplate(game.world.templateId) ? game.world.templateId : '';
        ui.info.textContent = `角色：${info.name}；characterId：${ctx.characterId ?? '无'}；聊天标识：${info.chatId ?? '无'}`;
        ui.host.hidden = !pluginEnabled(ctx) || !info.valid || !game.enabled;
        if (ui.host.hidden) closePanel();
    }

    function canEdit(ctx) {
        const info = identity(ctx);
        return !busy && pluginEnabled(ctx) && info.valid && isObject(ctx.chatMetadata)
            && ctx.chatMetadata === renderedMetadata && info.key === renderedIdentity;
    }

    async function persist(ctx, next, migrating = false) {
        // Never commit a result prepared for a chat that has since changed.
        const current = context();
        if (busy || current.chatMetadata !== ctx.chatMetadata || identity(current).key !== identity(ctx).key) return;
        const metadata = ctx.chatMetadata;
        const hadState = Object.hasOwn(metadata, KEY);
        const previous = metadata[KEY];
        metadata[KEY] = next;
        busy = true;
        ui.status.textContent = migrating ? '正在迁移旧版游戏存档…' : '正在请求保存…';
        closePanel();
        refresh();
        try {
            // Invoke immediately, without a debounce that could target another chat.
            await ctx.saveMetadata();
            if (context().chatMetadata === metadata) {
                ui.status.textContent = migrating
                    ? '旧版存档已转换，保存请求已完成；请刷新检查。'
                    : '保存请求已完成；可刷新页面检查是否保留。';
            }
        } catch (error) {
            if (metadata[KEY] === next) {
                if (hadState) metadata[KEY] = previous;
                else delete metadata[KEY];
            }
            if (context().chatMetadata === metadata) ui.status.textContent = '保存失败，请稍后重试。';
            console.error('[酒馆人生模拟器] 保存失败', error);
        } finally {
            busy = false;
            refresh();
            // A chat selected during a pending save may also need migration.
            await migrateCurrent();
        }
    }

    function changeGame() {
        const desired = ui.game.checked;
        const ctx = context();
        if (!canEdit(ctx)) { refresh(); return; }
        return persist(ctx, { ...state(ctx), enabled: desired });
    }

    function changeWorld() {
        const templateId = ui.world.value;
        const ctx = context();
        if (!canEdit(ctx) || !getTemplate(templateId) || state(ctx).world.templateId === templateId) {
            refresh(); return;
        }
        const accepted = globalThis.confirm('切换世界模板将重置当前聊天的模拟游戏初始状态，但不会修改角色卡、聊天记录或其他聊天存档。');
        // A cancelled confirmation must leave both the save and selector unchanged.
        const current = context();
        if (!accepted || current.chatMetadata !== ctx.chatMetadata
            || identity(current).key !== identity(ctx).key || !canEdit(current)) {
            refresh(); return;
        }
        return persist(current, createState(templateId, state(current).enabled));
    }

    function migrateCurrent() {
        if (!ui || busy) return;
        const ctx = context();
        const saved = ctx.chatMetadata?.[KEY];
        if (!identity(ctx).valid || !isLegacyState(saved) || migrationAttempts.has(saved)) return;
        // Failed automatic saves are not retried in a loop. A reload or a manual
        // game toggle can retry; failed saves restore the untouched old object.
        migrationAttempts.add(saved);
        return persist(ctx, readState(saved), true);
    }

    function openPanel() {
        refresh();
        if (ui.host.hidden) return;
        const ctx = context();
        const game = state(ctx);
        const rows = [
            ['当前角色', identity(ctx).name],
            ['世界', getTemplate(game.world.templateId)?.displayName ?? game.world.templateId],
            ['游戏模式', '已开启'],
            [game.currency.label, `${game.currency.symbol}${game.currency.amount}`],
            [game.calendar.dateLabel, game.calendar.date],
            [game.calendar.timeLabel, game.calendar.time],
            ...game.stats.map(stat => [stat.label, `${stat.value}/${stat.max}`]),
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
            console.error('[酒馆人生模拟器] 缺少扩展设置区或聊天区，未挂载 UI。');
            return;
        }
        const settings = element('section', undefined, 'qhjt-settings');
        settings.id = 'qhjt-settings';
        const master = toggle('插件总开关', 'qhjt-master');
        const game = toggle('当前聊天启用游戏模式', 'qhjt-game');
        const worldLabel = element('label', '当前聊天世界模板：', 'qhjt-world-label');
        worldLabel.htmlFor = 'qhjt-world';
        const world = element('select', undefined, 'qhjt-world');
        world.id = 'qhjt-world';
        const unknown = element('option', '未识别模板（可重新选择）');
        unknown.value = ''; unknown.disabled = true; unknown.hidden = true;
        world.append(unknown);
        for (const template of worldTemplates) {
            const option = element('option', template.displayName);
            option.value = template.id;
            world.append(option);
        }
        const info = element('p', undefined, 'qhjt-info');
        const status = element('p', '游戏模式默认关闭；请先选择聊天。', 'qhjt-info');
        status.setAttribute('role', 'status');
        settings.append(element('h3', '酒馆人生模拟器'), master.label, game.label, worldLabel, world, info, status);

        const host = element('section', undefined, 'qhjt-host');
        host.id = 'qhjt-host';
        host.hidden = true;
        const entry = element('button', '人生模拟', 'menu_button qhjt-button');
        entry.type = 'button';
        entry.setAttribute('aria-controls', 'qhjt-panel');
        entry.setAttribute('aria-expanded', 'false');
        const panel = element('section', undefined, 'qhjt-panel');
        panel.id = 'qhjt-panel';
        panel.hidden = true;
        panel.setAttribute('aria-labelledby', 'qhjt-title');
        const header = element('div', undefined, 'qhjt-panel-header');
        const title = element('h3', '酒馆人生模拟器 v0.1.1');
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
        ui = { master: master.input, game: game.input, world, info, status, host, entry, panel, close, values };
        master.input.addEventListener('change', () => {
            const ctx = context();
            const existing = ctx.extensionSettings[KEY];
            ctx.extensionSettings[KEY] = { ...(isObject(existing) ? existing : {}), enabled: master.input.checked };
            ctx.saveSettingsDebounced();
            closePanel();
            refresh();
        });
        game.input.addEventListener('change', changeGame);
        world.addEventListener('change', changeWorld);
        entry.addEventListener('click', openPanel);
        close.addEventListener('click', () => closePanel(true));
        panel.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.stopPropagation(); closePanel(true); }
        });
        refresh();
        return migrateCurrent();
    }

    if (typeof globalThis.SillyTavern?.getContext !== 'function') {
        console.error('[酒馆人生模拟器] 需要 SillyTavern UI Extension 环境。');
        return;
    }
    const ctx = context();
    const events = ctx.eventTypes ?? ctx.event_types;
    if (!ctx.eventSource?.on || !events?.APP_INITIALIZED || !events?.CHAT_CHANGED
        || !isObject(ctx.extensionSettings) || typeof ctx.saveMetadata !== 'function'
        || typeof ctx.saveSettingsDebounced !== 'function') {
        console.error('[酒馆人生模拟器] 缺少必要的 Context API，请使用 SillyTavern 1.18.0。');
        return;
    }
    ctx.eventSource.on(events.CHAT_CHANGED, () => {
        if (ui) {
            closePanel();
            ui.status.textContent = '已切换聊天，游戏状态来自当前聊天。';
            refresh();
            return migrateCurrent();
        }
    });
    ctx.eventSource.on(events.APP_INITIALIZED, initialize);
})();
