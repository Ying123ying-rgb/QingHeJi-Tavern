// UI only: no game data or persistence. The caller owns update/render operations.
export function mountFloatingPanel(status, handlers) {
    const controller = new AbortController();
    const signal = controller.signal;
    const node = (tag, text, className) => {
        const value = document.createElement(tag);
        if (text !== undefined) value.textContent = text;
        if (className) value.className = className;
        return value;
    };
    const listen = (target, event, handler) => target?.addEventListener(event, handler, { signal });
    const button = (text, id, handler) => {
        const value = node('button', text, 'qhjt-button');
        value.type = 'button'; value.id = id;
        listen(value, 'click', handler);
        return value;
    };
    const host = node('div'); host.id = 'qhjt-host'; host.hidden = true;
    const entry = button('人生', 'qhjt-entry', handlers.open);
    entry.setAttribute('aria-controls', 'qhjt-overlay');
    entry.setAttribute('aria-expanded', 'false');
    entry.setAttribute('aria-haspopup', 'dialog');
    host.append(entry);
    document.body.append(host);
    const overlay = node('dialog'); overlay.id = 'qhjt-overlay';
    overlay.setAttribute('aria-labelledby', 'qhjt-title');
    const panel = node('section', undefined, 'qhjt-panel'); panel.id = 'qhjt-panel'; panel.hidden = true;
    const header = node('header', undefined, 'qhjt-panel-header');
    const title = node('h3', '酒馆人生模拟器'); title.id = 'qhjt-title';
    const close = button('× 关闭', 'qhjt-close', () => handlers.close(true));
    header.append(title, close);
    const values = node('dl', undefined, 'qhjt-values qhjt-summary'); values.id = 'qhjt-summary';
    const tabs = node('nav', undefined, 'qhjt-tabs'); tabs.setAttribute('aria-label', '模拟器页面');
    tabs.setAttribute('role', 'tablist');
    const scroll = node('div', undefined, 'qhjt-scroll'); scroll.id = 'qhjt-scroll';
    const pages = {}, tabButtons = {};
    let activeTab = 'state';
    function selectTab(id) {
        if (!pages[id]) return;
        activeTab = id;
        for (const key of Object.keys(pages)) {
            pages[key].hidden = key !== id;
            tabButtons[key].setAttribute('aria-selected', String(key === id));
            tabButtons[key].tabIndex = key === id ? 0 : -1;
        }
        scroll.scrollTop = 0;
    }
    for (const [id, label] of [['state', '状态'], ['actions', '行动'], ['locations', '地点'], ['actors', '人物'], ['settings', '设置']]) {
        const page = node('section'); page.id = `qhjt-page-${id}`;
        page.setAttribute('role', 'tabpanel'); page.setAttribute('aria-labelledby', `qhjt-tab-${id}`);
        const tab = button(label, `qhjt-tab-${id}`, () => selectTab(id));
        tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', page.id);
        pages[id] = page; tabButtons[id] = tab; tabs.append(tab); scroll.append(page);
    }
    listen(tabs, 'keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const ids = Object.keys(pages), index = ids.indexOf(activeTab);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1
            : (index + (event.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
        event.preventDefault(); selectTab(ids[next]); tabButtons[ids[next]].focus();
    });
    const worldValues = node('dl', undefined, 'qhjt-values'); worldValues.id = 'qhjt-world-values';
    const actorValues = node('dl', undefined, 'qhjt-values'); actorValues.id = 'qhjt-actor-values';
    const plus = button('货币 +100', 'qhjt-plus', () => handlers.currency(100));
    const minus = button('货币 -100', 'qhjt-minus', () => handlers.currency(-100));
    const testButtons = node('div', undefined, 'qhjt-actions'); testButtons.append(plus, minus);
    const control = button('切换到我', 'qhjt-control', handlers.control);
    pages.state.append(control, node('h3', '世界状态'), worldValues, node('h3', '当前操作角色状态'), actorValues,
        node('h3', '测试修改'), testButtons);
    const select = (id, label, page) => {
        const caption = node('label', label, 'qhjt-label'); caption.htmlFor = id;
        const input = node('select'); input.id = id; page.append(caption, input); return input;
    };
    const addCharacter = button('添加当前角色', 'qhjt-add-character', () => handlers.add('character'));
    const addUser = button('添加“我”', 'qhjt-add-user', () => handlers.add('user'));
    const addCustom = button('添加自定义人物', 'qhjt-add-custom', () => handlers.add('custom'));
    const addButtons = node('div', undefined, 'qhjt-actions'); addButtons.append(addCharacter, addUser, addCustom);
    const actorList = node('div'); actorList.id = 'qhjt-actors';
    const detail = node('section'); detail.id = 'qhjt-actor-detail'; detail.hidden = true;
    const detailValues = node('dl', undefined, 'qhjt-values'); detailValues.id = 'qhjt-detail-values';
    const detailClose = button('关闭人物详情', 'qhjt-detail-close', () => { detail.hidden = true; });
    detail.append(node('h3', '人物详情'), node('p', '此处仅查看人物状态，行动仍由当前操作角色执行。'), detailValues, detailClose);
    const nameForm = node('form'); nameForm.id = 'qhjt-name-form'; nameForm.hidden = true;
    const nameLabel = node('label', '人物名称', 'qhjt-label'); nameLabel.htmlFor = 'qhjt-name';
    const nameInput = node('input'); nameInput.id = 'qhjt-name'; nameInput.type = 'text'; nameInput.required = true;
    const extraLabel = node('label', '', 'qhjt-label'); extraLabel.htmlFor = 'qhjt-name-extra'; extraLabel.hidden = true;
    const extraInput = node('input'); extraInput.id = 'qhjt-name-extra'; extraInput.type = 'text'; extraInput.hidden = true;
    const nameOk = button('确定', 'qhjt-name-ok', () => {}); nameOk.type = 'submit';
    const nameCancel = button('取消', 'qhjt-name-cancel', () => finishName(null));
    const nameActions = node('div', undefined, 'qhjt-actions'); nameActions.append(nameOk, nameCancel);
    nameForm.append(nameLabel, nameInput, extraLabel, extraInput, nameActions);
    pages.actors.append(node('p', '点击人物名称查看状态。当前操作角色不会随查看对象改变。'), addButtons, nameForm, actorList, detail);
    let resolveName;
    function finishName(value) {
        nameForm.hidden = true;
        const resolve = resolveName; resolveName = undefined; resolve?.(value);
    }
    function requestName(label, initial = '', page = 'actors', extra = '') {
        finishName(null); pages[page].append(nameForm); selectTab(page);
        extraLabel.textContent = extra; extraLabel.hidden = extraInput.hidden = !extra; extraInput.value = '';
        nameLabel.textContent = label; nameInput.value = initial; nameForm.hidden = false;
        nameInput.focus(); nameForm.scrollIntoView({ block: 'nearest' });
        return new Promise(resolve => { resolveName = resolve; });
    }
    listen(nameForm, 'submit', event => {
        event.preventDefault();
        if (!nameInput.value.trim()) { nameInput.focus(); return; }
        finishName(extraInput.hidden ? nameInput.value.trim() : { name: nameInput.value.trim(), extra: extraInput.value.trim() });
    });
    const actionList = node('div', undefined, 'qhjt-card-grid'); actionList.id = 'qhjt-action-list';
    const actionScope = select('qhjt-action-scope', '行动范围', pages.actions);
    for (const [value, text] of [['current', '当前位置行动'], ['all', '全部行动']]) {
        const option = node('option', text); option.value = value; actionScope.append(option);
    }
    actionScope.value = 'current'; listen(actionScope, 'change', handlers.update);
    const addAction = button('＋添加行动', 'qhjt-add-action', handlers.addAction);
    pages.actions.append(actionList, addAction);
    const locationCurrent = node('p'); locationCurrent.id = 'qhjt-location-current';
    const locationList = node('div', undefined, 'qhjt-card-grid'); locationList.id = 'qhjt-location-list';
    const addLocation = button('＋添加地点', 'qhjt-add-location', handlers.addLocation);
    const locationDetail = node('section', undefined, 'qhjt-card'); locationDetail.id = 'qhjt-location-detail'; locationDetail.hidden = true;
    pages.locations.append(locationCurrent, node('h3', '已发现地点'), locationList, addLocation, locationDetail);
    const world = select('qhjt-world', '当前聊天世界模板', pages.settings);
    listen(world, 'change', handlers.world);
    pages.settings.append(node('p', '游戏模式：已开启'), node('p', 'AI设置、显示设置、存档管理：未来开放。'));
    const discoveryHistory = node('details'); discoveryHistory.id = 'qhjt-discovery-history';
    const discoveryLog = node('div'); discoveryLog.id = 'qhjt-discovery-log';
    const undoDiscovery = button('撤销最近自动发现', 'qhjt-undo-discovery', handlers.undoDiscovery);
    discoveryHistory.append(node('summary', '发现记录'), discoveryLog);
    pages.settings.append(undoDiscovery, discoveryHistory);
    const debug = node('details'); debug.id = 'qhjt-debug';
    const info = node('p', undefined, 'qhjt-info');
    debug.append(node('summary', '调试信息'), info); pages.settings.append(debug);
    scroll.append(status);
    panel.append(header, values, tabs, scroll); overlay.append(panel); document.body.append(overlay);
    listen(overlay, 'click', event => { if (event.target === overlay) handlers.close(true); });
    listen(overlay, 'cancel', event => { event.preventDefault(); handlers.close(true); });
    let unlock;
    function unlockScroll() { unlock?.(); unlock = undefined; }
    listen(overlay, 'close', () => { if (!overlay.open) handlers.close(false); });
    function open() {
        if (overlay.open) return;
        panel.hidden = false;
        overlay.showModal();
        // The native modal traps focus/inerts the background. Lock its scroll too.
        const targets = [document.documentElement, document.body, document.getElementById('chat')].filter(Boolean);
        const previous = targets.map(target => [target, target.style.overflow, target.style.overscrollBehavior]);
        for (const target of targets) { target.style.overflow = 'hidden'; target.style.overscrollBehavior = 'none'; }
        unlock = () => { for (const [target, overflow, overscroll] of previous) {
            target.style.overflow = overflow; target.style.overscrollBehavior = overscroll;
        } };
        entry.setAttribute('aria-expanded', 'true'); position(); close.focus();
    }
    function hide(focus = false) {
        detail.hidden = true;
        locationDetail.hidden = true;
        finishName(null); if (overlay.open) overlay.close();
        panel.hidden = true; unlockScroll(); entry.setAttribute('aria-expanded', 'false');
        if (focus && !host.hidden && host.isConnected) entry.focus();
    }
    function position() {
        const viewport = globalThis.visualViewport;
        const top = viewport?.offsetTop ?? 0, height = viewport?.height ?? globalThis.innerHeight;
        const left = viewport?.offsetLeft ?? 0, width = viewport?.width ?? globalThis.innerWidth;
        overlay.style.top = `${top}px`; overlay.style.left = `${left}px`;
        overlay.style.width = `${width}px`; overlay.style.height = `${height}px`;
        const inputTop = document.getElementById('form_sheld')?.getBoundingClientRect().top;
        const bottom = Number.isFinite(inputTop) && inputTop > top && inputTop <= top + height
            ? inputTop : top + height;
        entry.style.top = `${Math.max(top + 8, bottom - 100 - 48)}px`;
        entry.style.left = `${Math.max(left + 8, left + width - 60)}px`;
        if (!nameForm.hidden) nameForm.scrollIntoView({ block: 'nearest' });
    }
    listen(globalThis, 'resize', position);
    listen(globalThis.visualViewport, 'resize', position);
    listen(globalThis.visualViewport, 'scroll', position);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(position) : null;
    const chat = document.getElementById('chat'); if (chat) observer?.observe(chat);
    const input = document.getElementById('form_sheld'); if (input) observer?.observe(input);
    selectTab('state'); position();
    return { host, entry, overlay, panel, close, values, worldValues, actorValues, plus, minus, world,
        actionList, actionScope, addAction, locationCurrent, locationList, locationDetail, addLocation, discoveryLog, undoDiscovery,
        actorList, addCharacter, addUser, addCustom, control,
        detail, detailValues, info, controller, requestName,
        openFloating: open, closeFloating: hide, positionFloating: position,
        destroyFloating() { hide(); controller.abort(); observer?.disconnect(); host.remove(); overlay.remove(); },
    };
}
