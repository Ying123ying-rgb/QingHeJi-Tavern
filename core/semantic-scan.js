import { prepareMessages } from './semantic-state.js';
import { getTemplate } from './game-state.js';

export function semanticInput(game, ctx, messages, controlledActor) {
    const locations = Object.fromEntries(Object.values(game.locations).map(location => [location.id, {
        id: location.id, label: location.label, discovered: location.discovered, visited: location.visited,
        capabilities: location.capabilities, resources: location.resources, services: location.services,
    }]));
    return { worldTemplate: { ...getTemplate(game.world.templateId), ...game.world }, locations, actions: Object.fromEntries(Object.values(game.actions).map(action => [action.id, { id: action.id, label: action.label, locationIds: action.locationIds }])),
        inventory: Object.values(game.inventory).map(item => ({ id: item.id, label: item.label, quantity: item.quantity, quantityKnown: item.quantityKnown, unit: item.unit })),
        npcs: Object.values(game.npcs).map(npc => ({ id: npc.id, name: npc.name, encountered: npc.encountered, known: npc.known })),
        controlledActor: controlledActor ? { id: controlledActor.id, name: controlledActor.name, sourceType: controlledActor.sourceType, locationId: controlledActor.locationId } : null,
        userName: ctx.name1 ?? '我', messages };
}
export function syncBatches(chat, game, range = '30', reanalyze = false) {
    const all = prepareMessages(chat);
    const count = ['10', '30', '50'].includes(String(range)) ? Number(range) : range === 'all' ? all.length : 30;
    const selected = all.slice(-count);
    const rounds = [...new Set(selected.map(message => message.roundId))];
    const batches = [];
    for (const round of rounds) {
        const messages = all.filter(message => message.roundId === round);
        if (!reanalyze && messages.every(message => game.processedMessageIds[message.id]?.hashes.includes(message.hash))) continue;
        // Keep user and corresponding assistant together. Large rounds are not
        // silently truncated; the UI can report the limit without marking them.
        if (messages.reduce((size, message) => size + message.text.length, 0) > 60000) throw new Error('单轮聊天过长，请先缩短消息或手动补录；未截断或标记处理。');
        batches.push(messages);
    }
    return batches;
}
