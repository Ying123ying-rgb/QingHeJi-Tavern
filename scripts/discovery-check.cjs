const assert = require('node:assert/strict');
const plain = value => JSON.parse(JSON.stringify(value));
const equal = (a, b) => assert.deepEqual(plain(a), plain(b));

module.exports = async function checkDiscovery(engine, registry, discovery, providers, sessions) {
    const { createState, addActor, readState } = engine;
    const { applyWorldDelta: apply, validateDiscovery: validate, undoLatestDiscovery: undo, worldId, discoveredLocations, actionsAtLocation } = discovery;
    const ctx = { characters: [{ name: '砚绒', avatar: 'a.png' }], characterId: 0, name1: '我' };
    let game = createState(undefined, true);
    const actor = engine.resolveControlledActor(game, ctx);
    const npc = addActor(game, { name: 'NPC', sourceType: 'custom' });
    const player = addActor(game, { name: '我', sourceType: 'user' });
    const baseline = plain(game);
    equal(game.locations, {}); equal(game.discoveryLog, []); assert.equal(actor.locationId, null);
    const locationId = worldId('location', '后山');
    game = apply(game, { locationsToAdd: [{ label: '后山', description: '手动简介' }] });
    equal(baseline.locations, {}); assert.equal(discoveredLocations(game).length, 1);
    assert.equal(game.locations[locationId].visited, false);
    game = apply(game, { locationsToUpdate: [{ id: locationId, resources: [{ label: '柴火' }] }] });
    game = apply(game, { locationsToUpdate: [{ id: locationId, resources: [{ label: '野菜' }] }] });
    assert.equal(game.locations[locationId].resources.length, 2);
    game = apply(game, { locationsToUpdate: [{ id: locationId, resources: [{ label: '柴火' }], capabilities: [{ id: 'spirit_scan', label: '灵识探查' }], services: [{ id: 'starship_repair', label: '飞船维修', type: 'custom' }] }] });
    assert.equal(game.locations[locationId].resources.length, 2);
    const action = registry.addAction(game, '采集');
    game = apply(game, { locationsToUpdate: [{ id: locationId, actions: [action.id] }], actorLocationChanges: [{ actorId: actor.id, locationId }] });
    equal(game.actions[action.id].locationIds, [locationId]); equal(game.locations[locationId].actions, [action.id]);
    assert.equal(game.actors[actor.id].locationId, locationId); assert.equal(game.actors[npc.id].locationId, null); assert.equal(game.actors[player.id].locationId, null);
    assert.equal(actionsAtLocation(game, locationId).length, 1); assert.equal(actionsAtLocation(game, null).length, 0);
    registry.addAction(game, '通用行动'); assert.equal(actionsAtLocation(game, null).length, 1);
    const other = createState(); equal(other.locations, {}); equal(other.actions, {});
    const old = plain(game); delete old.locations; delete old.discoveryLog; delete old.discoveryScan;
    for (const value of Object.values(old.actors)) delete value.locationId;
    const migrated = readState(old); equal(migrated.locations, {}); equal(migrated.discoveryLog, []);
    for (const key of ['actions', 'world', 'calendar', 'controlMode']) equal(migrated[key], old[key]);
    for (const [id, value] of Object.entries(old.actors)) equal(migrated.actors[id], { ...value, locationId: null });
    equal(readState(migrated), migrated);
    let rumor = apply(baseline, { locationsToAdd: [{ id: 'rumor', label: '传闻之地', mentioned: true }] });
    assert.equal(discoveredLocations(rumor).length, 0); assert.equal(rumor.locations.rumor.visited, false);
    rumor = apply(rumor, { locationsToUpdate: [{ id: 'rumor', discovered: true }] }); assert.equal(discoveredLocations(rumor).length, 1);
    const input = (text, current = baseline, role = 'user') => ({ locations: current.locations, actions: current.actions, controlledActor: current.actors[actor.id], messages: [{ role, text }] });
    const extract = (text, current, role) => providers.extractDiscoveryCandidates(input(text, current, role));
    for (const text of ['听说后山危险', '我以后想摆摊', '如果我们来到了后山', '我们没有到达后山', '我们曾经来到了后山', '他告诉我们来到了后山', '我们来到了后山吗？', '“我们来到了后山。”', '我们快要到达后山', '我们想象来到了后山', '这里不允许摆摊赚钱', '这里可以摆摊，如果获得批准', '昨天我们来到了后山', '我们发现了后山的秘密', '他回忆道。我们来到了后山。', '“\n我们来到了后山。\n”', '```text\n我们来到了后山。\n```']) {
        const delta = extract(text); assert.equal(delta.locationsToAdd.length + delta.actionsToAdd.length + delta.actorLocationChanges.length, 0, text);
    }
    const snapshot = plain(baseline);
    const arrived = extract('我们来到了后山');
    const mentionedOnly = extract('我们发现了地点后山');
    assert.equal(mentionedOnly.locationsToAdd[0].visited, false); assert.equal(mentionedOnly.actorLocationChanges.length, 0);
    equal(baseline, snapshot); assert.equal(arrived.locationsToAdd[0].visited, true);
    let auto = apply(baseline, validate(arrived, baseline, { source: 'auto' }), { source: 'auto', timestamp: '2026-09-07T01:00:00Z' });
    assert.equal(auto.actors[actor.id].locationId, locationId); assert.equal(auto.actors[npc.id].locationId, null);
    const candidate = extract('这里允许摆摊赚钱', auto); assert.equal(candidate.actionsToAdd.length, 1);
    auto = apply(auto, candidate, { source: 'auto' });
    assert.equal(Object.keys(auto.actions).length, 1); assert.equal(auto.locations[locationId].capabilities.length, 1);
    const undoneAction = undo(auto); equal(undoneAction.actions, {}); equal(undoneAction.locations[locationId].capabilities, []);
    const undoneLocation = undo(undoneAction); equal(undoneLocation.locations, {}); assert.equal(undoneLocation.actors[actor.id].locationId, null);
    const facts = [{ type: 'resource', label: '自动知识', status: 'fact', confidence: 1, evidence: '明确事实' }];
    const additions = { locationsToUpdate: [{ id: locationId, resources: [{ label: '矿石' }], capabilities: [{ id: 'gather', label: '采集' }], services: [{ label: '住宿' }] }], discoveries: facts };
    let incremental = apply(game, additions, { source: 'auto' });
    incremental = apply(incremental, { locationsToUpdate: [{ id: locationId, resources: [{ label: '手动资源' }] }] });
    const reverted = undo(incremental);
    equal(reverted.locations[locationId].resources.map(item => item.label), ['柴火', '野菜', '手动资源']);
    equal(reverted.locations[locationId].services, game.locations[locationId].services);
    equal(reverted.locations[locationId].capabilities, game.locations[locationId].capabilities);
    assert(reverted.locations[locationId]); assert(reverted.actions[action.id]);
    let protectedGame = apply(baseline, arrived, { source: 'auto' });
    protectedGame = apply(protectedGame, { locationsToUpdate: [{ id: locationId, resources: [{ label: '手动资源' }] }] });
    protectedGame = undo(protectedGame); assert.equal(protectedGame.locations[locationId].resources[0].label, '手动资源');
    let adopted = apply(game, additions, { source: 'auto' });
    adopted = apply(adopted, { locationsToUpdate: [{ id: locationId, resources: [{ label: '矿石' }] }] });
    adopted = undo(adopted); assert(adopted.locations[locationId].resources.some(item => item.label === '矿石'));
    const secondary = apply(baseline, arrived, { source: 'secondary_ai' }); equal(undo(secondary).locations, {});
    const confirmedPosition = apply(secondary, { actorLocationChanges: [{ actorId: actor.id, locationId }] });
    assert.equal(undo(confirmedPosition).actors[actor.id].locationId, locationId);
    const progressive = apply(secondary, extract('这里有资源柴火。这里发现了资源野菜。', secondary), { source: 'auto' });
    equal(progressive.locations[locationId].resources.map(item => item.label), ['柴火', '野菜']);
    const tampered = plain(secondary);
    tampered.discoveryLog[0].undo.patches.push({ path: ['actors', actor.id, 'currency', 'amount'], before: 0, after: game.actors[actor.id].currency.amount });
    assert.throws(() => undo(tampered), /超出世界发现范围/);
    assert.throws(() => undo(game), /没有可撤销/);
    for (const candidate of [
        { currency: { amount: 100 } }, { actorLocationChanges: [{ actorId: actor.id, locationId: 'missing' }] },
        { locationsToUpdate: [{ id: 'missing', description: '' }] }, { actionsToAdd: [{ label: '错误', locationIds: ['missing'] }] },
        { locationsToAdd: [{ id: '__proto__', label: '错误' }] }, { locationsToAdd: [{ label: '错误', resources: {} }] },
        { actorLocationChanges: [{ actorId: actor.id, locationId, stats: [] }] },
        JSON.parse('{"locationsToAdd":[{"label":"bad","metadata":{"__proto__":{"polluted":true}}}]}'),
    ]) assert.throws(() => apply(game, candidate));
    assert.throws(() => apply(game, { locationsToAdd: [{ label: '无证据' }] }, { source: 'auto' }));
    assert.equal({}.polluted, undefined);
    for (const value of [auto, progressive, reverted, protectedGame]) for (const id of Object.keys(baseline.actors)) {
        for (const key of ['currency', 'inventory', 'skills', 'stats']) equal(value.actors[id][key], baseline.actors[id][key]);
    }
    const customProvider = { extractDiscoveryCandidates(value) { value.locations.injected = {}; return discovery.emptyWorldDelta(); } };
    const providerInput = input('事实', game); const original = plain(providerInput);
    await providers.extractDiscoveryCandidates(providerInput, customProvider); equal(providerInput, original);

    let metadata = {}, chat = [], chatId = 'A', running = false, scans = 0, errors = 0;
    const host = () => ({ chatMetadata: metadata, chat, chatId });
    const session = sessions.createDiscoverySession({ context: host, identity: ctx => ({ key: ctx.chatId }),
        read: () => metadata, enabled: () => true, busy: () => running,
        scan: async item => { scans++; metadata.discoveryScan = { lastTurnId: item.turnId }; }, onError: () => { errors++; } });
    const finish = async () => { session.received(chat.length - 1); await session.end(); };
    session.start('normal'); chat.push({ is_user: true, mes: '我们来到了后山' }, { is_user: false, mes: '我们来到了后山。' }); await finish(); assert.equal(scans, 1);
    await session.end(); assert.equal(scans, 1);
    session.start('normal'); chat.push({ is_user: false, mes: '重复回答' }); await finish(); assert.equal(scans, 1);
    session.start('swipe'); chat.push({ is_user: false, mes: '重生成' }); await finish(); assert.equal(scans, 1);
    session.start('normal'); chat.push({ is_user: true, mes: '新一轮' }, { is_user: false, mes: '未完成' }); session.cancel(); await finish(); assert.equal(scans, 1);
    session.start('normal'); chat.push({ is_user: true, mes: '新一轮' }, { is_user: false, mes: '结束' }); running = true; await finish(); assert.equal(scans, 1);
    running = false; await session.flush(); assert.equal(scans, 2);
    session.start('normal'); chat.push({ is_user: true, mes: '新一轮' }, { is_user: false, mes: '结束' }); metadata = {}; chatId = 'B'; await finish(); assert.equal(scans, 2);
    session.start('normal'); chat.push({ is_user: true, mes: '新一轮' }, { is_user: false, mes: '结束' }); session.received(chat.length - 1); const ending = session.end(); session.cancel(); await ending; assert.equal(scans, 2);
    session.start('normal'); chat.push({ is_user: true, mes: '流式一轮' }, { is_user: false, mes: '结束后再发接收事件' });
    await session.end(); assert.equal(scans, 2); await session.received(chat.length - 1); assert.equal(scans, 3);
    await session.received(chat.length - 1); await session.end(); assert.equal(scans, 3);
    assert.equal(errors, 0);
    console.log('PASS: location isolation, incremental knowledge, custom capabilities/services, actor positions, action links/filter, conservative discovery, provider purity, delta validation, selective undo/manual protection, migration and once-per-round scan lifecycle.');
};
