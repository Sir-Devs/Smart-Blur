(function () {
    'use strict';

    const Settings = self.SmartBlurSettings;

    const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    const ALT_NAME = /mac/i.test(platform) ? '⌥ Option' : 'Alt';

    const SLIDER_WRITE_MS = 90;

    const $ = function (id) { return document.getElementById(id); };
    const el = {
        globalEnabled: $('globalEnabled'),
        siteCard: $('siteCard'),
        siteTitle: $('siteTitle'),
        siteHint: $('siteHint'),
        siteToggle: $('siteToggle'),
        focusHowto: $('focusHowto'),
        idleTimeout: $('idleTimeout'),
        pausedBox: $('pausedBox'),
        pausedCount: $('pausedCount'),
        pausedList: $('pausedList'),
        shortcutKeys: $('shortcutKeys'),
        shortcutChange: $('shortcutChange'),
        version: $('version')
    };
    const sliders = Array.from(document.querySelectorAll('input[type="range"][data-key]'));
    const toggles = Array.from(document.querySelectorAll('input[type="checkbox"][data-key]'));

    let state = Settings.normalize({});
    let site = '';
    let siteKnown = false;
    const sliderTimers = new Map();

    function t(key, substitutions) {
        return chrome.i18n.getMessage(key, substitutions);
    }

    function localize() {
        const root = document.documentElement;
        root.lang = t('langCode') || 'en';
        root.dir = t('textDirection') || 'ltr';

        for (const node of document.querySelectorAll('[data-i18n]')) {
            node.textContent = t(node.dataset.i18n, [ALT_NAME]);
        }
        for (const node of document.querySelectorAll('[data-i18n-aria]')) {
            node.setAttribute('aria-label', t(node.dataset.i18nAria));
        }
        el.version.textContent = 'v' + chrome.runtime.getManifest().version;
    }

    function buildSliders() {
        for (const input of sliders) {
            const range = Settings.RANGES[input.dataset.key];
            input.min = range.min;
            input.max = range.max;
            input.step = range.step;
        }
    }

    function buildIdleChoices() {
        for (const ms of Settings.IDLE_CHOICES) {
            const label = document.createElement('label');
            const input = document.createElement('input');
            const text = document.createElement('span');

            input.type = 'radio';
            input.name = 'idleTimeout';
            input.value = String(ms);
            text.textContent = ms === 0 ? t('idleOff') : t('idleSeconds', [String(ms / 1000)]);

            label.append(input, text);
            el.idleTimeout.appendChild(label);
        }
    }

    async function renderShortcut() {
        const commands = await chrome.commands.getAll();
        const toggle = commands.find(function (c) { return c.name === 'toggle-global'; });
        const keys = toggle && toggle.shortcut;
        el.shortcutKeys.textContent = keys || t('shortcutNotSet');
    }

    function displaySite(key) {
        return key === 'file://' ? t('localFiles') : key;
    }

    function siteStatus() {
        if (!siteKnown) return 'loading';
        if (!site) return 'unavailable';
        if (!state.globalEnabled) return 'off';
        return state.disabledSites.includes(site) ? 'paused' : 'active';
    }

    function renderSite() {
        const status = siteStatus();
        el.siteCard.dataset.state = status;
        if (status === 'loading') {
            el.siteTitle.textContent = t('statusLoading');
            el.siteHint.textContent = '';
            el.siteToggle.hidden = true;
            return;
        }

        const name = displaySite(site);
        const titles = {
            active: t('statusActive', [name]),
            paused: t('statusPaused', [name]),
            off: t('statusOff'),
            unavailable: t('statusUnavailable')
        };
        const hints = {
            active: t('hintActive'),
            paused: t('hintPaused'),
            off: t('hintOff'),
            unavailable: t('hintUnavailable')
        };
        el.siteTitle.textContent = titles[status];
        el.siteTitle.title = titles[status];
        el.siteHint.textContent = hints[status];

        el.siteToggle.hidden = status === 'unavailable' || status === 'off';
        el.siteToggle.textContent = state.disabledSites.includes(site) ? t('resumeSite') : t('pauseSite');
    }

    function renderSlider(input) {
        const key = input.dataset.key;
        if (!sliderTimers.has(key)) input.value = state[key];
        updateSliderLabel(input);
    }

    function updateSliderLabel(input) {
        const min = Number(input.min);
        const max = Number(input.max);
        const value = Number(input.value);
        input.style.setProperty('--fill', ((value - min) / (max - min)) * 100 + '%');
        $(input.id + 'Value').textContent = value + ' px';
    }

    function renderPausedList() {
        const sites = state.disabledSites;
        el.pausedBox.hidden = sites.length === 0;
        el.pausedCount.textContent = String(sites.length);

        const items = sites.slice().sort().map(function (host) {
            const li = document.createElement('li');
            const name = document.createElement('span');
            const button = document.createElement('button');

            name.className = 'host';
            name.textContent = displaySite(host);
            button.type = 'button';
            button.dataset.site = host;
            button.textContent = t('resume');
            button.setAttribute('aria-label', t('resumeAria', [displaySite(host)]));

            li.append(name, button);
            return li;
        });
        el.pausedList.replaceChildren(...items);
    }

    function render() {
        el.globalEnabled.checked = state.globalEnabled;
        renderSite();

        sliders.forEach(renderSlider);
        for (const input of toggles) input.checked = state[input.dataset.key];
        el.focusHowto.hidden = !state.articleFocus;

        for (const radio of el.idleTimeout.querySelectorAll('input')) {
            radio.checked = Number(radio.value) === state.idleTimeout;
        }

        renderPausedList();
    }

    function setSitePaused(host, paused) {
        const others = state.disabledSites.filter(function (s) { return s !== host; });
        Settings.save({ disabledSites: paused ? others.concat([host]) : others });
    }

    function bindControls() {
        el.globalEnabled.addEventListener('change', function () {
            Settings.save({ globalEnabled: el.globalEnabled.checked });
        });

        el.siteToggle.addEventListener('click', function () {
            if (site) setSitePaused(site, !state.disabledSites.includes(site));
        });

        for (const input of sliders) {
            const key = input.dataset.key;

            input.addEventListener('input', function () {
                updateSliderLabel(input);
                if (sliderTimers.has(key)) return;
                sliderTimers.set(key, setTimeout(function () {
                    sliderTimers.delete(key);
                    Settings.save({ [key]: Number(input.value) });
                }, SLIDER_WRITE_MS));
            });

            input.addEventListener('change', function () {
                clearTimeout(sliderTimers.get(key));
                sliderTimers.delete(key);
                Settings.save({ [key]: Number(input.value) });
            });
        }

        for (const input of toggles) {
            input.addEventListener('change', function () {
                Settings.save({ [input.dataset.key]: input.checked });
            });
        }

        el.idleTimeout.addEventListener('change', function (event) {
            Settings.save({ idleTimeout: Number(event.target.value) });
        });

        el.pausedList.addEventListener('click', function (event) {
            const button = event.target.closest('button[data-site]');
            if (button) setSitePaused(button.dataset.site, false);
        });

        el.shortcutChange.addEventListener('click', function () {
            chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
        });
    }

    async function querySite() {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (!tab) return '';
        try {
            const reply = await chrome.tabs.sendMessage(tab.id, { type: 'smart-blur:status' }, { frameId: 0 });
            return reply && typeof reply.site === 'string' ? reply.site : '';
        } catch {
            return '';
        }
    }

    function onStorageChanged(changes, area) {
        if (area !== 'local') return;
        const patch = {};
        for (const key of Settings.KEYS) {
            if (key in changes) patch[key] = changes[key].newValue;
        }
        state = Settings.normalize(Object.assign({}, state, patch));
        render();
    }

    async function init() {
        localize();
        buildSliders();
        buildIdleChoices();
        bindControls();
        chrome.storage.onChanged.addListener(onStorageChanged);
        renderShortcut();

        const sitePromise = querySite();
        try {
            state = await Settings.load();
            render();
        } finally {
            requestAnimationFrame(function () { document.body.classList.add('ready'); });
        }

        site = await sitePromise;
        siteKnown = true;
        renderSite();
    }

    init();
})();
