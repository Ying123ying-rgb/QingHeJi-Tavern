import { emptyWorldDelta, worldId } from './world-discovery.js';
import { actionName } from './actions.js';

/** DiscoveryProvider contract: extractDiscoveryCandidates(input) -> WorldDelta
 * or Promise<WorldDelta>. input is a detached snapshot of template, locations,
 * actions, controlledActor and messages [{role, text}]. No host API or save.
 */
export class DiscoveryProvider {
    extractDiscoveryCandidates(_input) { throw new Error('DiscoveryProvider 尚未实现。'); }
}

// Deliberately reject an entire sentence when tense, attribution or intent is
// ambiguous. These are grammatical/epistemic rules, never gameplay keywords.
const uncertain = /听说|据说|传闻|传说|听闻|听到|听见|说|表示|告诉|声称|计划|打算|准备|想|希望|以后|将来|明天|下次|有机会|如果|假如|假设|假定|要是|或许|可能|也许|似乎|仿佛|好像|曾经|曾|以前|过去|当年|昨天|回忆|记得|梦|幻觉|并非|没有|未|不|别|请|能否|是否|吗|差点|差一点|险些|快要|即将|只要|才能|就能|才可以|就可以|[?？“”"'「」『』`<>]/u;
const shortName = /^[\p{L}\p{N}_ -]{1,24}$/u;
const clean = text => actionName(text).replace(/[。！!]+$/u, '');
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class LocalDiscoveryProvider extends DiscoveryProvider {
    extractDiscoveryCandidates(input) {
        const delta = emptyWorldDelta();
        const locations = JSON.parse(JSON.stringify(input.locations ?? {}));
        const actions = JSON.parse(JSON.stringify(input.actions ?? {}));
        const actor = input.controlledActor;
        let locationId = actor?.locationId ?? null;
        const evidence = (type, label, sentence) => delta.discoveries.push({ type, label, evidence: sentence, confidence: 0.99, status: 'fact' });
        for (const message of input.messages ?? []) {
            if (!['user', 'assistant'].includes(message.role) || typeof message.text !== 'string' || message.text.length > 20000 || uncertain.test(message.text)) continue;
            for (const raw of message.text.split(/[。！!\n]+/u)) {
                const sentence = raw.trim();
                if (!sentence || uncertain.test(sentence)) continue;
                // Commas may connect facts, but an uncertainty anywhere above
                // invalidates all clauses in this sentence.
                for (const part of sentence.split(/[，,；;]+/u)) {
                    const clause = clean(part);
                    const subjects = ['我们', ...(actor?.name ? [escape(actor.name)] : [])];
                    if ((message.role === 'user' && actor?.sourceType === 'user') || (message.role === 'assistant' && actor?.sourceType === 'character')) subjects.push('我');
                    const subject = `(?:${subjects.join('|')})`;
                    const arrival = new RegExp(`^${subject}(?:终于|已经|现已)?(?:来到了|到达了|进入了|来到|到达|进入)(.+)$`, 'u').exec(clause)
                        ?? /^(?:我|我们)?在([\p{L}\p{N}_ -]{1,24})(?:转了转|逛了逛|活动了|停留了|走了走)$/u.exec(clause);
                    const discovery = new RegExp(`^${subject}(?:终于|已经)?发现了(?:地点|一处地点)[：:]?(.+)$`, 'u').exec(clause);
                    const match = arrival ?? discovery;
                    if (match && actor && shortName.test(match[1]) && !/的|了|可以|允许|并且|然后|正在|正要|之后|之前|时候|期间/u.test(match[1])) {
                        const name = clean(match[1]);
                        const old = Object.values(locations).find(value => actionName(value.label) === name);
                        const id = old?.id ?? worldId('location', name);
                        const value = { id, label: name, discovered: true, visited: Boolean(arrival) };
                        delta[old ? 'locationsToUpdate' : 'locationsToAdd'].push(value);
                        locations[id] = { ...old, ...value };
                        if (arrival) {
                            locationId = id;
                            delta.actorLocationChanges.push({ actorId: actor.id, locationId: id });
                        }
                        evidence('location', name, sentence);
                        continue;
                    }
                    const permission = /^(这里(?:可以|允许)|现在可以)([\p{L}\p{N}_ -]{1,24})$/u.exec(clause);
                    const learned = new RegExp(`^${subject}(?:已经)?学会了([\\p{L}\\p{N}_ -]{1,24})$`, 'u').exec(clause);
                    if (permission || learned) {
                        const here = permission?.[1].startsWith('这里');
                        if (here && (!locationId || !locations[locationId]?.discovered)) continue;
                        const name = clean(permission?.[2] ?? learned[1]);
                        if (/的|了|但是|而且|然后|或者|和|与/u.test(name)) continue;
                        const old = Object.values(actions).find(value => actionName(value.label) === name);
                        const id = old?.id ?? worldId('action', name);
                        const value = { id, label: name, locationIds: here ? [locationId] : [] };
                        delta[old ? 'actionsToUpdate' : 'actionsToAdd'].push(value); actions[id] = value;
                        if (here) delta.locationsToUpdate.push({ id: locationId, capabilities: [{ id: worldId('capability', name), label: name }], actions: [id] });
                        evidence('action', name, sentence);
                        continue;
                    }
                    // Explicit resource knowledge only; no guesses from scenery.
                    const resource = /^这里(?:有|发现了)资源[：:]?([\p{L}\p{N}_ -]{1,24})$/u.exec(clause);
                    if (resource && locationId && locations[locationId]?.discovered) {
                        const name = clean(resource[1]);
                        delta.locationsToUpdate.push({ id: locationId, resources: [{ id: worldId('resource', name), label: name, known: true }] });
                        evidence('resource', name, sentence);
                    }
                }
            }
        }
        return delta;
    }
}

export function extractDiscoveryCandidates(input, provider = new LocalDiscoveryProvider()) {
    // Even an async future provider cannot mutate the caller's snapshot.
    return provider.extractDiscoveryCandidates(JSON.parse(JSON.stringify(input)));
}

export const SECONDARY_DISCOVERY_CONTRACT = Object.freeze({
    input: ['worldTemplate', 'locations', 'actions', 'controlledActor', 'messages'],
    output: Object.keys(emptyWorldDelta()),
    instruction: '只提取最近一轮 user + assistant 中已发生且明确确认的世界事实。输出严格 World Delta JSON。区分计划、传闻、假设、回忆与事实；不确定则忽略。不得改变货币、背包数量、技能数值或决定重大剧情。每条自动发现附 status=fact、confidence 与原文 evidence。',
});
