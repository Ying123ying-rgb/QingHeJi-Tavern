const assert = require('node:assert/strict');
const plain = value => JSON.parse(JSON.stringify(value));
module.exports = async function (engine, semantic, local, api, planner) {
    const ctx = { characters: [{ name: '田园生活', avatar: 'world.png' }], characterId: 0, name1: '玩家' };
    let game = engine.createState(undefined, true); const actor = engine.resolveControlledActor(game, ctx);
    const provider = new local.LocalSemanticProvider();
    const messages = texts => semantic.prepareMessages(texts.map((mes, i) => ({ mes, is_user: i % 2 === 0, send_date: `date_${i}_${mes}` })));
    const input = (game, texts) => planner.semanticInput(game, ctx, messages(texts), game.actors[actor.id]);
    const apply = (game, raw, context, options) => semantic.applyValidatedDelta(game, semantic.validateSemanticDelta(raw, game, context, options));
    let context = input(game, ['在后山转了转，收集了点东西。', '你继续往前走。']);
    let raw = provider.extractDiscoveryCandidates(context);
    game = apply(game, raw, context); assert(Object.values(game.locations).some(item => item.label === '后山' && item.visited));
    assert(game.actors[actor.id].locationId); assert.equal(Object.keys(game.inventory).length, 0);
    assert.equal(Object.keys(game.npcs).length, 0);
    for (const phrase of ['听说后山有狼。', '明天想去后山。']) {
        const fresh = engine.createState(undefined, true); fresh.actors[actor.id] = plain(actor);
        const data = input(fresh, [phrase, '你继续思考。']); const value = apply(fresh, provider.extractDiscoveryCandidates(data), data);
        assert.equal(Object.values(value.locations).filter(item => item.visited).length, 0);
    }
    context = input(game, ['清点物资：糙米 ×5，粗面 ×3，柴火 ×8，清水 ×4', '这些就是现有物资。']);
    raw = provider.extractDiscoveryCandidates(context); game = apply(game, raw, context);
    assert.equal(Object.keys(game.inventory).length, 4); assert.equal(Object.values(game.inventory).find(item => item.label === '柴火').quantity, 8);
    const snapshot = JSON.stringify(game); game = apply(game, raw, context); assert.equal(JSON.stringify(game.inventory), JSON.stringify(JSON.parse(snapshot).inventory));
    const preview = apply(game, raw, context, { reanalyze: true }); assert(preview.pendingDiscoveries.length); assert.deepEqual(plain(preview.inventory), plain(game.inventory));
    context = input(game, ['捡了一些野菜。', '你收好了。']); game = apply(game, provider.extractDiscoveryCandidates(context), context);
    assert.equal(Object.values(game.inventory).find(item => item.label === '野菜').quantityKnown, false);
    context = input(game, ['共捡到8份野菜。', '你收好了。']); game = apply(game, provider.extractDiscoveryCandidates(context), context);
    assert.equal(Object.values(game.inventory).find(item => item.label === '野菜').quantity, 8);
    const ref = (context, evidence, index = 0) => ({ messageId: context.messages[index].id, evidence, confidence: 0.99 });
    const numericContext = input(game, ['清点物资：柴火 ×8，清水 ×4']);
    assert.throws(() => apply(game, { inventory: { set: [{ label: '柴火', quantity: 4, quantityKnown: true, ...ref(numericContext, numericContext.messages[0].text) }] } }, numericContext));
    const chineseContext = input(game, ['捡到五份柴火。']);
    const chineseResult = apply(game, { inventory: { add: [{ label: '柴火', quantity: 5, quantityKnown: true, ...ref(chineseContext, chineseContext.messages[0].text) }] } }, chineseContext);
    assert.equal(Object.values(chineseResult.inventory).find(item => item.label === '柴火').quantity, 13);
    context = input(game, ['捡到柴火5份。', '你捡到柴火5份。']);
    raw = { inventory: { add: [0, 1].map(index => ({ label: '柴火', quantity: 5, quantityKnown: true, ...ref(context, index ? '你捡到柴火5份。' : '捡到柴火5份。', index) })) } };
    game = apply(game, raw, context); assert.equal(Object.values(game.inventory).find(item => item.label === '柴火').quantity, 13);
    game = apply(game, raw, context); assert.equal(Object.values(game.inventory).find(item => item.label === '柴火').quantity, 13);
    // Edited already-applied messages go to candidates instead of adding again.
    const edited = plain(context); edited.messages[0].text = '捡到柴火7份。'; edited.messages[0].hash = semantic.fingerprint('user:' + edited.messages[0].text);
    const revised = apply(game, { inventory: { add: [{ label: '柴火', quantity: 7, quantityKnown: true, ...ref(edited, edited.messages[0].text) }] } }, edited);
    assert.equal(Object.values(revised.inventory).find(item => item.label === '柴火').quantity, 13); assert(revised.pendingDiscoveries.length);
    context = input(game, ['一个叫砚绒的白发红眼兽人走过来和你说话。', '他因为害怕躲起来。']);
    raw = { npcs: [{ name: '砚绒', status: 'known', ...ref(context, context.messages[0].text),
        appearance: ['白发', '红眼', '兽人'].map(text => ({ text, ...ref(context, context.messages[0].text) })),
        personality: [{ text: '胆小', strongEvidence: false, ...ref(context, context.messages[1].text, 1) }] }] };
    game = apply(game, raw, context); const npcId = Object.values(game.npcs).find(npc => npc.name === '砚绒').id;
    assert.equal(semantic.knownNpcs(game, ctx.name1).length, 1); assert.equal(game.npcs[npcId].appearance.facts.length, 3);
    assert.equal(game.npcs[npcId].personality.confirmed.length, 0); assert.equal(game.npcs[npcId].personality.impressions[0].evidenceCount, 1);
    game = apply(game, raw, context); assert.equal(game.npcs[npcId].personality.impressions[0].evidenceCount, 1);
    context = input(game, ['后来砚绒与你交谈，穿着破旧棉袄。', '突如其来的声音又让他害怕得躲起来。']);
    raw = { npcs: [{ id: npcId, name: '砚绒', status: 'known', ...ref(context, context.messages[0].text),
        appearance: [{ text: '破旧棉袄', ...ref(context, context.messages[0].text) }],
        personality: [{ text: '胆小', strongEvidence: false, ...ref(context, context.messages[1].text, 1) }] }] };
    game = apply(game, raw, context); assert.equal(game.npcs[npcId].appearance.facts.length, 4);
    assert.equal(game.npcs[npcId].personality.confirmed[0].evidenceCount, 2); assert.equal(game.npcs[npcId].relationship.familiarity, 0);
    assert.equal(game.npcs[npcId].basicInfo.occupation, null);
    context = input(game, ['听说村里有个叫洛冉的人。', '旁边有个老山羊兽人。']);
    raw = { npcs: [{ name: '洛冉', status: 'mentioned', ...ref(context, context.messages[0].text) }, { name: '老山羊兽人', status: 'known', ...ref(context, context.messages[1].text, 1) }] };
    game = apply(game, raw, context); assert.equal(semantic.knownNpcs(game, ctx.name1).length, 1);
    assert(!Object.values(game.npcs).some(npc => npc.name === '田园生活'));
    const manualInput = planner.semanticInput(game, ctx, [], game.actors[actor.id]);
    const withUser = apply(game, { npcs: [{ name: '玩家', status: 'known' }, { name: 'User', status: 'known' }] }, manualInput, { manual: true });
    assert.equal(semantic.knownNpcs(withUser, ctx.name1).length, 1);
    const old = plain(game); for (const key of ['inventory', 'npcs', 'processedMessageIds', 'pendingDiscoveries']) delete old[key];
    const migrated = engine.readState(old); for (const key of ['world', 'locations', 'actions', 'actors', 'controlMode', 'calendar', 'discoveryLog']) assert.deepEqual(plain(migrated[key]), plain(old[key]));
    assert.deepEqual(plain(migrated.inventory), {}); assert.deepEqual(plain(migrated.npcs), {});
    context = input(game, ['捡到柴火5份。', '记录完毕。']);
    for (const invalid of [{ money: 100 }, { inventory: { add: [{ label: '柴火', quantity: 999, quantityKnown: true, ...ref(context, context.messages[0].text) }] } },
        { inventory: { add: [{ label: '柴火', quantity: 1, quantityKnown: false, ...ref(context, context.messages[0].text) }] } },
        { npcs: [{ name: '伪造', status: 'known', messageId: 'missing', evidence: '伪造', confidence: 1 }] }]) {
        const before = JSON.stringify(game); assert.throws(() => apply(game, invalid, context)); assert.equal(JSON.stringify(game), before);
    }
    const history = [{ mes: '清点物资：柴火 ×5', is_user: true, send_date: 'one' }, { mes: '好。', is_user: false, send_date: 'two' }];
    let fresh = engine.createState(undefined, true); fresh.actors[actor.id] = plain(actor);
    const batch = planner.syncBatches(history, fresh); const syncInput = planner.semanticInput(fresh, ctx, batch[0], fresh.actors[actor.id]);
    fresh = apply(fresh, provider.extractDiscoveryCandidates(syncInput), syncInput);
    assert.equal(planner.syncBatches(history, fresh).length, 0); assert.equal(planner.syncBatches(history, fresh, '30', true).length, 1);
    assert.equal(api.activeChannel(undefined), null); assert.equal(api.activeChannel({ channels: [{ id: 'a', enabled: false }], activeChannelId: 'a' }), null);
    const secret = 'unit-test-secret-not-a-real-key';
    const channel = { ...api.channelDefaults(), baseUrl: 'https://example.test/v1/', model: 'test-model', apiKey: secret };
    assert.equal(api.completionUrl(channel.baseUrl), 'https://example.test/v1/chat/completions');
    assert.equal(api.completionUrl('https://example.test/chat/completions/'), 'https://example.test/chat/completions');
    let calls = 0;
    const fetchImpl = async (url, options) => { calls++; assert.equal(options.headers.Authorization, `Bearer ${secret}`); const body = JSON.parse(options.body); assert.equal(body.temperature, 0.1); assert.equal(body.max_tokens, 2048); assert(!body.reasoning_effort); return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: '{}' } }] }) }; };
    assert.equal(await api.requestCompletion(channel, [], { fetchImpl }), '{}'); assert.equal(calls, 1);
    for (const code of [400, 401, 403, 404, 429, 500]) await assert.rejects(api.requestCompletion(channel, [], { fetchImpl: async () => ({ ok: false, status: code }) }), error => !error.message.includes(secret) && error.message.includes(String(code)));
    for (const body of ['not-json ' + secret, 'null', '{"choices":[]}', JSON.stringify({ error: { message: secret } })]) await assert.rejects(api.requestCompletion(channel, [], { fetchImpl: async () => ({ ok: true, text: async () => body }) }), error => !error.message.includes(secret));
    await assert.rejects(api.requestCompletion(channel, [], { fetchImpl: async () => { throw Error('API ' + secret); } }), error => !error.message.includes(secret));
    await assert.rejects(api.requestCompletion({ ...channel, timeout: 1 }, [], { fetchImpl: (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Error(secret)))) }), /超时/);
    const secondary = new api.SecondaryAIDiscoveryProvider(channel, { fetchImpl: async () => ({ ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: 'not-json ' + secret } }] }) }) });
    const before = JSON.stringify(game); await assert.rejects(secondary.extractDiscoveryCandidates(context), /严格/); assert.equal(JSON.stringify(game), before);
    console.log('PASS: semantic location activity, inventory counts/unknowns, stocktake sync/dedup/reanalysis, independent NPC knowledge/traits, migration, evidence rejection, API URL/auth/error/timeout/redaction and local fallback.');
};
