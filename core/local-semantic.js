import { LocalDiscoveryProvider } from './discovery-provider.js';
import { emptySemanticDelta } from './semantic-state.js';

// Fallback only: explicit local grammar, never a list of world-specific nouns.
export class LocalSemanticProvider {
    extractDiscoveryCandidates(input) {
        const result = emptySemanticDelta();
        const world = new LocalDiscoveryProvider().extractDiscoveryCandidates(input);
        const ref = evidence => {
            const message = input.messages.find(message => message.text.includes(evidence));
            return { messageId: message?.id, evidence, confidence: 0.99 };
        };
        for (const location of [...world.locationsToAdd, ...world.locationsToUpdate].filter(value => value.label)) {
            const evidence = world.discoveries.find(item => item.type === 'location' && item.label === location.label)?.evidence;
            if (evidence) result.locations.push({ id: location.id, label: location.label, status: location.visited ? 'visited' : 'discovered', ...ref(evidence) });
        }
        for (const change of world.actorLocationChanges) {
            const location = result.locations.find(item => item.id === change.locationId);
            if (location) result.actorLocation = { locationId: location.id, messageId: location.messageId, evidence: location.evidence, confidence: 0.99 };
        }
        for (const action of [...world.actionsToAdd, ...world.actionsToUpdate]) {
            const evidence = world.discoveries.find(item => item.type === 'action' && item.label === action.label)?.evidence;
            if (evidence) result.actions.push({ ...action, label: action.label.replace(/赚钱$/u, ''), ...ref(evidence) });
        }
        for (const update of world.locationsToUpdate.filter(value => !value.label)) {
            const evidence = world.discoveries.find(item => ['resource', 'action'].includes(item.type))?.evidence;
            if (evidence) result.locationUpdates.push({ id: update.id, resources: update.resources?.map(({ id, label }) => ({ id, label })) ?? [],
                capabilities: update.capabilities ?? [], services: [], ...ref(evidence) });
        }
        for (const message of input.messages) {
            if (/听说|据说|明天|以后|将来|想|如果|可能|好像|没有|回忆|曾经|[?？“”"`]/u.test(message.text)) continue;
            const inventoryList = /清点物资|清点家当|盘点物资/u.test(message.text);
            for (const part of message.text.split(/[。\n，,；;]+/u)) {
                const clause = part.trim().replace(/^(?:清点物资|清点家当|盘点物资)[：:]?\s*/u, '');
                const counted = inventoryList ? /^([\p{L}]{1,24})\s*[×xX*]\s*(\d+(?:\.\d+)?)([\p{L}]{0,8})$/u.exec(clause) : null;
                const gained = /^(?:我|我们)?(?:捡到|获得|收集到|得到)([\p{L}]{1,24}?)(\d+(?:\.\d+)?)([\p{L}]{0,8})$/u.exec(clause);
                const total = /^(?:共|总共)(?:捡到|获得|有)(\d+(?:\.\d+)?)(?:份|个|件|瓶|斤)([\p{L}]{1,24})$/u.exec(clause);
                const unknown = /^(?:我|我们)?(?:捡了|捡到|获得了|收集了)(?:一些|点|一点)([\p{L}]{1,24})$/u.exec(clause);
                const proof = { messageId: message.id, evidence: part.trim(), confidence: 0.99 };
                if (counted || gained) {
                    const match = counted ?? gained;
                    result.inventory[counted ? 'set' : 'add'].push({ label: match[1], quantity: Number(match[2]), quantityKnown: true, unit: match[3], ...proof });
                } else if (total) result.inventory.set.push({ label: total[2], quantity: Number(total[1]), quantityKnown: true, ...proof });
                else if (unknown && !/东西|物资|物品/u.test(unknown[1])) result.inventory.add.push({ label: unknown[1], quantity: null, quantityKnown: false, ...proof });
            }
        }
        return result;
    }
}
