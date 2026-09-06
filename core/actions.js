// Chat-owned data only. Execution fields are opaque and preserved by readState.
export const actionName = value => typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/gu, ' ') : '';
export function listActions(game) {
    return Object.values(game.actions).filter(value => value && typeof value === 'object' && typeof value.label === 'string');
}
export function findAction(game, name) {
    const key = actionName(name).toLowerCase();
    return listActions(game).find(action => actionName(action.label).toLowerCase() === key);
}
export function addAction(game, name) {
    const label = actionName(name);
    if (!label) throw new Error('行动名称不能为空。');
    if (findAction(game, label)) throw new Error('当前聊天已有同名行动。');
    // Deterministic, collision-free encoding of the normalized name; never reused
    // over an existing imported ID. Once saved, the ID is not regenerated.
    const base = 'action_' + Array.from(label.toLowerCase(), char => char.codePointAt(0).toString(16)).join('_');
    let id = base, suffix = 2;
    while (Object.hasOwn(game.actions, id)) id = `${base}_${suffix++}`;
    const action = { id, label, enabled: true, temporary: true, source: 'user', locationIds: [], metadata: {} };
    game.actions[id] = action;
    return action;
}
export function removeAction(game, name) {
    const action = findAction(game, name);
    if (!action) throw new Error('当前聊天没有该行动。');
    const key = Object.keys(game.actions).find(key => game.actions[key] === action);
    delete game.actions[key];
    for (const location of Object.values(game.locations ?? {})) location.actions = (location.actions ?? []).filter(id => id !== key);
    return action;
}
