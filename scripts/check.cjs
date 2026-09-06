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
assert.equal(manifest.version, '0.3.0');
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
    AbortController, URL, setTimeout, clearTimeout, innerHeight: 740, innerWidth: 320, addEventListener: windowEvents.addEventListener.bind(windowEvents),
    console: { error() {} }, toastr: { info: message => notices.push(message) },
    confirm: message => { confirmations.push(message); onConfirm(); return confirmed; },
    prompt: () => { onPrompt(); return prompted; },
});
const modules = new Map();
function load(file) {
    assert(file.startsWith(root + path.sep));
    if (!modules.has(file)) {
        const source = fs.readFileSync(file, 'utf8');
        assert(!/\b(?:XMLHttpRequest|generateRaw|generateQuietPrompt|sendSystemMessage|writeExtensionField|saveWorldInfo|openCharacterChat|selectCharacterById)\s*\(/.test(source));
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
    await require('./ui-check.cjs')({ get, listeners, ctx, engine, modules, root, nodes, body, windowEvents,
        setChat: (id, data) => { chatId=id; metadata=data; }, game: () => metadata[KEY],
        setSave: fn => { save=fn; }, commands, notices, extensionSettings });
    const registry = modules.get(path.join(root, 'core/actions.js')).namespace;
    await require('./discovery-check.cjs')(engine, registry,
        modules.get(path.join(root, 'core/world-discovery.js')).namespace,
        modules.get(path.join(root, 'core/discovery-provider.js')).namespace,
        modules.get(path.join(root, 'ui/discovery-session.js')).namespace);
    await require('./semantic-check.cjs')(engine,
        modules.get(path.join(root, 'core/semantic-state.js')).namespace,
        modules.get(path.join(root, 'core/local-semantic.js')).namespace,
        modules.get(path.join(root, 'core/secondary-api.js')).namespace,
        modules.get(path.join(root, 'core/semantic-scan.js')).namespace);
    assert.equal(JSON.stringify(card), originalCard); assert.equal(JSON.stringify(chat), originalChat);
    assert.equal(JSON.stringify(worldTemplates), templateSnapshot);
    console.log('PASS: character/user modes, automatic actors, chat following, independent states, NPC inspection, legacy player/active migration, templates, calendar, save rollback, syntax/paths and UI lifecycle.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
