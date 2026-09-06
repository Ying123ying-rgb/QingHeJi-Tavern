import { DEFAULT_TEMPLATE_ID, worldTemplates } from '../data/world-templates.js';

export const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = value => JSON.parse(JSON.stringify(value));
const number = (value, fallback) => Number.isFinite(value) ? value : fallback;
const text = (value, fallback) => typeof value === 'string' ? value : fallback;
export const getTemplate = id => worldTemplates.find(template => template.id === id);

function createSingleState(templateId = DEFAULT_TEMPLATE_ID, enabled = false) {
    const template = getTemplate(templateId);
    if (!template) throw new Error(`Unknown world template: ${templateId}`);
    return {
        schemaVersion: 2,
        enabled: enabled === true,
        world: { templateId: template.id, templateVersion: template.version },
        currency: copy(template.currency),
        calendar: copy(template.calendar),
        stats: copy(template.stats),
        inventory: {}, relationships: {}, skills: {}, worldState: {},
    };
}

export function isLegacyState(saved) {
    return isObject(saved) && !saved.world?.templateId
        && ['money', 'date', 'time', 'stamina', 'satiety'].some(key => Object.hasOwn(saved, key));
}

// This is the only place that knows the v0.1 field names.
function migrateLegacy(saved) {
    const result = { ...copy(saved), ...createSingleState(DEFAULT_TEMPLATE_ID, saved.enabled) };
    result.currency.amount = number(saved.money, result.currency.amount);
    result.calendar.date = text(saved.date, result.calendar.date);
    result.calendar.time = text(saved.time, result.calendar.time);
    for (const stat of result.stats) {
        const old = saved[stat.id];
        stat.value = number(isObject(old) ? old.current : old, stat.value);
        stat.max = number(old?.max, stat.max);
    }
    for (const key of ['inventory', 'relationships', 'skills', 'worldState']) {
        if (isObject(saved[key])) result[key] = copy(saved[key]);
    }
    for (const key of ['money', 'date', 'time', 'stamina', 'satiety']) delete result[key];
    return result;
}

// Pure read/normalization: never mutate metadata or template definitions.
// Future fields and additional stat IDs survive ordinary enable/disable saves.
function readSingleState(saved) {
    if (!isObject(saved)) return createSingleState();
    if (isLegacyState(saved)) return migrateLegacy(saved);
    const base = createSingleState(getTemplate(saved.world?.templateId)?.id);
    const result = { ...base, ...copy(saved), enabled: saved.enabled === true };
    result.world = { ...base.world, ...(isObject(saved.world) ? saved.world : {}) };
    result.currency = { ...base.currency, ...(isObject(saved.currency) ? saved.currency : {}) };
    result.calendar = { ...base.calendar, ...(isObject(saved.calendar) ? saved.calendar : {}) };
    result.currency.amount = number(result.currency.amount, base.currency.amount);
    for (const key of ['id', 'label', 'symbol']) result.currency[key] = text(result.currency[key], base.currency[key]);
    for (const key of Object.keys(base.calendar)) result.calendar[key] = text(result.calendar[key], base.calendar[key]);
    const candidates = Array.isArray(saved.stats) ? saved.stats : base.stats;
    result.stats = candidates.filter(stat => isObject(stat) && typeof stat.id === 'string').map(stat => {
        const fallback = base.stats.find(item => item.id === stat.id);
        return {
            ...stat,
            label: text(stat.label, fallback?.label ?? stat.id),
            value: number(stat.value, fallback?.value ?? 0),
            max: number(stat.max, fallback?.max ?? 100),
        };
    });
    for (const key of ['inventory', 'relationships', 'skills', 'worldState']) {
        if (!isObject(result[key])) result[key] = {};
    }
    return result;
}

const personalFields = ['currency', 'stats', 'inventory', 'skills', 'relationships', 'personalState'];

export function createActor(templateId, descriptor, id) {
    const base = createSingleState(templateId);
    return {
        id, name: text(descriptor.name, '默认主角'),
        sourceType: descriptor.sourceType ?? 'custom', sourceId: descriptor.sourceId ?? null,
        avatar: descriptor.avatar ?? null,
        currency: base.currency, stats: base.stats, inventory: {}, skills: {}, relationships: {}, personalState: {},
        location: null, occupation: null, schedule: [], needs: {}, memory: [], flags: {},
    };
}

