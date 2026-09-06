import { actionName } from './actions.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const own = (obj, key) => Object.hasOwn(obj, key);
const keyOf = value => typeof value === 'string' ? value : value.id;
const automatic = source => ['auto', 'secondary_ai'].includes(source);
export const worldId = (type, label) => `${type}_${Array.from(actionName(label).toLowerCase(), char => char.codePointAt(0).toString(16)).join('_')}`;
export const emptyWorldDelta = () => ({ locationsToAdd: [], locationsToUpdate: [], actionsToAdd: [], actionsToUpdate: [], actorLocationChanges: [], discoveries: [] });
export const discoveredLocations = game => Object.values(game.locations).filter(location => location.discovered || location.visited);
export const actionsAtLocation = (game, locationId) => Object.values(game.actions).filter(action => action.enabled !== false
    && (!action.locationIds?.length || action.locationIds.includes(locationId)));

export function createLocation(id, label, source = 'user') {
    return { id, label, type: '', mentioned: false, discovered: true, visited: false, description: '',
        capabilities: [], resources: [], services: [], actions: [], tags: [], discoveredAt: null, updatedAt: null, source, metadata: {} };
}

function assert(value, message) { if (!value) throw new Error(message); }
function safeJson(value) {
    assert(JSON.stringify(value).length <= 200000, '发现数据过大。');
    const walk = (item, depth = 0) => {
        assert(depth < 16, '发现数据层级过深。');
        if (!item || typeof item !== 'object') return;
        for (const key of Object.keys(item)) {
            assert(!['__proto__', 'prototype', 'constructor'].includes(key), '发现数据包含非法字段。');
            walk(item[key], depth + 1);
        }
    };
    walk(value);
}
function validId(value) {
    assert(typeof value === 'string' && /^[A-Za-z0-9_-]{1,4096}$/.test(value)
        && !['__proto__', 'prototype', 'constructor'].includes(value), '无效的实体 ID。');
    return value;
}
function label(value) {
    const result = actionName(value);
    assert(result && result.length <= 240, '名称需为 1–240 个字符。');
    return result;
}
function fields(value, allowed) {
    assert(object(value), '发现条目必须是对象。');
    for (const key of Object.keys(value)) assert(allowed.includes(key), `发现条目不允许字段：${key}`);
}
function items(values, type, source, existing = []) {
    assert(Array.isArray(values) && values.length <= 100, '地点知识必须是数组，且不超过 100 项。');
    const result = [];
    for (let value of values) {
        if (typeof value === 'string') value = { id: value, label: value };
        fields(value, ['id', 'label', 'type', 'known', 'metadata', 'source']);
        const name = label(value.label ?? value.id);
        const known = existing.find(item => object(item) && actionName(item.label).toLowerCase() === name.toLowerCase());
        const item = { id: validId(known?.id ?? value.id ?? worldId(type, name)), label: name, source, metadata: clone(value.metadata ?? {}) };
        assert(object(item.metadata), 'metadata 必须是对象。');
        if (type === 'resource') {
            if (value.known !== undefined) assert(typeof value.known === 'boolean', 'known 必须为布尔值。');
            item.known = value.known !== false;
        }
        if (value.type !== undefined) { assert(typeof value.type === 'string', 'type 必须是文本。'); item.type = value.type; }
        if (!result.some(old => old.id === item.id)) result.push(item);
    }
    return result;
}

