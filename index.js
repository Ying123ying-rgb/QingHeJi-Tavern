import { worldTemplates } from './data/world-templates.js';
import { readState, needsMigration, isObject, getTemplate, resolveControlledActor, resetWorld } from './core/game-state.js';
import { currentCharacter } from './core/actor-sources.js';
import { mountFloatingPanel } from './ui/floating-panel.js';
import { addAction, removeAction, listActions, findAction } from './core/actions.js';
import { applyWorldDelta, undoLatestDiscovery, worldId, discoveredLocations, actionsAtLocation } from './core/world-discovery.js';
import { prepareMessages, validateSemanticDelta, applyValidatedDelta } from './core/semantic-state.js';
import { LocalSemanticProvider } from './core/local-semantic.js';
import { SecondaryAIDiscoveryProvider, activeChannel } from './core/secondary-api.js';
import { mountSecondarySettings } from './ui/secondary-settings.js';
import { renderKnowledge } from './ui/knowledge-views.js';
import { semanticInput, syncBatches } from './core/semantic-scan.js';
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
    let scanController, scanning = false;
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
            open: openPanel, close: closePanel, world: changeWorld,
            update, addLocation: addPlace, undoDiscovery: undoDiscovery,
            addInventory: () => editInventory(), addNpc: () => editNpc(), sync: syncHistory, cancelScan: cancelScan,
            addAction: async () => {
                const expected = context();
                const name = await ui.requestName('行动名称', '', 'settings');
                if (name !== null) await editAction('add', name, expected);
            },
        });
        Object.assign(ui, view); ui.viewKeys = Object.keys(view); ui.mounted = true;
        mountSecondarySettings(ui.settingsPage, {
            get: () => context().extensionSettings[KEY]?.secondary ?? { channels: [], activeChannelId: null },
            save: secondary => { cancelScan(); const ctx = context(); ctx.extensionSettings[KEY] = { ...ctx.extensionSettings[KEY], secondary }; ctx.saveSettingsDebounced(); },
            notice, signal: ui.controller.signal,
        });
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
        ui.game.disabled = busy || scanning || !pluginEnabled(ctx) || !info.valid || !isObject(ctx.chatMetadata);
        if (!pluginEnabled(ctx)) { unmount(); return; }
        mount();
        ui.world.disabled = ui.game.disabled;
        ui.world.value = getTemplate(game.world.templateId) ? game.world.templateId : '';
        ui.actorController?.abort(); ui.actorController = new AbortController();
        ui.inventoryDetail.hidden = true; ui.npcDetail.hidden = true;
        renderKnowledge(game, ui, { button, element, userName: ctx.name1, editItem: item => editInventory(item, ctx), editNpc: (npc, field) => editNpc(npc, field, ctx) });
        ui.addInventory.disabled = ui.addNpc.disabled = ui.game.disabled;
        renderActions(ctx, game);
        renderLocations(ctx, game);
        ui.sync.disabled = ui.reanalyze.disabled = ui.game.disabled || !game.enabled;
        ui.cancelScan.disabled = !scanning;
        ui.pendingList.replaceChildren();
        for (const item of game.pendingDiscoveries.filter(item => !item.ignored).slice(-50).reverse()) {
            const row = element('div', undefined, 'qhjt-card');
            row.append(element('p', `${item.value.label ?? item.value.name ?? item.value.text ?? item.kind}：${item.reason}`), element('p', item.ref.evidence));
            const ignore = button('忽略', async () => {
                if (!canEdit(context()) || context().chatMetadata !== ctx.chatMetadata) return;
                const next = state(context()); const found = next.pendingDiscoveries.find(value => value.id === item.id); if (found) found.ignored = true;
                await persist(context(), next);
            }); ignore.disabled = ui.game.disabled; row.append(ignore); ui.pendingList.append(row);
        }
        ui.info.textContent = `角色：${info.name}；characterId：${ctx.characterId ?? '无'}；聊天标识：${info.chatId ?? '无'}`;
        ui.host.hidden = !pluginEnabled(ctx) || !info.valid || !game.enabled;
        ui.positionFloating();
        if (ui.host.hidden) closePanel();
        else if (!ui.panel.hidden) renderPanel(ctx, game);
    }

    const refresh = update;

    function canEdit(ctx) {
        const info = identity(ctx);
        return !busy && !scanning && pluginEnabled(ctx) && info.valid && isObject(ctx.chatMetadata)
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
            console.error('[酒馆人生模拟器] 保存失败');
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
        ui.allActions.replaceChildren();
        const actions = actionsAtLocation(game, resolveControlledActor(game, ctx)?.locationId);
        if (!actions.length) ui.actionList.append(element('p', '当前没有已解锁行动。'));
        for (const action of actions) {
            const launch = button(action.label, () => notice('尚未配置正式执行逻辑。'));
            launch.disabled = ui.game.disabled; ui.actionList.append(launch);
        }
        for (const action of (ui.actionScope.value === 'all' ? listActions(game) : actions)) {
            const row = element('div', undefined, 'qhjt-card qhjt-action-card');
            const launch = button(action.label, () => notice('尚未配置正式执行逻辑。'));
            launch.disabled = action.enabled === false || ui.game.disabled;
            const remove = button('删除', () => editAction('remove', action.label, ctx));
            remove.disabled = ui.game.disabled;
            row.append(launch, remove); ui.allActions.append(row);
        }
        ui.addAction.disabled = ui.game.disabled;
    }

    function cancelScan() { scanController?.abort(); discoverySession?.cancel(); }

    async function scanMessages(expected, batches, reanalyze = false, turnId = null) {
        if (scanning || busy || !pluginEnabled(expected) || !state(expected).enabled) return;
        scanning = true; scanController = new AbortController(); const controller = scanController;
        update(); let completed = 0;
        const channel = activeChannel(expected.extensionSettings[KEY]?.secondary);
        const provider = channel ? new SecondaryAIDiscoveryProvider({ ...channel }, { signal: controller.signal }) : new LocalSemanticProvider();
        try {
            for (const messages of batches) {
                const current = context();
                if (controller.signal.aborted || current.chatMetadata !== expected.chatMetadata || identity(current).key !== identity(expected).key || !pluginEnabled(current) || !state(current).enabled) break;
                const snapshot = state(current), controlled = resolveControlledActor(snapshot, current);
                const input = semanticInput(snapshot, current, messages, controlled);
                notice(`正在${reanalyze ? '重新分析' : '同步'}当前聊天 ${completed + 1}/${batches.length}…`);
                const raw = await provider.extractDiscoveryCandidates(input);
                const latestContext = context();
                if (controller.signal.aborted || latestContext.chatMetadata !== current.chatMetadata || identity(latestContext).key !== identity(current).key || !pluginEnabled(latestContext) || !state(latestContext).enabled) break;
                const latest = state(latestContext);
                if (resolveControlledActor(latest, latestContext)?.id !== controlled?.id) break;
                const validated = validateSemanticDelta(raw, latest, input, { reanalyze });
                const next = applyValidatedDelta(latest, validated, { source: channel ? 'secondary_ai' : 'auto' });
                if (turnId) next.discoveryScan.lastTurnId = turnId;
                if (!await persist(latestContext, next)) { notice('保存失败，已停止同步；本批未标记处理。'); return; }
                completed++;
            }
            if (context().chatMetadata === expected.chatMetadata) notice(controller.signal.aborted ? '扫描已取消，已保存批次保留。' : `已处理 ${completed} 批。${reanalyze ? '重新分析结果仅进入待确认发现。' : '可查看物资、地点和人物。'}`);
        } catch (error) {
            if (context().chatMetadata === expected.chatMetadata) notice(error.message);
        } finally {
            scanning = false; if (scanController === controller) scanController = undefined;
            update(); await discoverySession?.flush();
        }
    }

    async function syncHistory(reanalyze) {
        const ctx = context(); if (!canEdit(ctx) || !state(ctx).enabled) return;
        try {
            const batches = syncBatches(ctx.chat ?? [], state(ctx), ui.syncRange.value, reanalyze);
            if (!batches.length) { notice('所选消息均已处理且未变更。'); return; }
            await scanMessages(ctx, batches, reanalyze);
        } catch (error) { notice(error.message); }
    }

    async function manualSemantic(raw, expected, correction) {
        const ctx = context();
        if (!canEdit(ctx) || !state(ctx).enabled || ctx.chatMetadata !== expected.chatMetadata || identity(ctx).key !== identity(expected).key) return;
        try {
            const game = state(ctx), input = semanticInput(game, ctx, [], resolveControlledActor(game, ctx));
            if (correction && game.npcs[correction.id]) {
                const npc = game.npcs[correction.id];
                if (correction.field === 'appearance') npc.appearance.facts = [];
                if (correction.field === 'personality') npc.personality = { confirmed: [], impressions: [] };
                if (['likes', 'dislikes'].includes(correction.field)) npc.preferences[correction.field] = [];
                if (correction.field === 'history') npc.history = [];
            }
            const next = applyValidatedDelta(game, validateSemanticDelta(raw, game, input, { manual: true }), { source: 'user' });
            if (await persist(ctx, next)) notice('手动修正已保存。');
        } catch (error) { notice(error.message); }
    }

    async function editInventory(item, expected = context()) {
        if (!canEdit(context())) return;
        const value = await ui.requestName(item ? '物资名称（修改数量）' : '物资名称', item?.label ?? '', 'inventory', '数量（留空表示未知）');
        if (!value) return;
        const known = value.extra !== '';
        await manualSemantic({ inventory: { set: [{ ...(item ? { id: item.id } : {}), label: value.name, quantity: known ? Number(value.extra) : null, quantityKnown: known }] } }, expected);
    }

    async function editNpc(npc, field = 'appearance', expected = context()) {
        if (!canEdit(context())) return;
        if (!npc) {
            const value = await ui.requestName('已认识人物的姓名或身份', '', 'npcs', '已知容貌（选填）'); if (!value) return;
            await manualSemantic({ npcs: [{ name: value.name, status: 'known', appearance: value.extra ? [{ text: value.extra }] : [] }] }, expected); return;
        }
        const value = await ui.requestName('替换所选项资料（其他项保留）', field === 'name' ? npc.name : '', 'npcs'); if (value === null) return;
        const update = { id: npc.id, name: field === 'name' ? value : npc.name, status: npc.known ? 'known' : 'encountered' };
        if (['gender', 'age', 'occupation', 'identity'].includes(field)) update.basicInfo = { [field]: { text: value } };
        else if (field === 'relationship') update.relationship = { text: value };
        else if (field !== 'name') update[field] = [{ text: value, ...(field === 'personality' ? { strongEvidence: true } : {}) }];
        await manualSemantic({ npcs: [update] }, expected, { id: npc.id, field });
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
            for (const action of available) actionCards.append(button(action.label, () => notice('尚未配置正式执行逻辑。')));
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

    function rows(node, values) {
        node.replaceChildren();
        for (const [label, value] of values) node.append(element('dt', label), element('dd', value));
    }

    function renderPanel(ctx, game) {
        const actor = resolveControlledActor(game, ctx);
        rows(ui.values, [
            ['当前世界', getTemplate(game.world.templateId)?.displayName ?? game.world.templateId],
            ['当前所在地', game.locations[actor?.locationId]?.label ?? '未知'],
        ]);
        rows(ui.worldValues, [
            [game.calendar.dateLabel, game.calendar.date],
            [game.calendar.timeLabel, game.calendar.time],
        ]);
        rows(ui.actorValues, actor ? [
            ['当前所在', game.locations[actor.locationId]?.label ?? '未知'],
            [actor.currency.label, `${actor.currency.symbol}${actor.currency.amount}`],
            ...actor.stats.map(stat => [stat.label, `${stat.value}/${stat.max}`]),
        ] : [['提示', '当前状态尚未初始化。']]);
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
            cancelScan();
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
        cancelScan(); inspectedLocationId = null;
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
        context, identity, read: state, busy: () => busy || scanning,
        enabled: ctx => Boolean(ui) && pluginEnabled(ctx) && identity(ctx).valid && state(ctx).enabled,
        onError: error => notice(`自动发现未保存：${error.message}`),
        scan: async ({ ctx: expected, turnId }) => {
            const messages = prepareMessages(expected.chat ?? []);
            const roundId = messages.at(-1)?.roundId;
            if (roundId) await scanMessages(expected, [messages.filter(message => message.roundId === roundId)], false, turnId);
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
