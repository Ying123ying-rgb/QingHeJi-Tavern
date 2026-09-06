import { worldTemplates } from './data/world-templates.js';
import { readState, needsMigration, isObject, getTemplate, addActor, selectActor, deleteActor, changeCurrency, resetWorld } from './core/game-state.js';
import { currentCharacter, currentUser } from './core/actor-sources.js';

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
        return readState(ctx.chatMetadata?.[KEY], currentCharacter(ctx) ?? undefined);
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
        renderActors(ctx, game);
        ui.info.textContent = `角色：${info.name}；characterId：${ctx.characterId ?? '无'}；聊天标识：${info.chatId ?? '无'}`;
        ui.host.hidden = !pluginEnabled(ctx) || !info.valid || !game.enabled;
        if (ui.host.hidden) closePanel();
        else if (!ui.panel.hidden) renderPanel(ctx, game);
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
        if (migrating) closePanel();
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
        const accepted = globalThis.confirm('切换世界模板将重置本聊天的世界状态以及所有人物的模拟状态，但不会修改角色卡或聊天记录。');
        // A cancelled confirmation must leave both the save and selector unchanged.
        const current = context();
        if (!accepted || current.chatMetadata !== ctx.chatMetadata
            || identity(current).key !== identity(ctx).key || !canEdit(current)) {
            refresh(); return;
        }
        return persist(current, resetWorld(state(current), templateId));
    }

    function migrateCurrent() {
        if (!ui || busy) return;
        const ctx = context();
        const saved = ctx.chatMetadata?.[KEY];
        if (!identity(ctx).valid || !needsMigration(saved) || migrationAttempts.has(saved)) return;
        // Failed automatic saves are not retried in a loop. A reload or a manual
        // game toggle can retry; failed saves restore the untouched old object.
        migrationAttempts.add(saved);
        return persist(ctx, state(ctx), true);
    }

    function button(label, handler, id) {
        const node = element('button', label, 'menu_button qhjt-button');
        node.type = 'button';
        if (id) node.id = id;
        node.addEventListener('click', handler);
        return node;
    }

    function editActor(command, expected = context()) {
        const ctx = context();
        if (!canEdit(ctx) || ctx.chatMetadata !== expected.chatMetadata || identity(ctx).key !== identity(expected).key) {
            refresh(); return;
        }
        const game = state(ctx);
        if (command(game) === false) { refresh(); return; }
        return persist(ctx, game);
    }

    function addPerson(type) {
        const ctx = context();
        if (!canEdit(ctx) || !getTemplate(state(ctx).world.templateId)) { refresh(); return; }
        let descriptor;
        if (type === 'character') descriptor = currentCharacter(ctx);
        else if (type === 'user') descriptor = currentUser(ctx);
        else {
            const name = globalThis.prompt('人物名称');
            if (name === null || !name.trim()) return;
            descriptor = { name: name.trim(), sourceType: 'custom', sourceId: null };
        }
        if (!descriptor) { ui.status.textContent = '当前没有可识别的角色卡，可添加“我”或自定义人物。'; return; }
        return editActor(game => {
            if (!addActor(game, descriptor)) { ui.status.textContent = '该来源的人物已在当前聊天中。'; return false; }
        }, ctx);
    }

    function removePerson(id, expected) {
        const ctx = context();
        if (!canEdit(ctx) || ctx.chatMetadata !== expected.chatMetadata || identity(ctx).key !== identity(expected).key) return;
        const actor = state(ctx).actors[id];
        if (!actor || !globalThis.confirm(`删除人物“${actor.name}”及其模拟状态？此操作不会修改角色卡或聊天记录。`)) return;
        return editActor(game => deleteActor(game, id), expected);
    }

    function renameUser(id, expected) {
        if (context().chatMetadata !== expected.chatMetadata || !canEdit(context())) return;
        const actor = state(context()).actors[id];
        if (actor?.sourceType !== 'user') return;
        const name = globalThis.prompt('玩家显示名称（仅当前聊天模拟人物）', actor.name);
        if (name === null || !name.trim()) return;
        return editActor(game => { if (!game.actors[id]) return false; game.actors[id].name = name.trim(); }, expected);
    }

    function renderActors(ctx, game) {
        const disabled = ui.game.disabled;
        const actors = Object.values(game.actors);
        ui.active.replaceChildren();
        if (!actors.length) {
            const empty = element('option', '尚未添加人物'); empty.value = ''; ui.active.append(empty);
        }
        ui.actorList.replaceChildren();
        for (const actor of actors) {
            const option = element('option', actor.name); option.value = actor.id; ui.active.append(option);
            const row = element('div', undefined, 'qhjt-actor-row');
            const label = element('span', `${actor.id === game.activeActorId ? '●' : '○'} ${actor.name}`, 'qhjt-actor-name');
            label.title = actor.name;
            const source = { character: '当前角色卡来源', user: '玩家', custom: '自定义人物' }[actor.sourceType] ?? '其他来源';
            const actions = element('div', undefined, 'qhjt-actions');
            const activate = button('切换为当前主角', () => editActor(value => selectActor(value, actor.id), ctx));
            const remove = button('删除', () => removePerson(actor.id, ctx));
            activate.disabled = disabled || actor.id === game.activeActorId;
            remove.disabled = disabled;
            actions.append(activate, remove);
            if (actor.sourceType === 'user') {
                const rename = button('修改显示名称', () => renameUser(actor.id, ctx));
                rename.disabled = disabled; actions.append(rename);
            }
            row.append(label, element('small', source), actions); ui.actorList.append(row);
        }
        ui.active.value = game.activeActorId ?? '';
        ui.active.disabled = disabled || !actors.length;
        ui.addCharacter.disabled = disabled || !currentCharacter(ctx) || !getTemplate(game.world.templateId);
        ui.addUser.disabled = ui.addCustom.disabled = disabled || !getTemplate(game.world.templateId);
        ui.plus.disabled = ui.minus.disabled = disabled || !game.activeActorId;
    }

    function rows(node, values) {
        node.replaceChildren();
        for (const [label, value] of values) node.append(element('dt', label), element('dd', value));
    }

    function renderPanel(ctx, game) {
        const actor = game.actors[game.activeActorId];
        rows(ui.values, [
            ['当前世界', getTemplate(game.world.templateId)?.displayName ?? game.world.templateId],
            ['当前主角', actor?.name ?? '尚未添加人物'],
            ['当前角色卡', identity(ctx).name],
        ]);
        rows(ui.worldValues, [
            [game.calendar.dateLabel, game.calendar.date],
            [game.calendar.timeLabel, game.calendar.time],
        ]);
        rows(ui.actorValues, actor ? [
            [actor.currency.label, `${actor.currency.symbol}${actor.currency.amount}`],
            ...actor.stats.map(stat => [stat.label, `${stat.value}/${stat.max}`]),
        ] : [['提示', '请在扩展设置中添加人物。']]);
    }

    function openPanel() {
        refresh();
        if (ui.host.hidden) return;
        renderPanel(context(), state(context()));
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
        const activeLabel = element('label', '当前主角：', 'qhjt-world-label');
        activeLabel.htmlFor = 'qhjt-active';
        const active = element('select', undefined, 'qhjt-world'); active.id = 'qhjt-active';
        const addCharacter = button('添加当前角色', () => addPerson('character'), 'qhjt-add-character');
        const addUser = button('添加“我”', () => addPerson('user'), 'qhjt-add-user');
        const addCustom = button('添加自定义人物', () => addPerson('custom'), 'qhjt-add-custom');
        const addButtons = element('div', undefined, 'qhjt-actions'); addButtons.append(addCharacter, addUser, addCustom);
        const actorList = element('div'); actorList.id = 'qhjt-actors';
        settings.append(element('h3', '人物'), activeLabel, active, addButtons, actorList);

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
        const title = element('h3', '酒馆人生模拟器 v0.1.2');
        title.id = 'qhjt-title';
        const close = element('button', '关闭', 'menu_button qhjt-button');
        close.type = 'button';
        const values = element('dl', undefined, 'qhjt-values');
        values.id = 'qhjt-summary';
        const worldValues = element('dl', undefined, 'qhjt-values'); worldValues.id = 'qhjt-world-values';
        const actorValues = element('dl', undefined, 'qhjt-values'); actorValues.id = 'qhjt-actor-values';
        const plus = button('货币 +100', () => editActor(game => changeCurrency(game, 100)), 'qhjt-plus');
        const minus = button('货币 -100', () => editActor(game => changeCurrency(game, -100)), 'qhjt-minus');
        const testButtons = element('div', undefined, 'qhjt-actions'); testButtons.append(plus, minus);
        header.append(title, close);
        panel.append(header, values, element('h3', '世界状态'), worldValues, element('h3', '人物状态'), actorValues,
            element('h3', '测试修改'), testButtons);
        host.append(entry, panel);
        settingsRoot.append(settings);
        // Sibling of #chat: core message rerenders cannot remove our entry.
        chat.after(host);
        ui = { master: master.input, game: game.input, world, info, status, host, entry, panel, close, values,
            active, actorList, addCharacter, addUser, addCustom, worldValues, actorValues, plus, minus };
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
        active.addEventListener('change', () => { const id = active.value; return editActor(game => selectActor(game, id)); });
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