// Validation returns a detached, whitelisted delta. Providers never receive a
// live save, and cannot use this boundary to change currency, inventory or stats.
export function validateDiscovery(candidate, game, { source = 'user' } = {}) {
    assert(['user', 'auto', 'secondary_ai'].includes(source), '无效的发现来源。');
    fields(candidate, Object.keys(emptyWorldDelta())); safeJson(candidate);
    const delta = { ...emptyWorldDelta(), ...clone(candidate) };
    for (const values of Object.values(delta)) assert(Array.isArray(values) && values.length <= 100, 'World Delta 字段必须是数组，且不超过 100 项。');
    for (const record of delta.discoveries) {
        fields(record, ['type', 'label', 'evidence', 'confidence', 'status', 'metadata']);
        label(record.label);
        assert(typeof record.type === 'string', '发现记录缺少类型。');
        if (automatic(source)) assert(record.status === 'fact' && record.confidence >= 0.95
            && typeof record.evidence === 'string' && record.evidence.length > 0, '自动发现必须提供高置信事实证据。');
    }
    if (automatic(source) && Object.entries(delta).some(([key, values]) => key !== 'discoveries' && values.length)) {
        assert(delta.discoveries.length > 0, '自动发现缺少事实证据。');
    }
    const locations = clone(game.locations), actions = clone(game.actions);
    for (const [addKey, updateKey, registry, kind] of [
        ['locationsToAdd', 'locationsToUpdate', locations, 'location'], ['actionsToAdd', 'actionsToUpdate', actions, 'action'],
    ]) {
        for (const collection of [addKey, updateKey]) {
            delta[collection] = delta[collection].map(raw => {
                fields(raw, kind === 'location'
                    ? ['id', 'label', 'type', 'mentioned', 'discovered', 'visited', 'description', 'capabilities', 'resources', 'services', 'actions', 'tags', 'metadata', 'source']
                    : ['id', 'label', 'enabled', 'temporary', 'locationIds', 'metadata', 'source', 'duration', 'costs', 'requirements', 'effects', 'location', 'cooldown', 'aiRoute', 'handler']);
                const name = raw.label === undefined ? undefined : label(raw.label);
                const existing = name && Object.values(registry).find(item => actionName(item.label).toLowerCase() === name.toLowerCase());
                const id = validId(raw.id ?? existing?.id ?? (name && worldId(kind, name)));
                assert(!existing || existing.id === id, '同名实体不能使用不同 ID。');
                if (collection === addKey && own(registry, id) && name) assert(actionName(registry[id].label).toLowerCase() === name.toLowerCase(), 'ID 已被其他实体使用。');
                assert(collection !== updateKey || own(registry, id), '更新目标不存在。');
                assert(name || own(registry, id), '新实体必须有名称。');
                const value = { ...raw, id, source };
                if (name) value.label = name;
                if (raw.metadata !== undefined) assert(object(raw.metadata), 'metadata 必须是对象。');
                for (const key of ['enabled', 'temporary', 'mentioned', 'discovered', 'visited']) {
                    if (raw[key] !== undefined) assert(typeof raw[key] === 'boolean', `${key} 必须为布尔值。`);
                }
                for (const key of ['description', 'type']) if (raw[key] !== undefined) assert(typeof raw[key] === 'string' && raw[key].length <= 4000, `${key} 必须为短文本。`);
                if (kind === 'location') {
                    for (const [key, type] of [['capabilities', 'capability'], ['resources', 'resource'], ['services', 'service']]) {
                        if (raw[key] !== undefined) value[key] = items(raw[key], type, source, registry[id]?.[key]);
                    }
                    if (raw.visited) value.discovered = true;
                    if (raw.mentioned && !raw.visited && raw.discovered === undefined) value.discovered = false;
                }
                for (const key of ['actions', 'locationIds', 'tags']) {
                    if (raw[key] !== undefined) {
                        assert(Array.isArray(raw[key]) && raw[key].length <= 100, `${key} 必须是数组。`);
                        value[key] = [...new Set(raw[key].map(item => key === 'tags' ? label(item) : validId(item)))];
                    }
                }
                registry[id] = { ...registry[id], ...value };
                return value;
            });
        }
    }
    for (const value of [...delta.locationsToAdd, ...delta.locationsToUpdate]) {
        for (const id of value.actions ?? []) assert(own(actions, id), '关联行动不存在。');
    }
    for (const value of [...delta.actionsToAdd, ...delta.actionsToUpdate]) {
        for (const id of value.locationIds ?? []) assert(own(locations, id), '行动关联地点不存在。');
    }
    for (const value of delta.actorLocationChanges) {
        fields(value, ['actorId', 'locationId']); validId(value.actorId); validId(value.locationId);
        assert(own(game.actors, value.actorId), '人物不存在。');
        assert(own(locations, value.locationId) && (locations[value.locationId].discovered || locations[value.locationId].visited), '人物只能定位到已发现地点。');
    }
    return delta;
}

function mergeList(before = [], additions = []) {
    const result = clone(before);
    for (const item of additions) {
        const index = result.findIndex(old => keyOf(old) === keyOf(item));
        if (index < 0) result.push(clone(item));
        else if (object(item)) {
            // Automated updates cannot take ownership away from manual knowledge.
            result[index] = { ...result[index], ...item, metadata: { ...result[index].metadata, ...item.metadata }, source: result[index].source === 'user' ? 'user' : item.source };
        }
    }
    return result;
}
function changes(before, after, path = [], result = []) {
    if (same(before, after)) return result;
    if (path.includes('metadata')) {
        result.push({ path, before: clone(before), after: clone(after) });
    } else if (Array.isArray(before) && Array.isArray(after)) {
        // World arrays have stable IDs (or string values), so later additions do
        // not invalidate reversal of an earlier resource/capability/service.
        const keys = new Set([...before, ...after].map(keyOf));
        for (const itemKey of keys) {
            const a = before.find(item => keyOf(item) === itemKey), b = after.find(item => keyOf(item) === itemKey);
            if (!same(a, b)) result.push({ path, itemKey, before: clone(a), after: clone(b) });
        }
    } else if (object(before) && object(after)) {
        for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) changes(before[key], after[key], [...path, key], result);
    } else result.push({ path, before: clone(before), after: clone(after) });
    return result;
}
const lookup = (game, path) => path.reduce((value, key) => value?.[key], game);

