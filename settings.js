// Assigned to self because the content scripts can be injected twice into a page.
self.SmartBlurSettings = (function () {
    'use strict';

    const DEFAULTS = Object.freeze({
        globalEnabled: true,
        disabledSites: Object.freeze([]),
        spotlightSize: 170,
        blurStrength: 8,
        keepVideosClear: true,
        articleFocus: false,
        idleTimeout: 15000,
        panicEnabled: true
    });

    const RANGES = Object.freeze({
        spotlightSize: Object.freeze({ min: 60, max: 400, step: 10 }),
        blurStrength: Object.freeze({ min: 2, max: 24, step: 1 })
    });

    const IDLE_CHOICES = Object.freeze([0, 5000, 15000, 30000]);

    const KEYS = Object.freeze(Object.keys(DEFAULTS));

    function clampNumber(value, range, fallback) {
        const n = Number(value);
        if (value === null || value === undefined || !Number.isFinite(n)) return fallback;
        return Math.min(range.max, Math.max(range.min, Math.round(n)));
    }

    function normalize(raw) {
        const data = raw || {};
        const sites = Array.isArray(data.disabledSites)
            ? data.disabledSites.filter(function (s) { return typeof s === 'string' && s !== ''; })
            : [];
        const idle = Number(data.idleTimeout);

        return {
            globalEnabled: data.globalEnabled !== false,
            disabledSites: Array.from(new Set(sites)),
            spotlightSize: clampNumber(data.spotlightSize, RANGES.spotlightSize, DEFAULTS.spotlightSize),
            blurStrength: clampNumber(data.blurStrength, RANGES.blurStrength, DEFAULTS.blurStrength),
            keepVideosClear: data.keepVideosClear !== false,
            articleFocus: data.articleFocus === true,
            idleTimeout: data.idleTimeout !== undefined && IDLE_CHOICES.includes(idle)
                ? idle : DEFAULTS.idleTimeout,
            panicEnabled: data.panicEnabled !== false
        };
    }

    async function load() {
        return normalize(await chrome.storage.local.get(KEYS));
    }

    function save(patch) {
        return chrome.storage.local.set(patch);
    }

    function siteKeyFromUrl(url) {
        let parsed;
        try {
            parsed = new URL(url);
        } catch {
            return '';
        }
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.hostname;
        if (parsed.protocol === 'file:') return 'file://';
        return '';
    }

    function isActiveOn(settings, site) {
        return settings.globalEnabled && !settings.disabledSites.includes(site);
    }

    return Object.freeze({
        DEFAULTS,
        RANGES,
        IDLE_CHOICES,
        KEYS,
        normalize,
        load,
        save,
        siteKeyFromUrl,
        isActiveOn
    });
})();
