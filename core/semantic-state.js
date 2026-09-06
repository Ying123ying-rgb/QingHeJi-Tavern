import { actionName } from './actions.js';
import { worldId, applyWorldDelta } from './world-discovery.js';

export const copy = value => JSON.parse(JSON.stringify(value));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const assert = (value, message) => { if (!value) throw new Error(message); };
const name = value => { const text = actionName(value); assert(text && text.length <= 240, '名称需为 1–240 字。'); return text; };
const text = (value, max = 2000) => { assert(typeof value === 'string' && value.length <= max, '事实文本无效或过长。'); return value.trim(); };
const list = value => { assert(Array.isArray(value) && value.length <= 100, '事实列表无效或过长。'); return value; };
const fields = (value, keys) => { assert(object(value), '事实必须为对象。'); for (const key of Object.keys(value)) assert(keys.includes(key), '事实包含不允许的字段。'); };
export const emptySemanticDelta = () => ({ locations: [], actorLocation: null, inventory: { add: [], remove: [], set: [] }, npcs: [], actions: [], locationUpdates: [] });
export const inventoryCategories = { all: '全部', food: '食物', ingredient: '食材', material: '材料', equipment: '装备', other: '其他' };

// A content fingerprint, not a security primitive. Two lanes + length avoid
// ordinary text collisions; message identity also includes role/date/index.
export function fingerprint(value) {
    let a = 2166136261, b = 5381;
    for (let i = 0; i < value.length; i++) { a = Math.imul(a ^ value.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ value.charCodeAt(i); }
    return `${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}_${value.length}`;
}
export function prepareMessages(chat) {
    let roundId = 'opening';
    return chat.flatMap((message, index) => {
        if (message.is_system || typeof message.mes !== 'string' || !message.mes.trim() || message.mes.trimStart().startsWith('/')) return [];
        const role = message.is_user ? 'user' : 'assistant';
        const id = `message_${fingerprint(role + ':' + (message.send_date ? String(message.send_date) : String(index)))}`;
        if (role === 'user') roundId = id;
        const hash = fingerprint(role + ':' + message.mes);
        return [{ id, hash, roundId, role, text: message.mes }];
    });
}
export function createInventoryItem(label, id = worldId('item', label)) {
    return { id, label, quantity: null, quantityKnown: false, unit: '', category: 'other', description: '', discovered: true, metadata: {}, sourceRefs: [], updatedAt: null };
}
export function createNpc(label, id = worldId('npc', label)) {
    return { id, name: label, mentioned: false, encountered: false, known: false,
        appearance: { status: 'unknown', facts: [] }, basicInfo: { gender: null, age: null, occupation: null, identity: null },
        personality: { confirmed: [], impressions: [] }, preferences: { likes: [], dislikes: [] },
        relationship: { label: '', familiarity: 0 }, history: [], currentLocationId: null,
        knowledge: {}, sourceRefs: [], metadata: {}, knowledgeProgress: 0 };
}
export const knownNpcs = (game, userName = '') => Object.values(game.npcs).filter(npc => (npc.encountered || npc.known) && !npc.metadata?.isUser && !['User', 'user', '我', '你', userName].includes(npc.name));
const uncertain = /听说|据说|传闻|明天|以后|将来|打算|想去|希望|如果|假如|假设|好像|可能|也许|似乎|曾经|回忆|没有|并未|尚未|不曾|[？?]/u;
const interaction = /说话|交谈|打招呼|自我介绍|告诉|询问|回答|递给|握手|遇见|见面|交流|认识|帮助|和你|与你/u;

function numeral(value) {
    if (/^\d/u.test(value)) return Number(value);
    const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    const units = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
    let result = 0, current = 0;
    for (const char of value) {
        if (Object.hasOwn(digits, char)) current = digits[char];
        else if (char === '万') { result = (result + current) * 10000; current = 0; }
        else { result += (current || 1) * units[char]; current = 0; }
    }
    return result + current;
}
export function hasQuantityEvidence(label, quantity, evidence) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const match of evidence.matchAll(/\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百千万]+/gu)) {
        if (numeral(match[0]) !== quantity) continue;
        const before = evidence.slice(0, match.index), after = evidence.slice(match.index + match[0].length);
        if (new RegExp(`${escaped}\\s*(?:[×xX*=:：]|共计|总共|数量为|剩余|有)?\\s*$`, 'u').test(before)
            || new RegExp(`^\\s*(?:份|个|件|瓶|斤|公斤|升|克|包|袋|块|支|根|本|套|把|枚|条|箱|桶|张|米|吨)?\\s*${escaped}`, 'u').test(after)) return true;
    }
    return false;
}