export function applyWorldDelta(game, candidate, { source = 'user', timestamp = new Date().toISOString(), turnId = null } = {}) {
    const delta = validateDiscovery(candidate, game, { source });
    const next = clone(game);
    for (const value of [...delta.locationsToAdd, ...delta.locationsToUpdate]) {
        const old = next.locations[value.id] ?? { ...createLocation(value.id, value.label, source), discovered: value.discovered ?? !value.mentioned };
        const merged = { ...old, ...value, metadata: { ...old.metadata, ...value.metadata }, source: old.source === 'user' ? 'user' : source };
        for (const key of ['capabilities', 'resources', 'services', 'actions', 'tags']) merged[key] = mergeList(old[key], value[key]);
        merged.discovered = old.discovered || merged.discovered || merged.visited;
        merged.visited = old.visited || merged.visited;
        merged.discoveredAt = old.discoveredAt ?? (merged.discovered ? timestamp : null);
        if (!same(old, merged) || !own(next.locations, value.id)) merged.updatedAt = timestamp;
        next.locations[value.id] = merged;
    }
    for (const value of [...delta.actionsToAdd, ...delta.actionsToUpdate]) {
        const old = next.actions[value.id] ?? { id: value.id, label: value.label, enabled: true, temporary: true, source, locationIds: [], metadata: {} };
        next.actions[value.id] = { ...old, ...value, metadata: { ...old.metadata, ...value.metadata }, source: old.source === 'user' ? 'user' : source,
            locationIds: mergeList(old.locationIds, value.locationIds) };
    }
    // Keep both directions consistent. A link is data, never an execution request.
    for (const value of [...delta.locationsToAdd, ...delta.locationsToUpdate]) for (const id of value.actions ?? []) {
        next.actions[id].locationIds = mergeList(next.actions[id].locationIds, [value.id]);
    }
    for (const value of [...delta.actionsToAdd, ...delta.actionsToUpdate]) for (const id of value.locationIds ?? []) {
        if (!next.locations[id].actions?.includes(value.id)) next.locations[id].updatedAt = timestamp;
        next.locations[id].actions = mergeList(next.locations[id].actions, [value.id]);
    }
    for (const value of delta.actorLocationChanges) next.actors[value.actorId].locationId = value.locationId;
    const patches = [];
    for (const key of ['locations', 'actions', 'actors']) changes(game[key], next[key], [key], patches);
    // Record explicit manual confirmations even if the value did not change.
    // Otherwise a later undo could undo a position the user just confirmed.
    const touches = [];
    if (source === 'user') {
        for (const value of delta.actorLocationChanges) touches.push({ path: ['actors', value.actorId, 'locationId'] });
        for (const [kind, values] of [['locations', [...delta.locationsToAdd, ...delta.locationsToUpdate]], ['actions', [...delta.actionsToAdd, ...delta.actionsToUpdate]]]) {
            for (const value of values) for (const key of Object.keys(value).filter(key => !['id', 'source'].includes(key))) {
                const path = [kind, value.id, key];
                if (Array.isArray(value[key])) for (const item of value[key]) touches.push({ path, itemKey: keyOf(item) });
                else touches.push({ path });
            }
        }
        for (const value of [...delta.locationsToAdd, ...delta.locationsToUpdate]) for (const id of value.actions ?? []) touches.push({ path: ['actions', id, 'locationIds'], itemKey: value.id });
        for (const value of [...delta.actionsToAdd, ...delta.actionsToUpdate]) for (const id of value.locationIds ?? []) touches.push({ path: ['locations', id, 'actions'], itemKey: value.id });
    }
    if (patches.length || touches.length) {
        const first = delta.locationsToAdd[0] ?? delta.actionsToAdd[0] ?? delta.locationsToUpdate[0] ?? delta.actionsToUpdate[0];
        const records = clone(delta.discoveries);
        if (!records.length) {
            for (const value of delta.locationsToAdd) records.push({ type: 'location', label: next.locations[value.id].label });
            for (const value of [...delta.locationsToAdd, ...delta.locationsToUpdate]) {
                for (const [key, type] of [['capabilities', 'capability'], ['resources', 'resource'], ['services', 'service']]) {
                    for (const item of value[key] ?? []) records.push({ type, label: item.label, metadata: { locationId: value.id } });
                }
                for (const id of value.actions ?? []) records.push({ type: 'action_link', label: next.actions[id].label, metadata: { locationId: value.id } });
            }
            for (const value of [...delta.actionsToAdd, ...delta.actionsToUpdate]) records.push({ type: 'action', label: next.actions[value.id].label });
            for (const value of delta.actorLocationChanges) records.push({ type: 'actor_location', label: `${next.actors[value.actorId].name} → ${next.locations[value.locationId].label}` });
        }
        next.discoveryLog.push({ id: `discovery_${timestamp}_${next.discoveryLog.length}`, type: delta.locationsToAdd.length ? 'location' : delta.actionsToAdd.length ? 'action' : 'discovery',
            label: records[0]?.label ?? first?.label ?? first?.id ?? '人物位置', source, timestamp, turnId,
            discoveries: records, touches, undo: { patches }, undoneAt: null });
    }
    return next;
}

