// Data only. Add stats or future world definitions without changing the panel.
export const DEFAULT_TEMPLATE_ID = 'ancient_rural';
export const worldTemplates = [
    {
        id: 'ancient_rural', version: 1, displayName: '古代田园',
        currency: { id: 'money', label: '铜钱', symbol: '', amount: 100 },
        calendar: { dateLabel: '日期', date: '三月初一', timeLabel: '时辰', time: '辰时' },
        stats: [
            { id: 'stamina', label: '体力', value: 100, max: 100 },
            { id: 'satiety', label: '饱腹', value: 100, max: 100 },
        ],
        locations: [], items: [], shops: [], actions: [], recipes: [], events: [], rules: {}, aiContext: {},
    },
    {
        id: 'modern_city', version: 1, displayName: '现代都市',
        currency: { id: 'money', label: '余额', symbol: '¥', amount: 1000 },
        calendar: { dateLabel: '日期', date: '9月6日', timeLabel: '时间', time: '08:00' },
        stats: [
            { id: 'energy', label: '精力', value: 100, max: 100 },
            { id: 'satiety', label: '饱腹', value: 100, max: 100 },
            { id: 'mood', label: '心情', value: 80, max: 100 },
        ],
        locations: [], items: [], shops: [], actions: [], recipes: [], events: [], rules: {}, aiContext: {},
    },
    {
        id: 'sci_fi', version: 1, displayName: '星际时代',
        currency: { id: 'credits', label: '信用点', symbol: '', amount: 3000 },
        calendar: { dateLabel: '日期', date: '星历2387-104', timeLabel: '时间', time: '舰时08:00' },
        stats: [
            { id: 'action', label: '行动力', value: 100, max: 100 },
            { id: 'oxygen', label: '氧气', value: 100, max: 100 },
            { id: 'ship_energy', label: '舰船能源', value: 100, max: 100 },
        ],
        locations: [], items: [], shops: [], actions: [], recipes: [], events: [], rules: {}, aiContext: {},
    },
];

function freeze(value) {
    if (value && typeof value === 'object') {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
    return value;
}
freeze(worldTemplates);