function safe(value, depth = 0) {
    assert(depth <= 14, '事实层级过深。');
    if (!value || typeof value !== 'object') return;
    for (const key of Object.keys(value)) { assert(!['__proto__', 'prototype', 'constructor'].includes(key), '非法事实字段。'); safe(value[key], depth + 1); }
}
const envelope = ['messageId', 'evidence', 'confidence'];
// applyValidatedDelta revalidates the returned raw data and evidence;
// callers cannot bypass the boundary by constructing something with this shape.
export function validateSemanticDelta(raw, game, input, { manual = false, reanalyze = false } = {}) {
    assert(object(raw) && JSON.stringify(raw).length <= 250000, '语义 JSON 无效或过大。'); safe(raw);
    fields(raw, Object.keys(emptySemanticDelta()));
    const result = { facts: [], pending: [], messages: copy(input.messages ?? []), manual, reanalyze };
    const sources = new Map((input.messages ?? []).map(message => [message.id, message]));
    const proof = value => {
        if (manual) return { messageId: 'manual', hash: '', roundId: `manual_${Date.now()}`, evidence: '用户手动修正', confidence: 1 };
        const message = sources.get(value.messageId);
        assert(message, '事实引用了未提供的消息。');
        const evidence = text(value.evidence, 4000);
        assert(evidence && message.text.includes(evidence), '事实证据不在原始消息中。');
        assert(Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1, '置信度无效。');
        return { messageId: message.id, hash: message.hash, roundId: message.roundId, evidence, confidence: value.confidence };
    };
    const push = (kind, value, ref, extraReason = '') => {
        const processed = game.processedMessageIds[ref.messageId];
        const changed = processed && !processed.hashes.includes(ref.hash);
        const fact = { kind, value, ref };
        const mention = ['location', 'npc'].includes(kind) && value.status === 'mentioned';
        if (!manual && (reanalyze || changed || extraReason || ref.confidence < 0.9 || (!mention && uncertain.test(ref.evidence)))) {
            result.pending.push({ ...fact, reason: extraReason || (reanalyze ? '重新分析预览，未重复应用' : changed ? '消息已修改，请核对原记录后手动修正' : '证据尚不明确') });
        } else if (manual || !processed?.hashes.includes(ref.hash)) result.facts.push(fact);
    };
    const entityId = (kind, value, registry) => {
        const label = name(value.label ?? value.name);
        const existing = Object.values(registry).find(item => actionName(item.label ?? item.name).toLowerCase() === label.toLowerCase());
        const id = value.id ?? existing?.id ?? worldId(kind, label);
        assert(typeof id === 'string' && /^[A-Za-z0-9_-]{1,4096}$/.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id), '实体 ID 无效。');
        assert(!existing || id === existing.id, '同名实体 ID 冲突。');
        return { id, label };
    };
    const locations = { ...game.locations };
    for (const value of list(raw.locations ?? [])) {
        fields(value, ['id', 'label', 'status', 'description', ...envelope]);
        const ref = proof(value), entity = entityId('location', value, locations);
        assert(['mentioned', 'discovered', 'visited'].includes(value.status), '地点状态无效。');
        const location = { ...entity, status: value.status, description: value.description === undefined ? undefined : text(value.description) };
        if (!manual && uncertain.test(ref.evidence)) location.status = 'mentioned';
        locations[entity.id] = { ...location, discovered: location.status !== 'mentioned' };
        push('location', location, ref, !manual && !ref.evidence.includes(entity.label) ? '地点名称缺少原文证据' : '');
    }
    if (raw.actorLocation !== undefined && raw.actorLocation !== null) {
        fields(raw.actorLocation, ['locationId', 'label', ...envelope]);
        const ref = proof(raw.actorLocation);
        const id = raw.actorLocation.locationId ?? Object.values(locations).find(item => item.label === raw.actorLocation.label)?.id;
        assert(id && Object.hasOwn(locations, id), '人物地点引用不存在。');
        push('actorLocation', { locationId: id }, ref, locations[id].status === 'mentioned' ? '仅提及地点' : !manual && !ref.evidence.includes(locations[id].label) ? '当前位置缺少地点证据' : '');
    }
    const inventory = raw.inventory ?? { add: [], remove: [], set: [] };
    fields(inventory, ['add', 'remove', 'set']);
    const quantities = new Set();
    for (const operation of ['add', 'remove', 'set']) for (const value of list(inventory[operation] ?? [])) {
        fields(value, ['id', 'label', 'quantity', 'quantityKnown', 'unit', 'category', 'description', ...envelope]);
        const ref = proof(value), entity = entityId('item', value, game.inventory);
        assert(typeof value.quantityKnown === 'boolean', '必须说明物资数量是否已知。');
        if (value.quantityKnown) {
            assert(Number.isFinite(value.quantity) && value.quantity >= 0 && value.quantity <= 1e9, '物资数量无效。');
            if (!manual) assert(hasQuantityEvidence(entity.label, value.quantity, ref.evidence), '数量必须与该物品的原文数字对应；不可猜测。');
        } else assert(value.quantity === null || value.quantity === undefined, '数量未知时不得填写猜测数值。');
        const unit = value.unit === undefined ? undefined : text(value.unit, 24);
        const category = value.category ?? game.inventory[entity.id]?.category ?? 'other';
        assert(Object.hasOwn(inventoryCategories, category) && category !== 'all', '物资类别无效。');
        const item = { ...entity, operation, quantity: value.quantityKnown ? value.quantity : null, quantityKnown: value.quantityKnown, category };
        if (unit !== undefined) item.unit = unit;
        if (value.description !== undefined) item.description = text(value.description);
        const key = `${ref.roundId}:${entity.id}:${operation}:${item.quantity}`;
        if (quantities.has(key)) continue; quantities.add(key);
        push('inventory', item, ref, !manual && !ref.evidence.includes(entity.label) ? '物品名称缺少原文证据' : '');
    }
    const factValue = value => {
        fields(value, ['text', ...envelope]); return { text: text(value.text, 1000), ref: proof(value) };
    };
    for (const value of list(raw.npcs ?? [])) {
        fields(value, ['id', 'name', 'status', 'appearance', 'basicInfo', 'personality', 'likes', 'dislikes', 'history', 'relationship', 'currentLocationId', ...envelope]);
        const ref = proof(value), entity = entityId('npc', value, game.npcs);
        if (['User', 'user', '我', '你', input.userName].includes(entity.label)) continue;
        assert(['mentioned', 'encountered', 'known'].includes(value.status), '人物认识状态无效。');
        let status = value.status;
        if (!manual && (!interaction.test(ref.evidence) || uncertain.test(ref.evidence)) && !game.npcs[entity.id]?.encountered) status = 'mentioned';
        push('npc', { id: entity.id, name: entity.label, status }, ref, !manual && !ref.evidence.includes(entity.label) ? '人物名称缺少原文证据' : '');
        const leaf = (section, fact) => { const parsed = factValue(fact); push('npcFact', { npcId: entity.id, section, text: parsed.text }, parsed.ref,
            !manual && !parsed.ref.evidence.includes(parsed.text) ? '资料缺少直接原文证据' : ''); };
        for (const section of ['appearance', 'likes', 'dislikes', 'history']) for (const fact of list(value[section] ?? [])) leaf(section, fact);
        if (value.basicInfo !== undefined) {
            fields(value.basicInfo, ['gender', 'age', 'occupation', 'identity']);
            for (const [key, fact] of Object.entries(value.basicInfo)) if (fact !== null) leaf(key, fact);
        }
        if (value.relationship) leaf('relationship', value.relationship);
        if (value.currentLocationId) {
            assert(Object.hasOwn(locations, value.currentLocationId), 'NPC 地点不存在。');
            push('npcFact', { npcId: entity.id, section: 'location', text: value.currentLocationId }, ref);
        }
        for (const fact of list(value.personality ?? [])) {
            fields(fact, ['text', 'strongEvidence', ...envelope]);
            const evidence = proof(fact);
            push('npcPersonality', { npcId: entity.id, text: text(fact.text, 120), strong: manual || (fact.strongEvidence === true && /一直|一向|向来|天生|性格/u.test(evidence.evidence)) }, evidence);
        }
    }
    for (const value of list(raw.actions ?? [])) {
        fields(value, ['id', 'label', 'locationIds', ...envelope]);
        const ref = proof(value), entity = entityId('action', value, game.actions);
        const ids = list(value.locationIds ?? []);
        assert(ids.every(id => typeof id === 'string' && Object.hasOwn(locations, id)), '行动地点不存在。');
        push('action', { ...entity, locationIds: [...new Set(ids)] }, ref);
    }
    for (const value of list(raw.locationUpdates ?? [])) {
        fields(value, ['id', 'capabilities', 'resources', 'services', ...envelope]);
        const ref = proof(value); assert(Object.hasOwn(locations, value.id), '地点知识目标不存在。');
        const update = { id: value.id };
        for (const key of ['capabilities', 'resources', 'services']) update[key] = list(value[key] ?? []).map(item => {
            fields(item, ['id', 'label', 'type']); const result = entityId(key, item, {});
            if (item.type !== undefined) result.type = text(item.type, 120); return result;
        });
        push('locationUpdate', update, ref);
    }
    return { ...result, raw: copy(raw), input: copy(input) };
}

