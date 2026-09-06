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
assert.equal(manifest.version, '0.1.2');
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
    constructor(tag) { this.tag = tag; this.children = []; this.events = {}; this.attributes = {}; this.hidden = false; }
    append(...nodes) { this.children.push(...nodes); nodes.forEach(node => { node.parentElement = this; }); }
    after(node) { this.parentElement.append(node); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(name, handler) { this.events[name] = handler; }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    focus() {}
}
const nodes = [];
const create = tag => { const node = new Node(tag); nodes.push(node); return node; };
const settings = create('div'); settings.id = 'extensions_settings2';
const shell = create('div'); const chatNode = create('div'); chatNode.id = 'chat'; shell.append(chatNode);
const get = id => nodes.find(node => node.id === id);
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
const ctx = () => ({ characterId, characters, groupId, name1: '玩家名称', chatId, chat, chatMetadata: metadata,
    extensionSettings, saveMetadata: () => save(), saveSettingsDebounced: () => { settingSaves++; },
    eventTypes: { APP_INITIALIZED: 'init', CHAT_CHANGED: 'chat' },
    eventSource: { on: (name, handler) => { listeners[name] = handler; } },
});
const sandbox = vm.createContext({ SillyTavern: { getContext: ctx }, document: { createElement: create, getElementById: get },
    console: { error() {} },
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
    const { createState, createActor, addActor, selectActor, deleteActor, changeCurrency, resetWorld, readState, needsMigration } = engine;
    const { currentCharacter, currentUser } = modules.get(path.join(root, 'core/actor-sources.js')).namespace;
    const { worldTemplates } = modules.get(path.join(root, 'data/world-templates.js')).namespace;
    const templateSnapshot = JSON.stringify(worldTemplates);
    assert.equal(worldTemplates.length, 3);
    assert.equal(currentCharacter(ctx()).sourceId, 'yanrong.png');
    assert.equal(currentUser({}).name, '我');
    assert.equal(currentUser(ctx()).name, '玩家名称');
    for (const template of worldTemplates) {
        const world = createState(template.id);
        assert.equal(world.activeActorId, null);
        const a = addActor(world, currentCharacter(ctx()));
        const b = addActor(world, currentUser(ctx()));
        const c = addActor(world, { name: '洛冉', sourceType: 'custom' });
        assert.equal(Object.keys(world.actors).length, 3);
        equal(a.currency, template.currency); equal(a.stats, template.stats);
        assert.notEqual(a.currency, b.currency); assert.notEqual(a.stats, b.stats); assert.notEqual(a.stats[0], b.stats[0]);
        assert.notEqual(a.inventory, c.inventory); assert.notEqual(a.needs, c.needs);
        const calendar = plain(world.calendar);
        changeCurrency(world, 100); a.stats[0].value = 7;
        assert.equal(b.currency.amount, template.currency.amount); assert.equal(b.stats[0].value, 100);
        selectActor(world, b.id); equal(world.calendar, calendar);
        assert.equal(world.activeActorId, b.id);
        assert.equal(addActor(world, currentCharacter(ctx())), null);
        characters = [null, card]; characterId = 1;
        assert.equal(addActor(world, currentCharacter(ctx())), null); // index reordering cannot duplicate a card
        characters = [card]; characterId = 0;
        const reset = resetWorld(world, 'sci_fi');
        equal(Object.keys(reset.actors), Object.keys(world.actors));
        assert.equal(reset.activeActorId, b.id);
        for (const actor of Object.values(reset.actors)) {
            assert.equal(actor.currency.amount, 3000); assert.equal(actor.name, world.actors[actor.id].name);
            equal(actor.stats, worldTemplates[2].stats);
        }
        deleteActor(reset, b.id); assert.equal(reset.activeActorId, a.id);
        deleteActor(reset, a.id); deleteActor(reset, c.id); assert.equal(reset.activeActorId, null);
        assert.equal(changeCurrency(reset, 100), false);
    }
    assert.equal(JSON.stringify(worldTemplates), templateSnapshot);
    await listeners.init(); await listeners.init();
    assert.equal(nodes.filter(node => node.id === 'qhjt-settings').length, 1);
    const click = async id => { assert(!get(id).disabled, id); await get(id).events.click(); };
    const choose = async (id, value) => { get(id).value = value; await get(id).events.change(); };
    const game = () => metadata[KEY];
    const switchChat = async (id, data) => { chatId = id; metadata = data; await listeners.chat(); };
    const rowValues = id => {
        const children = get(id).children; const result = {};
        for (let i = 0; i < children.length; i += 2) result[children[i].textContent] = children[i + 1].textContent;
        return result;
    };
    assert.equal(saves, 0); assert.equal(get('qhjt-game').checked, false);
    get('qhjt-game').checked = true; await get('qhjt-game').events.change();
    get('qhjt-host').children[0].events.click();
    assert.equal(get('qhjt-panel').hidden, false);
    assert.equal(rowValues('qhjt-summary')['当前主角'], '尚未添加人物');
    assert.equal(get('qhjt-plus').disabled, true);
    await choose('qhjt-world', 'modern_city');
    await click('qhjt-add-character'); await click('qhjt-add-user'); await click('qhjt-add-custom');
    const ids = Object.keys(game().actors); assert.equal(ids.length, 3);
    assert.equal(game().actors[ids[1]].sourceType, 'user');
    const sharedCalendar = plain(game().calendar);
    await click('qhjt-plus'); assert.equal(game().actors[ids[0]].currency.amount, 1100);
    await choose('qhjt-active', ids[1]);
    assert.equal(game().actors[ids[1]].currency.amount, 1000);
    assert.equal(rowValues('qhjt-summary')['当前主角'], '玩家名称');
    assert.equal(rowValues('qhjt-summary')['当前角色卡'], '<砚绒>');
    assert.equal(rowValues('qhjt-actor-values')['余额'], '¥1000');
    equal(game().calendar, sharedCalendar); assert.equal(chatId, 'A');
    await choose('qhjt-active', ids[0]);
    assert.equal(rowValues('qhjt-actor-values')['余额'], '¥1100');
    await click('qhjt-minus'); assert.equal(game().actors[ids[0]].currency.amount, 1000);
    await click('qhjt-add-character'); assert.equal(Object.keys(game().actors).length, 3);
    // Only player display name is editable; the host's name1 and card remain untouched.
    prompted = '我自己';
    await get('qhjt-actors').children[1].children[2].children[2].events.click();
    assert.equal(game().actors[ids[1]].name, '我自己'); assert.equal(ctx().name1, '玩家名称');
    prompted = null; await click('qhjt-add-custom');
    prompted = '   '; await click('qhjt-add-custom'); assert.equal(Object.keys(game().actors).length, 3);
    const aChat = metadata;
    await switchChat('B', {});
    await choose('qhjt-world', 'sci_fi'); await click('qhjt-add-user');
    const bChat = metadata;
    await switchChat('A', aChat); assert.equal(game().world.templateId, 'modern_city');
    confirmed = false;
    const beforeReset = plain(game()); await choose('qhjt-world', 'ancient_rural'); equal(game(), beforeReset);
    confirmed = true; await choose('qhjt-world', 'ancient_rural');
    assert.equal(confirmations.at(-1), '切换世界模板将重置本聊天的世界状态以及所有人物的模拟状态，但不会修改角色卡或聊天记录。');
    equal(Object.keys(game().actors), ids); assert.equal(game().activeActorId, ids[0]);
    assert.equal(game().actors[ids[1]].name, '我自己');
    for (const actor of Object.values(game().actors)) { assert.equal(actor.currency.amount, 100); assert.equal(actor.stats[0].label, '体力'); }
    assert.equal(bChat[KEY].actors.actor_1.currency.amount, 3000);
    get('qhjt-host').children[0].events.click();
    assert.equal(rowValues('qhjt-world-values')['日期'], '三月初一');
    assert.equal(rowValues('qhjt-actor-values')['铜钱'], '100');
    const beforeFailure = plain(game()); save = async () => { throw new Error('offline'); };
    await click('qhjt-plus'); equal(game(), beforeFailure);
    await choose('qhjt-world', 'modern_city'); equal(game(), beforeFailure);
    save = async () => { saves++; };
    confirmed = false; await get('qhjt-actors').children[0].children[2].children[1].events.click(); equal(game(), beforeFailure);
    confirmed = true; await get('qhjt-actors').children[0].children[2].children[1].events.click();
    assert.equal(game().activeActorId, ids[1]);
    while (Object.keys(game().actors).length) await get('qhjt-actors').children[0].children[2].children[1].events.click();
    assert.equal(game().activeActorId, null); assert.equal(get('qhjt-plus').disabled, true);
    // Both historical formats retain exact balances, calendar and stats, including zero.
    const legacy01 = { schemaVersion: 1, enabled: true, money: 0, date: '四月初二', time: '午时',
        stamina: { current: 37, max: 120 }, satiety: { current: 0, max: 90 }, inventory: { saved: true } };
    const legacy011 = { schemaVersion: 2, enabled: true, world: { templateId: 'modern_city', templateVersion: 1 },
        calendar: { dateLabel: '日期', date: '12月31日', timeLabel: '时间', time: '23:59' }, worldState: { weather: 'rain' },
        currency: { id: 'money', label: '余额', symbol: '¥', amount: 5123 },
        stats: [{ id: 'energy', label: '精力', value: 31, max: 120 }], skills: { old: 3 }, relationships: { friend: 5 } };
    for (const [id, old] of [['legacy01', legacy01], ['legacy011', legacy011]]) {
        const snapshot = JSON.stringify(old); assert(needsMigration(old));
        const fallback = readState(old); assert.equal(fallback.actors.actor_1.name, '默认主角');
        const before = saves; await switchChat(id, { [KEY]: plain(old), unrelated: 'keep' });
        assert.equal(saves, before + 1); assert.equal(game().schemaVersion, 3);
        assert.equal(game().actors.actor_1.name, '<砚绒>'); assert.equal(game().activeActorId, 'actor_1');
        assert.equal(metadata.unrelated, 'keep'); assert.equal(JSON.stringify(old), snapshot);
        assert(!Object.hasOwn(game(), 'currency')); assert(!Object.hasOwn(game(), 'stats'));
        const migrated = game().actors.actor_1;
        if (id === 'legacy01') {
            assert.equal(migrated.currency.amount, 0); assert.equal(migrated.stats[0].value, 37);
            assert.equal(migrated.stats[1].value, 0); assert.equal(migrated.stats[0].max, 120);
            assert.equal(game().calendar.date, old.date); assert.equal(game().calendar.time, old.time);
            assert.equal(migrated.inventory.saved, true);
        } else {
            equal(migrated.currency, old.currency); equal(migrated.stats, old.stats);
            equal(game().calendar, old.calendar); equal(game().worldState, old.worldState);
            equal(migrated.skills, old.skills); equal(migrated.relationships, old.relationships);
        }
        await listeners.chat(); assert.equal(saves, before + 1); equal(readState(game()), game());
        await switchChat(id, plain(metadata)); assert.equal(saves, before + 1);
    }
    // Failed migration retains the old object and does not loop.
    save = async () => { throw new Error('offline'); };
    const failed = { [KEY]: plain(legacy01) }; const oldObject = failed[KEY];
    await switchChat('failed', failed); assert.equal(metadata[KEY], oldObject);
    await listeners.chat(); assert.equal(metadata[KEY], oldObject);
    save = async () => { saves++; };
    characterId = undefined; groupId = 'group';
    await switchChat('group-legacy', { [KEY]: plain(legacy011) });
    assert.equal(game().actors.actor_1.name, '默认主角'); assert.equal(get('qhjt-add-character').disabled, true);
    await click('qhjt-add-user'); assert.equal(Object.keys(game().actors).length, 2);
    characterId = 0; groupId = undefined;
    // Pending save, stale prompt, stale list button: none can edit another chat.
    await switchChat('A', aChat); await click('qhjt-add-character');
    let finish; save = () => new Promise(resolve => { finish = resolve; });
    const pending = get('qhjt-plus').events.click();
    await switchChat('B', bChat); const untouched = plain(bChat);
    save = async () => { saves++; }; finish(); await pending; equal(bChat, untouched);
    // A legacy chat selected while another save is pending still migrates afterwards.
    save = () => new Promise(resolve => { finish = resolve; });
    const queued = get('qhjt-plus').events.click();
    await switchChat('queued-legacy', { [KEY]: plain(legacy011) });
    save = async () => { saves++; }; finish(); await queued;
    assert.equal(game().actors.actor_1.currency.amount, 5123);
    assert.equal(game().calendar.time, '23:59');
    // Confirming a deletion after a chat transition cannot remove the new chat's actor_1.
    const beforeOtherDelete = plain(bChat);
    onConfirm = () => { chatId = 'B'; metadata = bChat; listeners.chat(); };
    await get('qhjt-actors').children[0].children[2].children[1].events.click();
    equal(bChat, beforeOtherDelete); onConfirm = () => {};
    const staleButton = get('qhjt-actors').children[0].children[2].children[1];
    await switchChat('empty', {}); await staleButton.events.click(); assert.equal(game(), undefined);
    prompted = '不应添加'; onPrompt = () => { chatId = 'other'; metadata = {}; listeners.chat(); };
    await click('qhjt-add-custom'); assert.equal(game(), undefined); onPrompt = () => {};
    get('qhjt-master').checked = false; await get('qhjt-master').events.change();
    assert.equal(get('qhjt-host').hidden, true); assert.equal(get('qhjt-add-user').disabled, true); assert.equal(settingSaves, 1);
    get('qhjt-master').checked = true; await get('qhjt-master').events.change();
    await switchChat(undefined, {}); assert.equal(get('qhjt-game').disabled, true);
    assert.equal(JSON.stringify(card), originalCard); assert.equal(JSON.stringify(chat), originalChat);
    assert.equal(JSON.stringify(worldTemplates), templateSnapshot);
    console.log('PASS: 3-template actors, currency/stats isolation, protagonist/calendar separation, actor CRUD, world reset, both migrations, chat isolation, rollback, stale actions, unchanged cards/chat, manifest and module syntax/paths. Mock checks only.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
