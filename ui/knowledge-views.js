import { inventoryCategories, knownNpcs } from '../core/semantic-state.js';

export function renderKnowledge(game, ui, { button, element, editItem, addItem, editNpc, addNpc, userName }) {
    const quantity = item => item.quantityKnown ? `${item.quantity}${item.unit ?? ''}` : '数量未知';
    const section = (parent, title, content) => parent.append(element('h3', title), element('p', content || '尚不了解'));
    ui.inventoryList.replaceChildren();
    const items = Object.values(game.inventory).filter(item => (!item.quantityKnown || item.quantity > 0) && (ui.inventoryFilter.value === 'all' || item.category === ui.inventoryFilter.value));
    if (!items.length) ui.inventoryList.append(element('p', '当前没有记录的物资。'));
    for (const item of items) {
        const show = button(`${item.label} × ${quantity(item)}`, () => {
            ui.inventoryDetail.hidden = false; ui.inventoryDetail.replaceChildren();
            section(ui.inventoryDetail, item.label, `数量：${quantity(item)}`);
            section(ui.inventoryDetail, '类别', inventoryCategories[item.category] ?? item.category);
            section(ui.inventoryDetail, '已知描述', item.description);
            section(ui.inventoryDetail, '来源记录', item.sourceRefs.map(ref => `${ref.messageId}：${ref.evidence}`).join('\n'));
            ui.inventoryDetail.append(button('手动修改数量', () => editItem(item)), button('关闭详情', () => { ui.inventoryDetail.hidden = true; }));
            ui.inventoryDetail.scrollIntoView({ block: 'nearest' });
        }, `qhjt-item-${item.id}`);
        ui.inventoryList.append(show);
    }
    ui.npcList.replaceChildren();
    const npcs = knownNpcs(game, userName);
    if (!npcs.length) ui.npcList.append(element('p', '当前还没有认识的人。'));
    for (const npc of npcs) {
        ui.npcList.append(button(npc.name, () => {
            ui.npcDetail.hidden = false; ui.npcDetail.replaceChildren();
            ui.npcDetail.append(element('h3', npc.name), element('p', `资料解锁进度：${npc.knowledgeProgress ?? 0}%（非好感度）`));
            const facts = values => values.map(fact => fact.text).join('、');
            section(ui.npcDetail, '容貌', facts(npc.appearance.facts));
            section(ui.npcDetail, '基础信息', [['性别', 'gender'], ['年龄', 'age'], ['职业', 'occupation'], ['身份', 'identity']].map(([label, key]) => `${label}：${npc.basicInfo[key] ?? '???'}`).join('\n'));
            section(ui.npcDetail, '与你的关系', npc.relationship.label);
            section(ui.npcDetail, '性格', `已确认：${facts(npc.personality.confirmed) || '尚不了解'}\n印象候选：${npc.personality.impressions.map(fact => `${fact.text}（${fact.evidenceCount} 次证据）`).join('、') || '尚不了解'}`);
            section(ui.npcDetail, '喜好与厌恶', `喜好：${facts(npc.preferences.likes) || '???'}\n厌恶：${facts(npc.preferences.dislikes) || '???'}`);
            section(ui.npcDetail, '已知经历', facts(npc.history));
            section(ui.npcDetail, '当前位置', game.locations[npc.currentLocationId]?.label);
            const selector = element('select'); selector.id = 'qhjt-npc-field';
            for (const [key, label] of [['name', '姓名'], ['appearance', '容貌'], ['gender', '性别'], ['age', '年龄'], ['occupation', '职业'], ['identity', '身份'], ['relationship', '关系'], ['personality', '性格'], ['likes', '喜好'], ['dislikes', '厌恶'], ['history', '经历']]) {
                const option = element('option', label); option.value = key; selector.append(option);
            }
            selector.value = 'appearance';
            ui.npcDetail.append(selector, button('手动修正资料', () => editNpc(npc, selector.value)), button('关闭详情', () => { ui.npcDetail.hidden = true; }));
            ui.npcDetail.scrollIntoView({ block: 'nearest' });
        }, `qhjt-npc-${npc.id}`));
    }
}
