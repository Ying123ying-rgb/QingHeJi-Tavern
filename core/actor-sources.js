// Read only the public Context's identity fields, never card definitions.
export function currentCharacter(ctx) {
    const character = ctx.characters?.[ctx.characterId];
    // characterId is an array index. The card filename survives array reordering.
    if (!character || typeof character.avatar !== 'string' || !character.avatar) return null;
    return {
        name: typeof character.name === 'string' && character.name.trim() ? character.name : '未命名角色',
        sourceType: 'character', sourceId: character.avatar, avatar: character.avatar,
    };
}

export function currentUser(ctx) {
    return {
        name: typeof ctx.name1 === 'string' && ctx.name1.trim() ? ctx.name1 : '我',
        sourceType: 'user', sourceId: 'self', avatar: null,
    };
}
