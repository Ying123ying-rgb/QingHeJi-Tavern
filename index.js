import { worldTemplates } from './data/world-templates.js';
import { readState, needsMigration, isObject, getTemplate, addActor, inspectActor, setControlMode, resolveControlledActor, deleteActor, changeCurrency, resetWorld } from './core/game-state.js';
import { currentCharacter, currentUser } from './core/actor-sources.js';
import { mountFloatingPanel } from './ui/floating-panel.js';
import { addAction, removeAction, listActions, findAction } from './core/actions.js';
import { applyWorldDelta, validateDiscovery, undoLatestDiscovery, worldId, discoveredLocations, actionsAtLocation } from './core/world-discovery.js';
import { extractDiscoveryCandidates } from './core/discovery-provider.js';
import { createDiscoverySession } from './ui/discovery-session.js';

(() => {
    'use strict';

    const KEY = 'qingheji_tavern';
    const context = () => globalThis.SillyTavern.getContext();
    let ui;
    let busy = false;
    let renderedMetadata;
    let renderedIdentity;
    let discoverySession;
    let inspectedLocationId = null;
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
        if (ui.mounted && ui.host.isConnected && ui.entry.isConnected && ui.panel.isConnected && ui.overlay.isConnected) return;
        unmount();
        const view = mountFloatingPanel(ui.status, {
            open: openPanel, close: closePanel, world: changeWorld, add: addPerson,
            update, addLocation: addPlace, undoDiscovery: undoDiscovery,
            addAction: async () => {
                const expected = context();
                const name = await ui.requestName('行动名称', '', 'actions');
                if (name !== null) await editAction('add', name, expected);
            },
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

    function update() {
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
        renderActions(ctx, game);
        renderLocations(ctx, game);
        ui.info.textContent = `角色：${info.name}；characterId：${ctx.characterId ?? '无'}；聊天标识：${info.chatId ?? '无'}`;
        ui.host.hidden = !pluginEnabled(ctx) || !info.valid || !game.enabled;
        ui.positionFloating();
        if (ui.host.hidden) closePanel();
        else if (!ui.panel.hidden) renderPanel(ctx, game);
    }

    const refresh = update;

    function canEdit(ctx) {
        const info = identity(ctx);
        return !busy && pluginEnabled(ctx) && info.valid && isObject(ctx.chatMetadata)
            && ctx.chatMetadata === renderedMetadata && info.key === renderedIdentity;
    }

    async function persist(ctx, next, migrating = false) {
        // Never commit a result prepared for a chat that has since changed.
        const current = context();
        if (busy || current.chatMetadata !== ctx.chatMetadata || identity(current).key !== identity(ctx).key) return false;
        const metadata = ctx.chatMetadata;
        const hadState = Object.hasOwn(metadata, KEY);
        const previous = metadata[KEY];
        metadata[KEY] = next;
        busy = true;
        ui.status.textContent = migrating ? '正在迁移旧版游戏存档…' : '正在请求保存…';
        if (migrating) closePanel();
        refresh();
        let saved = false;
        try {
            // Invoke immediately, without a debounce that could target another chat.
            await ctx.saveMetadata();
            saved = true;
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
            await discoverySession?.flush();
        }
        return saved;
    }

    function notice(message) {
        if (ui) ui.status.textContent = message;
        globalThis.toastr?.info(message, '酒馆人生模拟器', { escapeHtml: true });
        return message;
    }

    async function editAction(operation, name, expected = context()) {
        const ctx = context();
        if (!canEdit(ctx) || !state(ctx).enabled || ctx.chatMetadata !== expected.chatMetadata
            || identity(ctx).key !== identity(expected).key) return notice('请在当前聊天开启游戏模式，等待保存完成后重试。');
        let next = state(ctx);
        if (operation === 'remove') {
            const action = findAction(next, name);
            if (!action) return notice('当前聊天没有该行动。');
            if (!globalThis.confirm(`确定从当前聊天移除行动‘${action.label}’吗？`)) return notice('已取消删除。');
            if (!canEdit(context()) || context().chatMetadata !== ctx.chatMetadata || identity(context()).key !== identity(ctx).key) return notice('聊天已切换，操作已取消。');
        }
        try {
            const action = operation === 'add' ? addAction(next, name) : removeAction(next, name);
            if (operation === 'add') next = applyWorldDelta(state(ctx), { actionsToAdd: [action] });
            else next.discoveryLog.push({ type: 'action_removed', label: action.label, source: 'user', timestamp: new Date().toISOString() });
            const saved = await persist(ctx, next);
            if (context().chatMetadata !== ctx.chatMetadata || identity(context()).key !== identity(ctx).key) return '';
            return notice(saved ? `已${operation === 'add' ? '添加' : '移除'}行动“${action.label}”。` : '行动保存失败，请重试。');
        } catch (error) { return notice(error.message); }
    }

    function renderActions(ctx, game) {
        ui.actionList.replaceChildren();
        const actions = ui.actionScope.value === 'all' ? listActions(game) : actionsAtLocation(game, resolveControlledActor(game, ctx)?.locationId);
        if (!actions.length) ui.actionList.append(element('p', listActions(game).length ? '当前位置暂无行动，可查看“全部行动”。' : '当前聊天尚未解锁自定义行动。'));
        for (const action of actions) {
            const row = element('div', undefined, 'qhjt-card qhjt-action-card');
            const launch = button(action.label, () => notice('该行动尚未配置执行逻辑。'));
            launch.disabled = action.enabled === false || ui.game.disabled;
            const remove = button('删除', () => editAction('remove', action.label, ctx));
            remove.disabled = ui.game.disabled;
            row.append(launch, remove); ui.actionList.append(row);
        }
        ui.addAction.disabled = ui.game.disabled;
    }

    async function editWorld(delta, expected = context()) {
        const ctx = context();
        if (!canEdit(ctx) || !state(ctx).enabled || ctx.chatMetadata !== expected.chatMetadata || identity(ctx).key !== identity(expected).key) {
            notice('聊天已切换或正在保存，操作已取消。'); return;
        }
        try {
            const next = applyWorldDelta(state(ctx), delta, { source: 'user' });
            const saved = await persist(ctx, next);
            if (context().chatMetadata === ctx.chatMetadata) notice(saved ? '当前聊天的世界知识已保存。' : '保存失败，请重试。');
        } catch (error) { notice(error.message); }
    }

    async function addPlace() {
        const expected = context();
        if (!canEdit(expected) || !state(expected).enabled) return;
        const value = await ui.requestName('地点名', '', 'locations', '简介（选填）');
        if (!value) return;
        const game = state(expected);
        if (Object.values(game.locations).some(location => location.label === value.name)) { notice('当前聊天已有同名地点。'); return; }
        await editWorld({ locationsToAdd: [{ label: value.name, description: value.extra, discovered: true }] }, expected);
    }

    async function addKnowledge(id, field, expected) {
        const labels = { capabilities: '功能名称', resources: '资源名称', services: '服务名称' };
        const name = await ui.requestName(labels[field], '', 'locations');
        if (name === null) return;
        const type = { capabilities: 'capability', resources: 'resource', services: 'service' }[field];
        await editWorld({ locationsToUpdate: [{ id, [field]: [{ id: worldId(type, name), label: name }] }] }, expected);
    }

    async function undoDiscovery() {
        const ctx = context();
        if (!canEdit(ctx) || !state(ctx).enabled) return;
        try {
            const before = state(ctx);
            const target = [...before.discoveryLog].reverse().find(entry => ['auto', 'secondary_ai'].includes(entry.source) && !entry.undoneAt && entry.undo?.patches?.length);
            const next = undoLatestDiscovery(before);
            const result = next.discoveryLog.find(entry => entry.id === target.id).undoResult;
            const saved = await persist(ctx, next);
            if (context().chatMetadata === ctx.chatMetadata) notice(saved
                ? `已撤销 ${result.reverted} 项自动改动；保留 ${result.skipped} 项后续修改或关联数据。` : '撤销保存失败。');
        } catch (error) { notice(error.message); }
    }

    function renderLocations(ctx, game) {
        const actor = resolveControlledActor(game, ctx);
        ui.locationCurrent.textContent = `当前所在：${game.locations[actor?.locationId]?.label ?? '未知'}`;
        ui.locationList.replaceChildren();
        const locations = discoveredLocations(game);
        if (!locations.length) ui.locationList.append(element('p', '当前聊天尚未发现地点。'));
        for (const location of locations) {
            const view = button(location.label, () => {
                if (!canEdit(context()) || context().chatMetadata !== ctx.chatMetadata || identity(context()).key !== identity(ctx).key) return;
                inspectedLocationId = location.id; ui.locationDetail.hidden = false; update();
                ui.locationDetail.scrollIntoView({ block: 'nearest' });
            }, `qhjt-location-${location.id}`);
            view.disabled = ui.game.disabled; ui.locationList.append(view);
        }
        ui.addLocation.disabled = ui.game.disabled;
        ui.locationDetail.replaceChildren();
        const location = game.locations[inspectedLocationId];
        if (!location || (!location.discovered && !location.visited)) ui.locationDetail.hidden = true;
        if (location) {
            ui.locationDetail.append(element('h3', location.label), element('p', location.description || '暂无简介。'));
            const values = element('dl', undefined, 'qhjt-values');
            const names = items => (items ?? []).map(item => typeof item === 'string' ? item : item.label ?? item.id).join('、') || '未知';
            rows(values, [
                ['地点状态', location.visited ? '已到达' : '已发现'],
                ['已知功能', names(location.capabilities)],
                ['已知资源', names((location.resources ?? []).filter(item => item.known !== false))],
                ['已知服务', names(location.services)],
            ]);
            ui.locationDetail.append(values, element('h3', '可执行行动'));
            const actionCards = element('div', undefined, 'qhjt-card-grid');
            const available = actionsAtLocation(game, location.id);
            if (!available.length) actionCards.append(element('p', '暂无已知行动。'));
            for (const action of available) actionCards.append(button(action.label, () => notice('该行动尚未配置执行逻辑。')));
            ui.locationDetail.append(actionCards);
            const controls = element('div', undefined, 'qhjt-card-grid');
            for (const [field, label] of [['capabilities', '＋添加功能'], ['resources', '＋添加资源'], ['services', '＋添加服务']]) {
                const add = button(label, () => addKnowledge(location.id, field, ctx), `qhjt-add-${field}`);
                add.disabled = ui.game.disabled; controls.append(add);
            }
            const place = button('设为当前人物所在', () => editWorld({ locationsToUpdate: [{ id: location.id, visited: true }], actorLocationChanges: [{ actorId: actor.id, locationId: location.id }] }, ctx), 'qhjt-set-location');
            place.disabled = ui.game.disabled || !actor; controls.append(place);
            ui.locationDetail.append(controls);
            const caption = element('label', '选择已解锁行动', 'qhjt-label'); caption.htmlFor = 'qhjt-link-action';
            const select = element('select'); select.id = 'qhjt-link-action';
            for (const action of listActions(game)) {
                const option = element('option', action.label); option.value = action.id; select.append(option);
            }
            const link = button('＋关联行动', () => editWorld({ locationsToUpdate: [{ id: location.id, actions: [select.value] }] }, ctx), 'qhjt-associate-action');
            link.disabled = ui.game.disabled || !listActions(game).length;
            ui.locationDetail.append(caption, select, link);
        }
        ui.discoveryLog.replaceChildren();
        const recent = game.discoveryLog.slice(-50).reverse();
        if (!recent.length) ui.discoveryLog.append(element('p', '暂无发现记录。'));
        for (const entry of recent) {
            const names = entry.discoveries?.map(item => item.label).join('、') || entry.label;
            const source = { user: '手动', auto: '自动', secondary_ai: '自动分析' }[entry.source] ?? entry.source;
            ui.discoveryLog.append(element('p', `${entry.timestamp} · ${source} · ${names}${entry.undoneAt ? '（已撤销）' : ''}`, 'qhjt-card'));
        }
        ui.undoDiscovery.disabled = ui.game.disabled || !game.discoveryLog.some(entry => ['auto', 'secondary_ai'].includes(entry.source) && !entry.undoneAt && entry.undo?.patches?.length);
    }

    function registerCommands(ctx) {
        const callback = async (_args, value) => {
            const match = /^action\s+(add|remove|list)(?:\s+([\s\S]*))?$/u.exec(String(value ?? '').trim());
            if (!match || (match[1] === 'list' && match[2])) {
                notice('用法：/life action add 名称 | remove 名称 | list'); return '';
            }
            if (!ui) initialize();
            if (!ui) { notice('插件尚未就绪。'); return ''; }
            update();
            if (!canEdit(context()) || !state(context()).enabled) {
                notice('请在当前聊天开启游戏模式，等待保存完成后重试。'); return '';
            }
            if (match[1] === 'list') notice(listActions(state(context())).map(action => action.label).join('、') || '当前聊天尚未解锁自定义行动。');
            else await editAction(match[1], match[2]);
            // Never pass action text onward through the STscript pipe.
            return '';
        };
        if (ctx.SlashCommandParser?.addCommandObject && ctx.SlashCommand?.fromProps) {
            ctx.SlashCommandParser.addCommandObject(ctx.SlashCommand.fromProps({
                name: 'life', callback, helpString: '本地行动：/life action add 名称；/life action remove 名称；/life action list',
                unnamedArgumentList: ctx.SlashCommandArgument?.fromProps ? [ctx.SlashCommandArgument.fromProps({
                    description: 'action add/remove 名称，或 action list', typeList: [ctx.ARGUMENT_TYPE.STRING], isRequired: true,
                })] : [],
            }));
        } else if (ctx.registerSlashCommand) {
            ctx.registerSlashCommand('life', callback, [], '本地行动：action add/remove 名称，或 action list', true, true);
        } else notice('宿主缺少 Slash Command API，请使用行动页管理行动。');
    }

    async function changeGame() {
        discoverySession?.cancel();
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
            ['当前所在', game.locations[actor.locationId]?.label ?? '未知'],
            [actor.currency.label, `${actor.currency.symbol}${actor.currency.amount}`],
            ...actor.stats.map(stat => [stat.label, `${stat.value}/${stat.max}`]),
        ] : [['提示', '当前无可识别角色卡，可点击“切换到我”。']]);
        const inspected = game.actors[game.inspectedActorId];
        rows(ui.detailValues, inspected ? [
            ['当前所在', game.locations[inspected.locationId]?.label ?? '未知'],
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
        if (ui) { update(); return; }
        if (!document.body) return;
        const settingsRoot = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
        const settings = element('section', undefined, 'qhjt-settings');
        settings.id = 'qhjt-settings';
        const master = toggle('插件总开关', 'qhjt-master');
        const game = toggle('当前聊天启用游戏模式', 'qhjt-game');
        const status = element('p', '', 'qhjt-info');
        status.setAttribute('role', 'status');
        settings.append(element('h3', '酒馆人生模拟器'), master.label, game.label,
            element('p', '开启后，请在聊天页面点击『人生』悬浮按钮进入模拟器。', 'qhjt-info'));
        settingsRoot?.append(settings);
        ui = { master: master.input, game: game.input, status, settings, mounted: false };
        master.input.addEventListener('change', () => {
            discoverySession?.cancel();
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
    const chatChanged = () => {
        discoverySession?.cancel(); inspectedLocationId = null;
        if (ui) {
            closePanel();
            ui.status.textContent = '已切换聊天，游戏状态来自当前聊天。';
            refresh();
            return migrateCurrent();
        }
    };
    for (const name of new Set([events.CHAT_CHANGED, events.CHARACTER_SELECTED, events.CHARACTER_EDITED].filter(Boolean))) ctx.eventSource.on(name, chatChanged);
    ctx.eventSource.on(events.APP_INITIALIZED, initialize);
    discoverySession = createDiscoverySession({
        context, identity, read: state, busy: () => busy,
        enabled: ctx => Boolean(ui) && pluginEnabled(ctx) && identity(ctx).valid && state(ctx).enabled,
        onError: error => notice(`自动发现未保存：${error.message}`),
        scan: async ({ ctx: expected, turnId, messages }) => {
            const snapshot = state(expected);
            const actor = resolveControlledActor(snapshot, expected);
            const candidate = await extractDiscoveryCandidates({ worldTemplate: getTemplate(snapshot.world.templateId),
                locations: snapshot.locations, actions: snapshot.actions, controlledActor: actor, messages });
            const current = context();
            if (!canEdit(current) || !state(current).enabled || current.chatMetadata !== expected.chatMetadata || identity(current).key !== identity(expected).key) return;
            const latest = state(current);
            if (resolveControlledActor(latest, current)?.id !== actor?.id || latest.discoveryScan.lastTurnId === turnId) return;
            const delta = validateDiscovery(candidate, latest, { source: 'auto' });
            const next = applyWorldDelta(latest, delta, { source: 'auto', turnId });
            next.discoveryScan.lastTurnId = turnId;
            const count = next.discoveryLog.length - latest.discoveryLog.length;
            if (await persist(current, next) && count && context().chatMetadata === current.chatMetadata) notice('已记录本轮明确的世界发现，可在设置中查看或撤销。');
        },
    });
    if (events.GENERATION_AFTER_COMMANDS && events.MESSAGE_RECEIVED && events.GENERATION_ENDED) {
        ctx.eventSource.on(events.GENERATION_AFTER_COMMANDS, (...args) => discoverySession.start(...args));
        ctx.eventSource.on(events.MESSAGE_RECEIVED, id => discoverySession.received(id));
        ctx.eventSource.on(events.GENERATION_ENDED, () => discoverySession.end());
        if (events.GENERATION_STOPPED) ctx.eventSource.on(events.GENERATION_STOPPED, () => discoverySession.cancel());
    }
    registerCommands(ctx);
    initialize(); // Also works when APP_INITIALIZED fired before extension loading.
    if (typeof MutationObserver === 'function') {
        const observer = new MutationObserver(() => {
            if (!ui) { initialize(); return; }
            const root = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
            if (root && ui.settings.parentElement !== root) root.append(ui.settings);
            const current = context();
            const changed = current.chatMetadata !== renderedMetadata || identity(current).key !== renderedIdentity;
            const shouldShow = pluginEnabled(current) && identity(current).valid && current.chatMetadata?.[KEY]?.enabled === true;
            const damaged = ui.mounted && (!ui.host.isConnected || !ui.entry.isConnected || !ui.overlay.isConnected || !ui.panel.isConnected);
            if (changed) { chatChanged(); return; }
            if (damaged || ui.mounted !== pluginEnabled(current) || (ui.mounted && ui.host.hidden === shouldShow)) update();
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }
})();
