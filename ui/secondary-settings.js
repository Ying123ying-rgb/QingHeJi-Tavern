import { channelDefaults, validateChannel, requestCompletion } from '../core/secondary-api.js';

export function mountSecondarySettings(root, { get, save, notice, signal }) {
    const node = (tag, label) => { const value = document.createElement(tag); if (label !== undefined) value.textContent = label; return value; };
    const button = (label, id, fn) => { const value = node('button', label); value.type = 'button'; value.id = id; value.className = 'qhjt-button'; value.addEventListener('click', fn, { signal }); return value; };
    const details = node('details'); details.id = 'qhjt-secondary'; details.append(node('summary', '副 API'));
    details.append(node('p', '启用后，仅将待扫描聊天文本及已知世界资料发送到所选渠道。密钥保存在本机酒馆扩展设置中，不进入聊天存档。'));
    const select = node('select'); select.id = 'qhjt-channel-select';
    const caption = node('label', '渠道列表'); caption.htmlFor = select.id;
    const form = node('form'); form.id = 'qhjt-channel-form';
    const inputs = {};
    for (const [key, label, type] of [['name', '渠道名', 'text'], ['baseUrl', 'API地址', 'url'], ['apiKey', 'API密钥', 'password'], ['model', '模型', 'text'], ['temperature', '温度', 'number'], ['maxTokens', '最大token', 'number'], ['timeout', '超时（秒）', 'number'], ['reasoning', '思考强度', 'select'], ['enabled', '启用', 'checkbox']]) {
        const input = node(type === 'select' ? 'select' : 'input'); input.id = `qhjt-api-${key}`;
        if (type !== 'select') input.type = type;
        if (type === 'number') input.step = key === 'temperature' ? '0.1' : '1';
        if (key === 'apiKey') { input.autocomplete = 'off'; input.setAttribute('spellcheck', 'false'); }
        if (type === 'select') for (const value of ['none', 'low', 'medium', 'high']) { const option = node('option', value); option.value = value; input.append(option); }
        const labelNode = node('label', label); labelNode.htmlFor = input.id; labelNode.className = 'qhjt-label';
        form.append(labelNode, input); inputs[key] = input;
    }
    let draft, testing;
    function load(id) {
        draft = { ...(get().channels ?? []).find(value => value.id === id) };
        if (!draft.id) draft = channelDefaults();
        for (const [key, input] of Object.entries(inputs)) { if (key === 'enabled') input.checked = draft[key] === true; else input.value = draft[key] ?? ''; }
    }
    function refresh() {
        const settings = get(); select.replaceChildren();
        for (const channel of settings.channels ?? []) {
            const option = node('option', `${channel.name}${channel.id === settings.activeChannelId ? '（当前）' : ''}`); option.value = channel.id; select.append(option);
        }
        select.value = settings.activeChannelId ?? settings.channels?.[0]?.id ?? ''; load(select.value);
    }
    function value() {
        const channel = { ...draft };
        for (const [key, input] of Object.entries(inputs)) channel[key] = key === 'enabled' ? input.checked : ['temperature', 'maxTokens', 'timeout'].includes(key) ? Number(input.value) : input.value.trim();
        return channel;
    }
    select.addEventListener('change', () => load(select.value), { signal });
    const add = button('＋添加渠道', 'qhjt-add-channel', () => {
        const settings = get(); let channel = channelDefaults();
        while (settings.channels?.some(old => old.id === channel.id)) channel.id += '_new';
        save({ ...settings, channels: [...(settings.channels ?? []), channel], activeChannelId: channel.id }); refresh();
    });
    const commit = button('保存并选用渠道', 'qhjt-save-channel', () => {}); commit.type = 'submit';
    form.addEventListener('submit', event => {
        event.preventDefault();
        try {
            const channel = value(); if (channel.enabled) validateChannel(channel);
            const settings = get(); const channels = [...(settings.channels ?? [])];
            const index = channels.findIndex(item => item.id === channel.id); if (index < 0) channels.push(channel); else channels[index] = channel;
            save({ channels, activeChannelId: channel.id }); refresh(); notice('副 API 配置已保存。');
        } catch (error) { notice(error.message); }
    }, { signal });
    const test = button('测试连接', 'qhjt-test-api', async () => {
        if (testing) return; testing = new AbortController(); test.disabled = true;
        const abort = () => testing?.abort(); signal.addEventListener('abort', abort, { once: true });
        try {
            await requestCompletion(value(), [{ role: 'user', content: 'Return only JSON: {"ok":true}' }], { signal: testing.signal });
            notice('连接成功，模型已返回文本。');
        } catch (error) { notice(error.message); }
        finally { signal.removeEventListener('abort', abort); testing = null; test.disabled = false; }
    });
    const remove = button('删除渠道', 'qhjt-delete-channel', () => {
        const settings = get(); const channels = (settings.channels ?? []).filter(channel => channel.id !== draft.id);
        save({ channels, activeChannelId: channels[0]?.id ?? null }); refresh();
    });
    form.append(commit, test, remove); details.append(caption, select, add, form); root.append(details); refresh();
}