export function undoLatestDiscovery(game, timestamp = new Date().toISOString()) {
    const next = clone(game);
    const entry = [...next.discoveryLog].reverse().find(item => automatic(item.source) && !item.undoneAt && item.undo?.patches?.length);
    if (!entry) throw new Error('没有可撤销的自动发现。');
    for (const patch of entry.undo.patches) {
        assert(Array.isArray(patch.path) && patch.path.length >= 2 && patch.path.length <= 16, '撤销记录路径无效。');
        for (const key of patch.path) assert(typeof key === 'string' && !['__proto__', 'prototype', 'constructor'].includes(key), '撤销记录包含非法字段。');
        assert(['locations', 'actions'].includes(patch.path[0]) || (patch.path[0] === 'actors' && patch.path.length === 3 && patch.path[2] === 'locationId'), '撤销记录超出世界发现范围。');
    }
    const laterManual = next.discoveryLog.slice(next.discoveryLog.indexOf(entry) + 1).filter(item => item.source === 'user');
    const manualPatches = laterManual.flatMap(record => [...(record.undo?.patches ?? []), ...(record.touches ?? [])]);
    let reverted = 0, skipped = 0;
    const whole = [];
    for (const patch of [...entry.undo.patches].reverse()) {
        if (patch.path.length === 2 && patch.before === undefined) { whole.push(patch); continue; }
        const touched = manualPatches.some(manual => same(manual.path, patch.path)
            && (patch.itemKey === undefined || manual.itemKey === patch.itemKey));
        const parent = lookup(next, patch.path.slice(0, -1)), key = patch.path.at(-1);
        if (!parent || touched) { skipped++; continue; }
        if (patch.itemKey !== undefined) {
            const list = parent[key];
            const index = list?.findIndex(item => keyOf(item) === patch.itemKey) ?? -1;
            if (!Array.isArray(list) || !same(index < 0 ? undefined : list[index], patch.after)) { skipped++; continue; }
            if (patch.before === undefined) list.splice(index, 1);
            else if (index < 0) list.push(clone(patch.before));
            else list[index] = clone(patch.before);
        } else {
            if (!same(parent[key], patch.after)) { skipped++; continue; }
            if (patch.before === undefined) delete parent[key]; else parent[key] = clone(patch.before);
        }
        reverted++;
    }
    // New entities are removable only when untouched and without surviving refs.
    let removable = whole.filter(patch => same(lookup(next, patch.path), patch.after)
        && !manualPatches.some(manual => patch.path.every((key, i) => manual.path[i] === key)));
    const referenced = patch => {
        const [kind, id] = patch.path;
        const excluded = (kind, id) => removable.some(item => item.path[0] === kind && item.path[1] === id);
        return kind === 'locations'
            ? Object.values(next.actors).some(actor => actor.locationId === id) || Object.values(next.actions).some(action => !excluded('actions', action.id) && action.locationIds?.includes(id))
            : Object.values(next.locations).some(location => !excluded('locations', location.id) && location.actions?.includes(id));
    };
    let previous;
    do { previous = removable.length; removable = removable.filter(patch => !referenced(patch)); } while (removable.length !== previous);
    for (const patch of whole) {
        const [kind, id] = patch.path;
        if (!removable.includes(patch)) { skipped++; continue; }
        delete next[kind][id]; reverted++;
    }
    entry.undoneAt = timestamp; entry.undoResult = { reverted, skipped };
    return next;
}
