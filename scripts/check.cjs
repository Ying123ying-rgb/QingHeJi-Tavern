/* Local checks with a deliberately small DOM/Context mock, not a real ST test. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// Use Node's actual ES module parser/linker, including relative import resolution.
// This flag is only for the local test runner, never needed by the browser.
if (!vm.SourceTextModule) {
    const { spawnSync } = require('node:child_process');
    const result = spawnSync(process.execPath, ['--experimental-vm-modules', __filename], { stdio: 'inherit' });
    process.exit(result.status ?? 1);
}
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
assert.equal(manifest.display_name, '酒馆人生模拟器');
assert.equal(manifest.version, '0.1.1');
assert.equal(manifest.minimum_client_version, '1.18.0');
assert.equal(typeof manifest.loading_order, 'number');
for (const key of ['js', 'css']) {
    assert(!path.isAbsolute(manifest[key]) && !manifest[key].includes('..'));
    assert(fs.statSync(path.join(root, manifest[key])).isFile());
}
const source = fs.readFileSync(path.join(root, manifest.js), 'utf8');
assert(!/\b(?:fetch|XMLHttpRequest|generateRaw|generateQuietPrompt|sendSystemMessage|writeExtensionField|saveWorldInfo)\s*\(/.test(source));
assert(!/game\.(?:money|stamina|satiety)|ancient_rural|modern_city|sci_fi/.test(source));
const css = fs.readFileSync(path.join(root, manifest.css), 'utf8');
assert(!/url\s*\(|@import/.test(css));

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
const shell = create('div');
const chat = create('div'); chat.id = 'chat'; shell.append(chat);
const get = id => nodes.find(node => node.id === id);
const listeners = {};
const key = 'qingheji_tavern';
let metadata = {};
let chatId = 'A';
let saves = 0;
let settingSaves = 0;
let save = async () => { saves++; };
let confirmation = true;
let confirmations = 0;
let onConfirm = () => {};
const extensionSettings = {};
const ctx = () => ({
    characterId: 0, characters: [{ name: '<img src=x onerror=alert(1)>', avatar: 'a.png' }], chatId,
    chatMetadata: metadata, extensionSettings,
    saveMetadata: () => save(), saveSettingsDebounced: () => { settingSaves++; },
    eventTypes: { APP_INITIALIZED: 'init', CHAT_CHANGED: 'chat' },
    eventSource: { on: (name, callback) => { listeners[name] = callback; } },
});
const sandbox = vm.createContext({
    SillyTavern: { getContext: ctx },
    document: { createElement: create, getElementById: get },
    console: { error() {} },
    confirm: message => {
        assert.equal(message, '切换世界模板将重置当前聊天的模拟游戏初始状态，但不会修改角色卡、聊天记录或其他聊天存档。');
        confirmations++;
        onConfirm();
        return confirmation;
    },
});
const modules = new Map();
function load(file) {
    assert(file.startsWith(root + path.sep), 'Imports must remain inside the extension');
    if (!modules.has(file)) {
        const code = fs.readFileSync(file, 'utf8');
        assert(!/\b(?:fetch|XMLHttpRequest|generateRaw|generateQuietPrompt|sendSystemMessage|writeExtensionField|saveWorldInfo)\s*\(/.test(code));
        modules.set(file, new vm.SourceTextModule(code, { context: sandbox, identifier: file }));
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
    const { createState, readState, isLegacyState } = modules.get(path.join(root, 'core/game-state.js')).namespace;
    const { worldTemplates } = modules.get(path.join(root, 'data/world-templates.js')).namespace;
    assert.equal(worldTemplates.length, 3);
    const snapshots = JSON.stringify(worldTemplates);
    for (const template of worldTemplates) {
        const fresh = createState(template.id);
        assert.equal(fresh.enabled, false);
        assert.equal(fresh.world.templateId, template.id);
        assert.equal(fresh.world.templateVersion, 1);
        for (const slot of ['inventory', 'relationships', 'skills', 'worldState']) assert.equal(Object.keys(fresh[slot]).length, 0);
        for (const slot of ['locations', 'items', 'shops', 'actions', 'recipes', 'events', 'rules', 'aiContext']) assert(Object.hasOwn(template, slot));
        fresh.currency.amount = -1;
        fresh.stats[0].value = -1;
        assert.notEqual(createState(template.id).currency.amount, -1);
        assert.notEqual(createState(template.id).stats[0].value, -1);
    }
    assert.equal(JSON.stringify(worldTemplates), snapshots);
    await listeners.init();
    await listeners.init();
    assert.equal(nodes.filter(node => node.id === 'qhjt-settings').length, 1);
    const game = get('qhjt-game');
    const master = get('qhjt-master');
    const host = get('qhjt-host');
    const world = get('qhjt-world');
    const choose = async id => { world.value = id; await world.events.change(); };
    const panelRows = () => {
        host.children[0].events.click();
        const children = get('qhjt-panel').children[1].children;
        const rows = {};
        for (let i = 0; i < children.length; i += 2) rows[children[i].textContent] = children[i + 1].textContent;
        return rows;
    };
    assert.equal(game.checked, false);
    assert.equal(game.disabled, false); // characterId 0 is valid
    assert.equal(host.hidden, true);
    assert.equal(saves, 0);
    game.checked = true;
    await game.events.change();
    const a = metadata;
    assert.equal(a[key].enabled, true);
    assert.equal(a[key].currency.amount, 100);
    assert.equal(world.value, 'ancient_rural');
    assert.equal(panelRows()['铜钱'], '100');
    assert.equal(panelRows()['体力'], '100/100');
    assert.equal(panelRows()['饱腹'], '100/100');
    assert.equal(host.hidden, false);
    host.children[0].events.click();
    const panel = get('qhjt-panel');
    assert.equal(panel.hidden, false);
    assert.equal(panel.children[1].children[1].textContent, '<img src=x onerror=alert(1)>');
    panel.children[0].children[1].events.click();
    assert.equal(panel.hidden, true);
    chatId = 'B'; metadata = {}; listeners.chat();
    assert.equal(game.checked, false);
    assert.equal(host.hidden, true);
    game.checked = true; await game.events.change();
    assert.notEqual(metadata[key], a[key]);
    await choose('modern_city');
    const b = metadata;
    assert.equal(b[key].enabled, true);
    assert.equal(b[key].world.templateId, 'modern_city');
    const modern = panelRows();
    assert.equal(modern['世界'], '现代都市');
    assert.equal(modern['余额'], '¥1000');
    assert.equal(modern['精力'], '100/100');
    assert.equal(modern['心情'], '80/100');
    assert.equal(modern['日期'], '9月6日');
    assert.equal(modern['时间'], '08:00');
    metadata[key].currency.amount = 42;
    chatId = 'A'; metadata = a; listeners.chat();
    assert.equal(metadata[key].currency.amount, 100);
    assert.equal(a[key].world.templateId, 'ancient_rural');
    assert.equal(world.value, 'ancient_rural');
    const unchanged = JSON.stringify(a);
    confirmation = false;
    await choose('sci_fi');
    assert.equal(JSON.stringify(a), unchanged);
    assert.equal(world.value, 'ancient_rural');
    confirmation = true;
    a[key].inventory = { future: 1 };
    await choose('sci_fi');
    assert.equal(a[key].enabled, true);
    assert.equal(Object.keys(a[key].inventory).length, 0);
    assert.equal(b[key].world.templateId, 'modern_city');
    assert.equal(b[key].currency.amount, 42);
    const space = panelRows();
    assert.equal(space['世界'], '星际时代');
    assert.equal(space['信用点'], '3000');
    for (const label of ['行动力', '氧气', '舰船能源']) assert.equal(space[label], '100/100');
    assert.equal(space['日期'], '星历2387-104');
    assert.equal(space['时间'], '舰时08:00');
    a[key].stats.push({ id: 'custom_stat', label: '任意新增的很长状态名称', value: 7, max: 9 });
    assert.equal(panelRows()['任意新增的很长状态名称'], '7/9');
    master.checked = false; master.events.change();
    assert.equal(host.hidden, true);
    assert.equal(a[key].enabled, true);
    master.checked = true; master.events.change();
    assert.equal(host.hidden, false);
    assert.equal(settingSaves, 2);
    a[key].inventory = { future: true };
    game.checked = false; await game.events.change();
    assert.equal(a[key].inventory.future, true);
    await choose('modern_city');
    assert.equal(a[key].enabled, false);
    save = async () => { throw new Error('Simulated failure'); };
    const beforeFailedSwitch = JSON.stringify(a);
    await choose('sci_fi');
    assert.equal(JSON.stringify(a), beforeFailedSwitch);
    assert.equal(world.value, 'modern_city');
    game.checked = true; await game.events.change();
    assert.equal(a[key].enabled, false);
    let finish;
    save = () => new Promise(resolve => { finish = resolve; });
    game.checked = true;
    const pending = game.events.change();
    chatId = 'C'; metadata = {}; listeners.chat();
    finish(); await pending;
    assert.equal(metadata[key], undefined);
    assert.equal(game.checked, false);
    assert.equal(host.hidden, true);
    save = async () => { saves++; };
    const legacy = {
        schemaVersion: 1, enabled: true, money: 0, date: '四月初二', time: '午时',
        stamina: { current: 37, max: 120 }, satiety: { current: 0, max: 90 },
        inventory: { preserved: true }, futureField: { keep: 1 },
    };
    const original = JSON.stringify(legacy);
    assert(isLegacyState(legacy));
    assert.equal(readState(legacy).world.templateId, 'ancient_rural');
    assert.equal(JSON.stringify(legacy), original);
    chatId = 'legacy'; metadata = { [key]: legacy, unrelated: 'keep' };
    const beforeMigration = saves;
    await listeners.chat();
    const migrated = metadata[key];
    assert.equal(saves, beforeMigration + 1);
    assert.equal(migrated.schemaVersion, 2);
    assert.equal(migrated.enabled, true);
    assert.equal(migrated.world.templateId, 'ancient_rural');
    assert.equal(migrated.currency.amount, 0);
    assert.equal(migrated.calendar.date, '四月初二');
    assert.equal(migrated.calendar.time, '午时');
    assert.equal(migrated.stats.find(stat => stat.id === 'stamina').value, 37);
    assert.equal(migrated.stats.find(stat => stat.id === 'stamina').max, 120);
    assert.equal(migrated.stats.find(stat => stat.id === 'satiety').value, 0);
    assert.equal(migrated.inventory.preserved, true);
    assert.equal(migrated.futureField.keep, 1);
    assert.equal(metadata.unrelated, 'keep');
    assert(!Object.hasOwn(migrated, 'money'));
    await listeners.chat();
    assert.equal(saves, beforeMigration + 1); // idempotent
    assert.deepEqual(JSON.parse(JSON.stringify(readState(migrated))), JSON.parse(JSON.stringify(migrated)));
    // Simulate reloading server-serialized metadata, with no shared object references.
    metadata = JSON.parse(JSON.stringify(metadata));
    await listeners.chat();
    assert.equal(world.value, 'ancient_rural');
    assert.equal(panelRows()['体力'], '37/120');
    // A pending save must not prevent the newly selected legacy chat migrating.
    let releaseSave;
    save = () => new Promise(resolve => { releaseSave = resolve; });
    game.checked = false;
    const savingOldChat = game.events.change();
    chatId = 'queued-legacy'; metadata = { [key]: JSON.parse(original) };
    await listeners.chat();
    save = async () => { saves++; };
    releaseSave(); await savingOldChat;
    assert.equal(metadata[key].world.templateId, 'ancient_rural');
    assert.equal(metadata[key].enabled, true);
    assert.equal(metadata[key].currency.amount, 0);
    // Failure retains the exact old save and does not loop on refresh/events.
    metadata = { [key]: JSON.parse(original) }; chatId = 'failed-legacy';
    const oldObject = metadata[key];
    let attempts = 0;
    save = async () => { attempts++; throw new Error('offline'); };
    await listeners.chat(); await listeners.chat();
    assert.equal(metadata[key], oldObject);
    assert.equal(attempts, 1);
    assert.equal(panelRows()['铜钱'], '0');
    // Stale selector event and a chat transition during confirmation cannot reset another chat.
    save = async () => { saves++; };
    chatId = 'stale'; metadata = {};
    await choose('sci_fi');
    assert.equal(metadata[key], undefined);
    await listeners.chat();
    onConfirm = () => { chatId = 'after-confirm'; metadata = {}; listeners.chat(); };
    await choose('modern_city');
    assert.equal(metadata[key], undefined);
    onConfirm = () => {};
    assert(confirmations >= 6);
    assert.equal(JSON.stringify(worldTemplates), snapshots);
    chatId = undefined; listeners.chat();
    assert.equal(game.disabled, true);
    assert.equal(world.disabled, true);
    console.log('PASS: all 3 world templates and dynamic panels; independent chats; confirmed/cancelled/failed resets; v0.1 migration and retry safety; generic extra stats; manifest, ES module syntax and relative imports. Mock tests only, not Android validation.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