export function createState(templateId = DEFAULT_TEMPLATE_ID, enabled = false) {
    const base = createSingleState(templateId, enabled);
    return {
        schemaVersion: 3, enabled: base.enabled, world: base.world,
        calendar: base.calendar, worldState: {}, activeActorId: null, actors: {}, nextActorNumber: 1,
    };
}

export function needsMigration(saved) {
    return isObject(saved) && !Object.hasOwn(saved, 'actors')
        && (isLegacyState(saved) || Object.hasOwn(saved, 'currency') || Object.hasOwn(saved, 'stats'));
}

export function readState(saved, protagonist = { name: '默认主角', sourceType: 'custom' }) {
    if (!isObject(saved)) return createState();
    if (needsMigration(saved)) {
        const old = readSingleState(saved);
        const result = { ...copy(old), ...createState(getTemplate(old.world.templateId)?.id, old.enabled) };
        result.world = old.world;
        result.calendar = old.calendar;
        result.worldState = old.worldState;
        const actor = createActor(getTemplate(old.world.templateId)?.id, protagonist, 'actor_1');
        for (const key of personalFields) if (Object.hasOwn(old, key)) actor[key] = copy(old[key]);
        result.actors[actor.id] = actor;
        result.activeActorId = actor.id;
        result.nextActorNumber = 2;
        for (const key of personalFields) delete result[key];
        return result;
    }
    const result = { ...createState(getTemplate(saved.world?.templateId)?.id), ...copy(saved) };
    const normalized = readSingleState(saved);
    result.world = normalized.world;
    result.calendar = normalized.calendar;
    result.worldState = normalized.worldState;
    result.enabled = saved.enabled === true;
    result.actors = {};
    for (const [id, actor] of Object.entries(isObject(saved.actors) ? saved.actors : {})) {
        if (!isObject(actor) || !/^actor_[A-Za-z0-9_-]+$/.test(id)) continue;
        const base = createActor(getTemplate(result.world.templateId)?.id, actor, id);
        const values = readSingleState({ ...actor, world: result.world });
        result.actors[id] = { ...base, ...copy(actor), id, name: text(actor.name, '默认主角') };
        for (const key of personalFields) result.actors[id][key] = copy(values[key] ?? base[key]);
    }
    result.activeActorId = Object.hasOwn(result.actors, result.activeActorId)
        ? result.activeActorId : Object.keys(result.actors)[0] ?? null;
    for (const key of personalFields) delete result[key];
    return result;
}

// Commands mutate only the detached game value supplied by the UI.
export function addActor(game, descriptor) {
    if (descriptor.sourceType !== 'custom') {
        const duplicate = Object.values(game.actors).find(actor => actor.sourceType === descriptor.sourceType
            && actor.sourceId === descriptor.sourceId);
        if (duplicate) return null;
    }
    let serial = Number.isSafeInteger(game.nextActorNumber) && game.nextActorNumber > 0 ? game.nextActorNumber : 1;
    while (Object.hasOwn(game.actors, `actor_${serial}`)) serial++;
    const actor = createActor(game.world.templateId, descriptor, `actor_${serial}`);
    game.actors[actor.id] = actor;
    game.nextActorNumber = serial + 1;
    if (!game.activeActorId) game.activeActorId = actor.id;
    return actor;
}

export function selectActor(game, id) {
    if (!Object.hasOwn(game.actors, id)) return false;
    game.activeActorId = id;
    return true;
}

export function deleteActor(game, id) {
    if (!Object.hasOwn(game.actors, id)) return false;
    delete game.actors[id];
    if (game.activeActorId === id) game.activeActorId = Object.keys(game.actors)[0] ?? null;
    return true;
}

export function changeCurrency(game, delta) {
    const actor = game.actors[game.activeActorId];
    if (!actor || !Number.isFinite(delta) || !Number.isFinite(actor.currency.amount + delta)) return false;
    actor.currency.amount += delta;
    return true;
}

export function resetWorld(game, templateId) {
    const result = createState(templateId, game.enabled);
    result.nextActorNumber = game.nextActorNumber;
    for (const actor of Object.values(game.actors)) {
        result.actors[actor.id] = createActor(templateId, actor, actor.id);
    }
    result.activeActorId = Object.hasOwn(result.actors, game.activeActorId)
        ? game.activeActorId : Object.keys(result.actors)[0] ?? null;
    return result;
}