const addRef = (refs, ref) => { if (!refs.some(old => old.messageId === ref.messageId && old.hash === ref.hash && old.evidence === ref.evidence)) refs.push(copy(ref)); };
function progress(npc) {
    const count = npc.appearance.facts.length + Object.values(npc.basicInfo).filter(Boolean).length + npc.personality.confirmed.length
        + npc.preferences.likes.length + npc.preferences.dislikes.length + npc.history.length + Number(Boolean(npc.relationship.label)) + Number(Boolean(npc.currentLocationId));
    npc.knowledgeProgress = Math.min(100, count * 4 + Number(npc.encountered) * 4 + Number(npc.known) * 4);
    npc.relationship.familiarity = 0; // Not a relationship score.
}
export function applyValidatedDelta(game, validated, { source = 'secondary_ai', timestamp = new Date().toISOString() } = {}) {
    const checked = validateSemanticDelta(validated.raw, game, validated.input, { manual: validated.manual, reanalyze: validated.reanalyze });
    let next = copy(game);
    const applied = new Set();
    const order = new Map(checked.messages.map((message, index) => [message.id, index]));
    checked.facts.sort((a, b) => (order.get(a.ref.messageId) ?? 0) - (order.get(b.ref.messageId) ?? 0));
    for (const fact of checked.facts.filter(fact => fact.kind === 'npc')) next.npcs[fact.value.id] ??= createNpc(fact.value.name, fact.value.id);
    for (const fact of checked.facts) {
        const { kind, value, ref } = fact;
        const eventKey = fingerprint(JSON.stringify([ref.roundId, kind, kind === 'inventory' ? [value.id, value.operation, value.quantity, value.quantityKnown] : value]));
        if (!checked.manual && (next.semanticEvents?.[eventKey] || applied.has(eventKey))) continue;
        applied.add(eventKey);
        if (['location', 'actorLocation', 'action', 'locationUpdate'].includes(kind)) {
            let delta;
            if (kind === 'location') {
                const location = { id: value.id, label: value.label, mentioned: value.status === 'mentioned', discovered: value.status !== 'mentioned', visited: value.status === 'visited' };
                if (value.description !== undefined) location.description = value.description;
                delta = { locationsToAdd: [location] };
            } else if (kind === 'action') {
                if (value.locationIds.some(id => !next.locations[id]?.discovered)) continue;
                delta = { actionsToAdd: [value] };
            } else if (kind === 'locationUpdate') {
                if (!next.locations[value.id]) continue;
                delta = { locationsToUpdate: [value] };
            } else {
                if (!next.locations[value.locationId]?.discovered || !next.actors[checked.input.controlledActor?.id]) continue;
                delta = { actorLocationChanges: [{ actorId: checked.input.controlledActor.id, locationId: value.locationId }] };
            }
            delta.discoveries = [{ type: kind, label: value.label ?? value.id ?? value.locationId, evidence: ref.evidence, status: 'fact', confidence: 1 }];
            next = applyWorldDelta(next, delta, { source: checked.manual ? 'user' : source, timestamp, turnId: ref.roundId });
        } else if (kind === 'inventory') {
            const item = next.inventory[value.id] ?? createInventoryItem(value.label, value.id);
            const existed = Object.hasOwn(next.inventory, value.id);
            if (value.operation === 'remove' && !existed) { checked.pending.push({ ...fact, reason: '物资尚未入账，请手动核对消耗' }); continue; }
            if (value.operation === 'set') { item.quantity = value.quantity; item.quantityKnown = value.quantityKnown; }
            else if (!value.quantityKnown || (existed && !item.quantityKnown)) { item.quantity = null; item.quantityKnown = false; }
            else {
                const amount = (item.quantity ?? 0) + (value.operation === 'remove' ? -value.quantity : value.quantity);
                if (amount < 0 || amount > 1e9) { checked.pending.push({ ...fact, reason: '数量变动超出现有物资，请手动核对' }); continue; }
                item.quantity = amount; item.quantityKnown = true;
            }
            for (const key of ['label', 'unit', 'category', 'description']) if (value[key] !== undefined) item[key] = value[key];
            item.updatedAt = timestamp; addRef(item.sourceRefs, ref); next.inventory[item.id] = item;
        } else if (kind === 'npc') {
            const npc = next.npcs[value.id] ?? createNpc(value.name, value.id);
            npc.name = value.name; npc.mentioned ||= value.status === 'mentioned'; npc.encountered ||= value.status !== 'mentioned'; npc.known ||= value.status === 'known';
            addRef(npc.sourceRefs, ref); next.npcs[npc.id] = npc;
        } else if (kind === 'npcFact' || kind === 'npcPersonality') {
            const npc = next.npcs[value.npcId]; if (!npc) { checked.pending.push({ ...fact, reason: '人物身份尚待确认' }); continue; }
            const factRecord = { text: value.text, sourceRefs: [copy(ref)] };
            if (kind === 'npcPersonality') {
                let trait = [...npc.personality.impressions, ...npc.personality.confirmed].find(item => item.text === value.text);
                if (!trait) { trait = { ...factRecord, evidenceCount: 0 }; npc.personality.impressions.push(trait); }
                addRef(trait.sourceRefs, ref);
                trait.evidenceCount = Math.min(new Set(trait.sourceRefs.map(item => item.roundId)).size, new Set(trait.sourceRefs.map(item => item.evidence)).size);
                if (trait.evidenceCount >= 2 || value.strong) {
                    npc.personality.impressions = npc.personality.impressions.filter(item => item.text !== trait.text);
                    if (!npc.personality.confirmed.some(item => item.text === trait.text)) npc.personality.confirmed.push(trait);
                }
            } else {
                const arrays = { appearance: npc.appearance.facts, likes: npc.preferences.likes, dislikes: npc.preferences.dislikes, history: npc.history };
                if (arrays[value.section]) {
                    const old = arrays[value.section].find(item => item.text === value.text);
                    if (old) addRef(old.sourceRefs, ref); else arrays[value.section].push(factRecord);
                } else if (value.section === 'relationship') npc.relationship.label = value.text;
                else if (value.section === 'location') { if (next.locations[value.text]) npc.currentLocationId = value.text; }
                else npc.basicInfo[value.section] = value.text;
                npc.knowledge[value.section] ??= []; addRef(npc.knowledge[value.section], ref);
            }
            if (npc.appearance.facts.length) npc.appearance.status = 'known';
            addRef(npc.sourceRefs, ref);
        }
        next.semanticEvents ??= {}; next.semanticEvents[eventKey] = { messageId: ref.messageId, hash: ref.hash };
    }
    for (const npc of Object.values(next.npcs)) progress(npc);
    for (const item of checked.pending) {
        const id = fingerprint(JSON.stringify([item.kind, item.value, item.ref.messageId, item.ref.hash]));
        if (!next.pendingDiscoveries.some(old => old.id === id)) next.pendingDiscoveries.push({ id, ...item, timestamp, ignored: false });
    }
    if (!checked.manual && !checked.reanalyze) for (const message of checked.messages) {
        const record = next.processedMessageIds[message.id] ?? { hashes: [] };
        if (!record.hashes.includes(message.hash)) record.hashes.push(message.hash);
        record.updatedAt = timestamp; next.processedMessageIds[message.id] = record;
    }
    if (checked.facts.some(fact => ['inventory', 'npc', 'npcFact', 'npcPersonality'].includes(fact.kind))) next.discoveryLog.push({
        id: `semantic_${timestamp}_${next.discoveryLog.length}`, type: 'semantic', label: '物资与人物资料', source: checked.manual ? 'user' : source, timestamp,
        discoveries: checked.facts.map(fact => ({ type: fact.kind, label: fact.value.label ?? fact.value.name ?? fact.value.text ?? '' })),
    });
    return next;
}
