import { worldTemplates } from './data/world-templates.js';
import { readState, needsMigration, isObject, getTemplate, addActor, inspectActor, setControlMode, resolveControlledActor, deleteActor, changeCurrency, resetWorld } from './core/game-state.js';
import { currentCharacter, currentUser } from './core/actor-sources.js';
import { mountFloatingPanel } from './ui/floating-panel.js';

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
        const game = readState(ctx.chatMetadata?.[KEY], currentCharacter(ctx) ?? undefined);
        if (game.enabled) resolveControlledActor(game, ctx);
        return game;
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
        ui?.closeFloating?.(focus);
    }

    function mount() {
        if (ui.mounted) return;
        const view = mountFloatingPanel(ui.chat, ui.status, {
            open: openPanel, close: closePanel, world: changeWorld, add: addPerson,
            currency: delta => editActor(game => changeCurrency(game, delta, context())),
            control: () => editActor(game => setControlMode(game, game.controlMode === 'user' ? 'character' : 'user', context())),
        });
        Object.assign(ui, view); ui.viewKeys = Object.keys(view); ui.mounted = true;
        const unknown = element('option', '未识别模板（可重新选择）');
        unknown.value = ''; unknown.disabled = true; unknown.hidden = true; ui.world.append(unknown);
        for (const template of worldTemplates) {
            const option = element('option', template.displayName); option.value = template.id; ui.world.append(option);
        }
    }

    function unmount() {
        if (!ui.mounted) return;
        ui.actorController?.abort(); ui.actorController = undefined;
        ui.destroyFloating();
        for (const key of ui.viewKeys) delete ui[key];
        ui.viewKeys = []; ui.mounted = false;
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
        if (!pluginEnabled(ctx)) { unmount(); return; }
        mount();
        ui.world.disabled = ui.game.disabled;
        ui.world.value = getTemplate(game.world.templateId) ? game.world.templateId : '';
        renderActors(ctx, game);
        ui.info.textContent = `角色：${info.name}；characterId：${ctx.characterId ?? '无'}；聊天标识：${info.chatId ?? '无'}`;
        ui.host.hidden = !pluginEnabled(ctx) || !info.valid || !game.enabled;
        ui.positionFloating();
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

    async function changeGame() {
        const desired = ui.game.checked;
        const ctx = context();
        if (!canEdit(ctx)) { refresh(); return; }
        const next = { ...state(ctx), enabled: desired };
        if (desired) resolveControlledActor(next, ctx);
        await persist(ctx, next);
        const current = context();
        if (desired && current.chatMetadata === ctx.chatMetadata && identity(current).key === identity(ctx).key
            && state(current).enabled) openPanel();
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
        if (!identity(ctx).valid || !isObject(saved) || migrationAttempts.has(saved)) return;
        const next = state(ctx);
        if (!needsMigration(saved) && JSON.stringify(next) === JSON.stringify(saved)) return;
        // Failed automatic saves are not retried in a loop. A reload or a manual
        // game toggle can retry; failed saves restore the untouched old object.
        migrationAttempts.add(saved);
        return persist(ctx, state(ctx), true);
    }

    function button(label, handler, id) {
        const node = element('button', label, 'menu_button qhjt-button');
        node.type = 'button';
        if (id) node.id = id;
        node.addEventListener('click', handler, { signal: ui.actorController.signal });
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

    async function addPerson(type) {
        const ctx = context();
        if (!canEdit(ctx) || !getTemplate(state(ctx).world.templateId)) { refresh(); return; }
        let descriptor;
        if (type === 'character') descriptor = currentCharacter(ctx);
        else if (type === 'user') descriptor = currentUser(ctx);
        else {
            const name = await ui.requestName('人物名称');
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
        if (id === resolveControlledActor(state(ctx), ctx)?.id) return;
        if (!actor || !globalThis.confirm(`删除人物“${actor.name}”及其模拟状态？此操作不会修改角色卡或聊天记录。`)) return;
        return editActor(game => deleteActor(game, id, ctx), expected);
    }

    async function renameUser(id, expected) {
        if (context().chatMetadata !== expected.chatMetadata || !canEdit(context())) return;
        const actor = state(context()).actors[id];
        if (actor?.sourceType !== 'user') return;
        const name = await ui.requestName('玩家显示名称（仅当前聊天模拟人物）', actor.name);
        if (name === null || !name.trim()) return;
        return editActor(game => { if (!game.actors[id]) return false; game.actors[id].name = name.trim(); }, expected);
    }

    function renderActors(ctx, game) {
        ui.actorController?.abort(); ui.actorController = new AbortController();
        const disabled = ui.game.disabled;
        const controlled = resolveControlledActor(game, ctx);
        const actors = Object.values(game.actors);
        ui.actorList.replaceChildren();
        for (const actor of actors) {
            const row = element('div', undefined, 'qhjt-actor-row');
            const view = async () => {
                if (!canEdit(context()) || context().chatMetadata !== ctx.chatMetadata || identity(context()).key !== identity(ctx).key) return;
                ui.detail.hidden = false;
                await editActor(value => inspectActor(value, actor.id), ctx);
                if (ui.mounted && !ui.detail.hidden && context().chatMetadata === ctx.chatMetadata) {
                    ui.detail.scrollIntoView({ block: 'nearest' });
                }
            };
            const label = button(`${actor.id === controlled?.id ? '当前操作 · ' : ''}${actor.name}`, view, `qhjt-inspect-${actor.id}`);
            label.className = 'qhjt-button qhjt-actor-name';
            label.title = actor.name;
            label.disabled = disabled;
            const source = { character: '角色卡', user: 'User', custom: 'NPC / 自定义' }[actor.sourceType] ?? '其他来源';
            const actions = element('div', undefined, 'qhjt-actions');
            const remove = button('删除', () => removePerson(actor.id, ctx));
            remove.disabled = disabled || actor.id === controlled?.id;
            if (actor.id !== controlled?.id) actions.append(remove);
            if (actor.sourceType === 'user') {
                const rename = button('修改显示名称', () => renameUser(actor.id, ctx));
                rename.disabled = disabled; actions.append(rename);
            }
            row.append(label, element('small', source), actions); ui.actorList.append(row);
        }
        ui.addCharacter.disabled = disabled || !currentCharacter(ctx) || !getTemplate(game.world.templateId);
        ui.addUser.disabled = ui.addCustom.disabled = disabled || !getTemplate(game.world.templateId);
        ui.plus.disabled = ui.minus.disabled = disabled || !controlled;
        ui.control.disabled = disabled;
        ui.control.textContent = game.controlMode === 'user' ? '跟随当前角色' : '切换到我';
    }

    function rows(node, values) {
        node.replaceChildren();
        for (const [label, value] of values) node.append(element('dt', label), element('dd', value));
    }

    function renderPanel(ctx, game) {
        const actor = resolveControlledActor(game, ctx);
        rows(ui.values, [
            ['世界', getTemplate(game.world.templateId)?.displayName ?? game.world.templateId],
            ['当前操作角色', actor?.name ?? '当前无可识别角色卡'],
        ]);
        rows(ui.worldValues, [
            [game.calendar.dateLabel, game.calendar.date],
            [game.calendar.timeLabel, game.calendar.time],
        ]);
        rows(ui.actorValues, actor ? [
            [actor.currency.label, `${actor.currency.symbol}${actor.currency.amount}`],
            ...actor.stats.map(stat => [stat.label, `${stat.value}/${stat.max}`]),
        ] : [['提示', '当前无可识别角色卡，可点击“切换到我”。']]);
        const inspected = game.actors[game.inspectedActorId];
        rows(ui.detailValues, inspected ? [
            ['正在查看', inspected.name], ['身份', inspected.id === resolveControlledActor(game, ctx)?.id ? '当前操作角色' : 'NPC（仅查看）'],
            [inspected.currency.label, `${inspected.currency.symbol}${inspected.currency.amount}`],
            ...inspected.stats.map(stat => [stat.label, `${stat.value}/${stat.max}`]),
        ] : [['提示', '请点击人物名称查看详情。']]);
    }

    function openPanel() {
        refresh();
        if (!ui.mounted || ui.host.hidden) return;
        renderPanel(context(), state(context()));
        ui.openFloating();
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
        const status = element('p', '', 'qhjt-info');
        status.setAttribute('role', 'status');
        settings.append(element('h3', '酒馆人生模拟器'), master.label, game.label,
            element('p', '开启后，请在聊天页面点击『人生』悬浮按钮进入模拟器。', 'qhjt-info'));
        settingsRoot.append(settings);
        ui = { master: master.input, game: game.input, status, chat, mounted: false };
        master.input.addEventListener('change', () => {
            const ctx = context();
            const existing = ctx.extensionSettings[KEY];
            ctx.extensionSettings[KEY] = { ...(isObject(existing) ? existing : {}), enabled: master.input.checked };
            ctx.saveSettingsDebounced();
            closePanel();
            refresh();
        });
        game.input.addEventListener('change', changeGame);
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
