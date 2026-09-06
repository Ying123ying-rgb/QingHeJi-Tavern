/* Local checks with a deliberately small DOM/Context mock, not a real ST test. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
assert.equal(manifest.display_name, '青禾记 Tavern');
assert.equal(manifest.version, '0.1.0');
assert.equal(manifest.minimum_client_version, '1.18.0');
assert.equal(typeof manifest.loading_order, 'number');
for (const key of ['js', 'css']) {
    assert(!path.isAbsolute(manifest[key]) && !manifest[key].includes('..'));
    assert(fs.statSync(path.join(root, manifest[key])).isFile());
}
const source = fs.readFileSync(path.join(root, manifest.js), 'utf8');
new vm.Script(source);
assert(!/\b(?:fetch|XMLHttpRequest|generateRaw|generateQuietPrompt|sendSystemMessage|writeExtensionField|saveWorldInfo)\s*\(/.test(source));
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
const extensionSettings = {};
const ctx = () => ({
    characterId: 0, characters: [{ name: '<img src=x onerror=alert(1)>', avatar: 'a.png' }], chatId,
    chatMetadata: metadata, extensionSettings,
    saveMetadata: () => save(), saveSettingsDebounced: () => { settingSaves++; },
    eventTypes: { APP_INITIALIZED: 'init', CHAT_CHANGED: 'chat' },
    eventSource: { on: (name, callback) => { listeners[name] = callback; } },
});
vm.runInNewContext(source, {
    SillyTavern: { getContext: ctx },
    document: { createElement: create, getElementById: get },
    console: { error() {} },
});
async function run() {
    listeners.init();
    listeners.init();
    assert.equal(nodes.filter(node => node.id === 'qhjt-settings').length, 1);
    const game = get('qhjt-game');
    const master = get('qhjt-master');
    const host = get('qhjt-host');
    assert.equal(game.checked, false);
    assert.equal(game.disabled, false); // characterId 0 is valid
    assert.equal(host.hidden, true);
    assert.equal(saves, 0);
    game.checked = true;
    await game.events.change();
    const a = metadata;
    assert.equal(a[key].enabled, true);
    assert.equal(a[key].money, 100);
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
    metadata[key].money = 42;
    chatId = 'A'; metadata = a; listeners.chat();
    assert.equal(metadata[key].money, 100);
    master.checked = false; master.events.change();
    assert.equal(host.hidden, true);
    assert.equal(a[key].enabled, true);
    master.checked = true; master.events.change();
    assert.equal(host.hidden, false);
    assert.equal(settingSaves, 2);
    a[key].inventory = { future: true };
    game.checked = false; await game.events.change();
    assert.equal(a[key].inventory.future, true);
    save = async () => { throw new Error('Simulated failure'); };
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
    chatId = undefined; listeners.chat();
    assert.equal(game.disabled, true);
    console.log('PASS: manifest, paths, syntax, prohibited calls, mocked UI/chat isolation/save failure/chat switch. Not a real SillyTavern test.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
