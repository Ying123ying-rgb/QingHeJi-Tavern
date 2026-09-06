/* Mock DOM/Context checks: no real SillyTavern, browser layout or server writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
if (!vm.SourceTextModule) {
    const result = require('node:child_process').spawnSync(process.execPath, ['--experimental-vm-modules', __filename], { stdio: 'inherit' });
    process.exit(result.status ?? 1);
}
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
assert.equal(manifest.version, '0.2.0');
assert.equal(manifest.display_name, '酒馆人生模拟器');
assert.equal(manifest.minimum_client_version, '1.18.0');
assert.equal(manifest.loading_order, 100);
for (const key of ['js', 'css']) {
    assert(!path.isAbsolute(manifest[key]) && !manifest[key].includes('..'));
    assert(fs.statSync(path.join(root, manifest[key])).isFile());
}
const plain = value => JSON.parse(JSON.stringify(value));
const equal = (a, b) => assert.deepEqual(plain(a), plain(b));
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.events = {}; this.attributes = {}; this.style = {}; this.hidden = false; this.open = false; }
    append(...nodes) { for (const node of nodes) { node.remove(); this.children.push(node); node.parentElement = this; } }
    after(node) { this.parentElement.append(node); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(name, handler, options) {
        this.events[name] = handler;
        options?.signal?.addEventListener('abort', () => { if (this.events[name] === handler) delete this.events[name]; }, { once: true });
    }
    replaceChildren(...nodes) { for (const child of [...this.children]) child.remove(); this.append(...nodes); }
    remove() { if (this.parentElement) { this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; } }
    get isConnected() { return this.tag === 'html' || Boolean(this.parentElement?.isConnected); }
    getBoundingClientRect() { return { top: this.id === 'form_sheld' ? 650 : 0, bottom: 650, right: 320 }; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    scrollIntoView() {}
    focus() {}
}
const nodes = [];
const create = tag => { const node = new Node(tag); nodes.push(node); return node; };
const html = create('html'), body = create('body'); html.append(body);
const settings = create('div'); settings.id = 'extensions_settings2';
const shell = create('div'); const chatNode = create('div'); chatNode.id = 'chat'; shell.append(chatNode);
body.append(settings, shell);
const get = id => nodes.find(node => node.id === id && node.isConnected);
const listeners = {};
const KEY = 'qingheji_tavern';
let metadata = {}, chatId = 'A', characterId = 0, groupId;
const card = freeze({ name: '<砚绒>', avatar: 'yanrong.png', description: 'unchanged', scenario: 'unchanged', first_mes: 'unchanged' });
let characters = [card];
const chat = freeze([{ mes: 'Do not edit chat text', is_user: false }]);
const originalChat = JSON.stringify(chat), originalCard = JSON.stringify(card);
const extensionSettings = {};
let saves = 0, settingSaves = 0;
let save = async () => { saves++; };
let confirmed = true, prompted = '洛冉', onConfirm = () => {}, onPrompt = () => {};
const confirmations = [];
const commands = {}, notices = [];
const ctx = () => ({ characterId, characters, groupId, name1: '我', chatId, chat, chatMetadata: metadata,
    SlashCommandParser: { addCommandObject: command => { assert(!commands[command.name]); commands[command.name] = command; } },
    SlashCommand: { fromProps: value => value },
    extensionSettings, saveMetadata: () => save(), saveSettingsDebounced: () => { settingSaves++; },
    eventTypes: { APP_INITIALIZED: 'init', CHAT_CHANGED: 'chat' },
    eventSource: { on: (name, handler) => { listeners[name] = handler; } },
});
const windowEvents = new Node('window');
const sandbox = vm.createContext({ SillyTavern: { getContext: ctx }, document: { createElement: create, getElementById: get, body, documentElement: html },
    AbortController, innerHeight: 740, innerWidth: 320, addEventListener: windowEvents.addEventListener.bind(windowEvents),
    console: { error() {} }, toastr: { info: message => notices.push(message) },
    confirm: message => { confirmations.push(message); onConfirm(); return confirmed; },
    prompt: () => { onPrompt(); return prompted; },
});
const modules = new Map();
function load(file) {
    assert(file.startsWith(root + path.sep));
    if (!modules.has(file)) {
        const source = fs.readFileSync(file, 'utf8');
        assert(!/\b(?:fetch|XMLHttpRequest|generateRaw|generateQuietPrompt|sendSystemMessage|writeExtensionField|saveWorldInfo|openCharacterChat|selectCharacterById)\s*\(/.test(source));
        modules.set(file, new vm.SourceTextModule(source, { context: sandbox, identifier: file }));
    }
    return modules.get(file);
}
async function run() {
    const entry = load(path.join(root, 'index.js'));
    await entry.link((specifier, importing) => {
        assert(specifier.startsWith('./') || specifier.startsWith('../'));
        return load(path.resolve(path.dirname(importing.identifier), specifier));
    });
    await entry.evaluate();
    const engine = modules.get(path.join(root, 'core/game-state.js')).namespace;
    const { createState, addActor, inspectActor, setControlMode, resolveControlledActor, resolveActorContext, deleteActor, changeCurrency, resetWorld, readState, needsMigration } = engine;
    const { currentCharacter, currentUser } = modules.get(path.join(root, 'core/actor-sources.js')).namespace;
    const { worldTemplates } = modules.get(path.join(root, 'data/world-templates.js')).namespace;
    const templateSnapshot = JSON.stringify(worldTemplates);
    assert.equal(worldTemplates.length, 3);
    assert.equal(currentCharacter(ctx()).sourceId, 'yanrong.png');
    assert.equal(currentUser({}).name, '我');
    for (const template of worldTemplates) {
        const world = createState(template.id);
        assert.equal(world.controlMode, 'character');
        const yanrong = resolveControlledActor(world, ctx());
        assert.equal(yanrong.name, '<砚绒>');
        assert.equal(resolveControlledActor(world, ctx()), yanrong);
        const calendar = plain(world.calendar);
        setControlMode(world, 'user', ctx());
        const player = resolveControlledActor(world, ctx());
        const luoran = addActor(world, { name: '洛冉', sourceType: 'custom' });
        equal(player.currency, template.currency); equal(yanrong.stats, template.stats);
        inspectActor(world, luoran.id);
        const roles = resolveActorContext(world, ctx());
        assert.equal(roles.controlledActor, player); assert.equal(roles.currentCharacter.sourceId, 'yanrong.png');
        assert.equal(roles.inspectedActor, luoran);
        changeCurrency(world, 100, ctx());
        assert.equal(player.currency.amount, template.currency.amount + 100);
        assert.equal(yanrong.currency.amount, template.currency.amount);
        assert.equal(luoran.currency.amount, template.currency.amount);
        yanrong.stats[0].value = 7;
        assert.equal(luoran.stats[0].value, template.stats[0].value);
        for (const key of ['currency','stats','inventory','skills','relationships','personalState']) assert.notEqual(player[key], yanrong[key]);
        setControlMode(world, 'character', ctx());
        assert.equal(resolveControlledActor(world, ctx()), yanrong);
        characters = [null, card]; characterId = 1;
        assert.equal(resolveControlledActor(world, ctx()), yanrong);
        characters = [card]; characterId = 0;
        equal(world.calendar, calendar);
        const reset = resetWorld(world, 'sci_fi');
        equal(Object.keys(reset.actors), Object.keys(world.actors));
        assert.equal(reset.controlMode, 'character'); assert.equal(reset.inspectedActorId, luoran.id);
        for (const actor of Object.values(reset.actors)) { assert.equal(actor.currency.amount, 3000); equal(actor.stats, worldTemplates[2].stats); }
        assert.equal(deleteActor(reset, yanrong.id, ctx()), false);
        assert(deleteActor(reset, luoran.id, ctx()));
        assert.equal(reset.inspectedActorId, yanrong.id);
    }
    const oldMulti = createState('modern_city', true);
    const oldNpc = addActor(oldMulti, currentCharacter(ctx()));
    const oldPlayer = addActor(oldMulti, currentUser(ctx()));
    oldPlayer.currency.amount = 4321; oldNpc.stats[0].value = 17;
    oldMulti.schemaVersion = 3; oldMulti.activeActorId = oldPlayer.id;
    delete oldMulti.controlMode; delete oldMulti.inspectedActorId;
    const originalMulti = plain(oldMulti);
    const migratedMulti = readState(oldMulti);
    assert(needsMigration(oldMulti)); assert(!needsMigration(migratedMulti));
    assert.equal(migratedMulti.controlMode, 'user');
    assert.equal(migratedMulti.inspectedActorId, oldPlayer.id);
    assert(!Object.hasOwn(migratedMulti, 'activeActorId'));
    equal(migratedMulti.actors, oldMulti.actors); equal(oldMulti, originalMulti);
    for (const field of ['playerActorId', 'activeActorId']) {
        for (const [id, mode] of [[oldPlayer.id,'user'],[oldNpc.id,'character'],['missing','character']]) {
            const saved = plain(oldMulti); delete saved.activeActorId; saved[field] = id;
            const migrated = readState(saved);
            assert.equal(migrated.controlMode, mode); equal(migrated.actors, saved.actors);
            assert(!Object.hasOwn(migrated, 'playerActorId')); assert(!Object.hasOwn(migrated, 'activeActorId'));
        }
    }
    const explicit = { ...oldMulti, playerActorId: oldNpc.id };
    assert.equal(readState(explicit).controlMode, 'character');
    assert.equal(readState({...oldMulti, controlMode:'character'}).controlMode, 'character');
    const empty = createState();
    assert.equal(resolveControlledActor(empty, {}), null);
    setControlMode(empty, 'user', {}); assert.equal(resolveControlledActor(empty, {}).name, '我');
    await listeners.init(); await listeners.init();
    const answerName = () => {
        if (get('qhjt-name-form')?.hidden !== false) return;
        onPrompt();
        if (get('qhjt-name-form')?.hidden !== false) return;
        if (prompted === null) get('qhjt-name-cancel').events.click();
        else {
            get('qhjt-name').value = prompted;
            get('qhjt-name-form').events.submit({ preventDefault() {} });
            if (!prompted.trim()) get('qhjt-name-cancel').events.click();
        }
    };
    const click = async id => { assert(!get(id).disabled, id); const pending = get(id).events.click(); answerName(); await pending; };
    const choose = async (id, value) => { get(id).value = value; await get(id).events.change(); };
    const game = () => metadata[KEY];
    const switchChat = async (id, data) => { chatId = id; metadata = data; await listeners.chat(); };
    const enable = async () => { get('qhjt-game').checked = true; await get('qhjt-game').events.change(); };
    const rowValues = id => {
        const children = get(id).children; const result = {};
        for (let i = 0; i < children.length; i += 2) result[children[i].textContent] = children[i + 1].textContent;
        return result;
    };
    assert.equal(saves, 0); assert.equal(get('qhjt-host').hidden, true);
    assert.equal(get('qhjt-settings').children.length, 4);
    assert.equal(get('qhjt-active'), undefined);
    await enable();
    assert.equal(get('qhjt-overlay').open, true);
    assert.equal(get('qhjt-onboarding'), undefined);
    assert.equal(game().controlMode, 'character');
    assert.equal(rowValues('qhjt-summary')['当前操作角色'], '<砚绒>');
    await choose('qhjt-world', 'modern_city');
    const yanrongId = resolveControlledActor(game(), ctx()).id;
    await click('qhjt-control');
    const playerId = resolveControlledActor(game(), ctx()).id;
    assert.equal(game().actors[playerId].name, '我');
    assert.equal(get('qhjt-control').textContent, '跟随当前角色');
    await click('qhjt-control');
    assert.equal(resolveControlledActor(game(), ctx()).id, yanrongId);
    assert.equal(get('qhjt-control').textContent, '切换到我');
    await click('qhjt-control');
    await click('qhjt-tab-actors');
    await click('qhjt-add-character'); await click('qhjt-add-user'); // no duplicates
    prompted = '洛冉'; await click('qhjt-add-custom');
    const ids = Object.keys(game().actors); assert.equal(ids.length, 3);
    const luoranId = ids[2];
    const calendar = plain(game().calendar);
    await click('qhjt-inspect-' + yanrongId);
    assert.equal(resolveControlledActor(game(), ctx()).id, playerId);
    assert.equal(game().inspectedActorId, yanrongId);
    assert.equal(rowValues('qhjt-detail-values')['正在查看'], '<砚绒>');
    assert.equal(rowValues('qhjt-summary')['当前操作角色'], '我');
    assert.equal(get('qhjt-actor-detail').hidden, false);
    await click('qhjt-inspect-' + luoranId);
    assert.equal(resolveControlledActor(game(), ctx()).id, playerId);
    await click('qhjt-tab-state'); await click('qhjt-plus');
    assert.equal(game().actors[playerId].currency.amount, 1100);
    assert.equal(game().actors[luoranId].currency.amount, 1000);
    assert.equal(game().actors[yanrongId].currency.amount, 1000);
    assert.equal(rowValues('qhjt-actor-values')['余额'], '¥1100');
    assert.equal(rowValues('qhjt-detail-values')['余额'], '¥1000');
    equal(game().calendar, calendar);
    await click('qhjt-tab-actors'); await click('qhjt-detail-close');
    assert.equal(get('qhjt-actor-detail').hidden, true);
    await click('qhjt-inspect-' + luoranId);
    assert.equal(resolveControlledActor(game(), ctx()).id, playerId);
    await click('qhjt-close'); await click('qhjt-entry');
    assert.equal(resolveControlledActor(game(), ctx()).id, playerId);
    assert.equal(get('qhjt-actor-detail').hidden, true);
    await click('qhjt-inspect-' + luoranId);
    const savedA = metadata;
    const beforeReload = plain(game());
    await switchChat('A', plain(metadata)); equal(game(), beforeReload);
    assert.equal(game().inspectedActorId, luoranId);
    await click('qhjt-entry');
    assert.equal(rowValues('qhjt-summary')['当前操作角色'], '我');
    characters = [{ name: '洛冉', avatar: 'luoran.png' }];
    await switchChat('B', {}); assert.equal(get('qhjt-host').hidden, true); await enable();
    assert.equal(game().controlMode, 'character');
    assert.equal(rowValues('qhjt-summary')['当前操作角色'], '洛冉');
    const savedB = metadata;
    await click('qhjt-plus');
    assert.equal(resolveControlledActor(game(), ctx()).currency.amount, 200);
    await click('qhjt-control');
    assert.equal(resolveControlledActor(game(), ctx()).name, '我');
    assert.equal(resolveControlledActor(game(), ctx()).currency.amount, 100);
    characters = [card];
    await switchChat('A', savedA);
    assert.equal(game().controlMode, 'user');
    assert.equal(resolveControlledActor(game(), ctx()).currency.amount, 1100);
    characters = [{ name: '洛冉', avatar: 'luoran.png' }];
    await switchChat('B', savedB);
    assert.equal(game().controlMode, 'user');
    assert.equal(resolveControlledActor(game(), ctx()).currency.amount, 100);
    await click('qhjt-control');
    assert.equal(resolveControlledActor(game(), ctx()).name, '洛冉');
    assert.equal(resolveControlledActor(game(), ctx()).currency.amount, 200);
    characters = [card];
    await switchChat('A', savedA);
    const beforeWorld = plain(game()); confirmed = false;
    await choose('qhjt-world', 'sci_fi'); equal(game(), beforeWorld);
    confirmed = true; await choose('qhjt-world', 'sci_fi');
    assert.equal(resolveControlledActor(game(), ctx()).id, playerId); assert.equal(game().inspectedActorId, luoranId);
    for (const actor of Object.values(game().actors)) assert.equal(actor.currency.amount, 3000);
    // Removing an inspected NPC cannot change the control mode.
    const npcRow = get('qhjt-actors').children[2];
    confirmed = false; await npcRow.children[2].children[0].events.click(); assert(game().actors[luoranId]);
    confirmed = true; await npcRow.children[2].children[0].events.click();
    assert.equal(game().actors[luoranId], undefined);
    assert.equal(resolveControlledActor(game(), ctx()).id, playerId); assert.equal(game().inspectedActorId, playerId);
    assert.equal(get('qhjt-actors').children[1].children[2].children.some(node => node.textContent === '删除'), false);
    // Saving an action or migration must still roll back safely on failure.
    save = async () => { throw new Error('offline'); };
    const beforeFailure = plain(game()); await click('qhjt-plus'); equal(game(), beforeFailure);
    const failed = { [KEY]: plain(oldMulti) }; const oldObject = failed[KEY];
    await switchChat('failed-multi', failed); assert.equal(game(), oldObject);
    await listeners.chat(); assert.equal(game(), oldObject);
    save = async () => { saves++; };
    const beforeMigration = saves;
    await switchChat('old-multi', { [KEY]: plain(oldMulti) });
    assert.equal(saves, beforeMigration + 1); assert.equal(resolveControlledActor(game(), ctx()).id, oldPlayer.id);
    assert.equal(resolveControlledActor(game(), ctx()).currency.amount, 4321);
    await listeners.chat(); assert.equal(saves, beforeMigration + 1);
    const legacy01 = { schemaVersion: 1, enabled: true, money: 0, date: '四月初二', time: '午时',
        stamina: { current: 37, max: 120 }, satiety: { current: 0, max: 90 }, inventory: { saved: true } };
    const legacy011 = { schemaVersion: 2, enabled: true, world: { templateId: 'modern_city', templateVersion: 1 },
        calendar: { dateLabel: '日期', date: '12月31日', timeLabel: '时间', time: '23:59' }, worldState: { weather: 'rain' },
        currency: { id: 'money', label: '余额', symbol: '¥', amount: 5123 }, stats: [{ id: 'energy', label: '精力', value: 31, max: 120 }],
        skills: { old: 3 }, relationships: { friend: 5 } };
    for (const old of [legacy01, legacy011]) {
        assert(needsMigration(old)); const snapshot = plain(old);
        await switchChat('legacy', { [KEY]: plain(old), unrelated: 'keep' });
        assert.equal(game().schemaVersion, 5);
        assert.equal(resolveControlledActor(game(), ctx()).id, 'actor_1'); assert.equal(game().inspectedActorId, 'actor_1');
        const player = resolveControlledActor(game(), ctx());
        if (old === legacy01) {
            assert.equal(player.currency.amount, 0); assert.equal(player.stats[0].value, 37); assert.equal(player.stats[1].value, 0);
            assert.equal(game().calendar.date, old.date); assert.equal(game().calendar.time, old.time); assert(player.inventory.saved);
        } else {
            equal(player.currency, old.currency); equal(player.stats, old.stats); equal(player.skills, old.skills);
            equal(game().calendar, old.calendar); equal(game().worldState, old.worldState);
        }
        equal(old, snapshot); equal(readState(game()), game()); assert.equal(metadata.unrelated, 'keep');
    }
    // Delayed action/save, stale read-only detail and pending name input across chats.
    const legacyChat = metadata;
    let finish; save = () => new Promise(resolve => { finish = resolve; });
    const pending = get('qhjt-plus').events.click();
    await switchChat('queued', { [KEY]: plain(oldMulti) });
    save = async () => { saves++; }; finish(); await pending;
    assert.equal(resolveControlledActor(game(), ctx()).id, oldPlayer.id); assert.equal(resolveControlledActor(game(), ctx()).currency.amount, 4321);
    const staleView = get('qhjt-inspect-' + oldNpc.id);
    await switchChat('empty', {}); await staleView.events.click?.(); assert.equal(game(), undefined);
    prompted = '不应添加'; onPrompt = () => { chatId = 'other'; metadata = {}; listeners.chat(); };
    await click('qhjt-add-custom'); assert.equal(game(), undefined); onPrompt = () => {};
    await switchChat('A', legacyChat); await click('qhjt-entry');
    get('qhjt-overlay').events.click({ target: get('qhjt-overlay') }); assert.equal(get('qhjt-overlay').open, false);
    assert.equal(chatNode.style.overflow, undefined);
    get('qhjt-master').checked = false; await get('qhjt-master').events.change();
    assert.equal(get('qhjt-host'), undefined); assert.equal(get('qhjt-overlay'), undefined);
    assert.equal(windowEvents.events.resize, undefined);
    get('qhjt-master').checked = true; await get('qhjt-master').events.change();
    for (const id of ['qhjt-entry', 'qhjt-overlay', 'qhjt-panel']) assert.equal(nodes.filter(node => node.id === id && node.isConnected).length, 1);
    assert.equal(get('qhjt-host').parentElement, body);
    assert.equal(get('qhjt-overlay').parentElement, body);
    const registry = modules.get(path.join(root, 'core/actions.js')).namespace;
    equal(createState().actions, {});
    const withoutActions = plain(game()); delete withoutActions.actions;
    const normalized = readState(withoutActions);
    equal(normalized.actions, {}); assert(needsMigration(withoutActions));
    for (const key of ['world', 'actors', 'controlMode', 'calendar']) equal(normalized[key], withoutActions[key]);
    const future = createState();
    const custom = registry.addAction(future, '未来行动');
    Object.assign(custom, { duration: 120, costs: { stamina: 10 }, requirements: [], effects: [], location: 'custom', cooldown: 2, aiRoute: 'secondary', handler: 'opaque', metadata: { version: 2 } });
    equal(readState(future).actions, future.actions);
    equal(resetWorld(future, 'modern_city').actions, future.actions);
    const stableId = custom.id; registry.removeAction(future, custom.label);
    assert.equal(registry.addAction(future, custom.label).id, stableId);
    const command = value => commands.life.callback({}, value);
    await switchChat('action-A', {}); await enable();
    const actionA = metadata;
    assert.equal(await command('action add 摆摊'), '');
    assert.equal(registry.listActions(game()).length, 1);
    await command('action add  摆摊  '); assert.equal(registry.listActions(game()).length, 1);
    assert.match(notices.at(-1), /同名/);
    await command('action add'); assert.match(notices.at(-1), /不能为空/);
    await command('action list'); assert.equal(notices.at(-1), '摆摊');
    await switchChat('action-B', {}); await enable();
    const actionB = metadata; equal(game().actions, {});
    prompted = '本地自定义'; await click('qhjt-add-action');
    assert.equal(registry.listActions(game())[0].label, prompted);
    await switchChat('action-A', actionA);
    assert.equal(registry.listActions(game())[0].label, '摆摊');
    const beforeExecute = plain(game());
    get('qhjt-action-list').children[0].children[0].events.click();
    assert.equal(notices.at(-1), '该行动尚未配置执行逻辑。'); equal(game(), beforeExecute);
    confirmed = false; await command('action remove 摆摊'); assert.equal(registry.listActions(game()).length, 1);
    confirmed = true; await command('action remove 摆摊'); equal(game().actions, {});
    assert.equal(confirmations.at(-1), '确定从当前聊天移除行动‘摆摊’吗？');
    await switchChat('action-B', actionB); assert.equal(registry.listActions(game()).length, 1);
    const beforeActionFailure = plain(game()); save = async () => { throw Error('save failed'); };
    await command('action add 保存失败'); equal(game(), beforeActionFailure); assert.match(notices.at(-1), /保存失败/);
    save = async () => { saves++; };
    assert.equal(extensionSettings[KEY].actions, undefined);
    get('qhjt-host').remove(); await listeners.init();
    for (const id of ['qhjt-entry', 'qhjt-overlay', 'qhjt-panel']) assert.equal(nodes.filter(node => node.id === id && node.isConnected).length, 1);
    await switchChat(undefined, {}); assert.equal(get('qhjt-game').disabled, true);
    await command('action add 无聊天'); assert.equal(game(), undefined);
    assert.equal(JSON.stringify(card), originalCard); assert.equal(JSON.stringify(chat), originalChat);
    assert.equal(JSON.stringify(worldTemplates), templateSnapshot);
    await require('./discovery-check.cjs')(engine, registry,
        modules.get(path.join(root, 'core/world-discovery.js')).namespace,
        modules.get(path.join(root, 'core/discovery-provider.js')).namespace,
        modules.get(path.join(root, 'ui/discovery-session.js')).namespace);
    console.log('PASS: character/user modes, automatic actors, chat following, independent states, NPC inspection, legacy player/active migration, templates, calendar, save rollback, syntax/paths and UI lifecycle.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
