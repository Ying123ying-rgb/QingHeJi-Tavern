import { DEFAULT_TEMPLATE_ID, worldTemplates } from '../data/world-templates.js';

export const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = value => JSON.parse(JSON.stringify(value));
const number = (value, fallback) => Number.isFinite(value) ? value : fallback;
const text = (value, fallback) => typeof value === 'string' ? value : fallback;
export const getTemplate = id => worldTemplates.find(template => template.id === id);

export function createState(templateId = DEFAULT_TEMPLATE_ID, enabled = false) {
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
    const result = { ...copy(saved), ...createState(DEFAULT_TEMPLATE_ID, saved.enabled) };
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
export function readState(saved) {
    if (!isObject(saved)) return createState();
    if (isLegacyState(saved)) return migrateLegacy(saved);
    const base = createState(getTemplate(saved.world?.templateId)?.id);
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
