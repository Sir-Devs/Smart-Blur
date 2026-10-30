// Assigned to self because the content scripts can be injected twice into a page.
self.SmartBlurSettings = (function () {
    'use strict';

    const SHAPES = Object.freeze(['circle', 'band', 'block']);

    const DEFAULTS = Object.freeze({
        globalEnabled: true,
        disabledSites: Object.freeze([]),
        spotlightShape: 'circle',
        spotlightSize: 170,
        blurStrength: 8,
        keepVideosClear: true,
        keepTypingClear: true,
        articleFocus: false,
        idleTimeout: 15000,
        panicEnabled: true
    });

    const RANGES = Object.freeze({
        spotlightSize: Object.freeze({ min: 40, max: 400, step: 10 }),
        blurStrength: Object.freeze({ min: 2, max: 24, step: 1 })
    });

    const IDLE_CHOICES = Object.freeze([0, 5000, 15000, 30000]);

    const KEYS = Object.freeze(Object.keys(DEFAULTS));

    // Site rules are host names, or "*.example.com" for a domain and all its subdomains.
    const RULE_PATTERN = /^(\*\.)?([a-z0-9-]+\.)*[a-z0-9-]+$|^file:\/\/$/;

    function clampNumber(value, range, fallback) {
        const n = Number(value);
        if (value === null || value === undefined || !Number.isFinite(n)) return fallback;
        return Math.min(range.max, Math.max(range.min, Math.round(n)));
    }

    function normalizeRule(rule) {
        if (typeof rule !== 'string') return '';
        const value = rule.trim().toLowerCase();
        return RULE_PATTERN.test(value) ? value : '';
    }

    function normalize(raw) {
        const data = raw || {};
        const sites = Array.isArray(data.disabledSites)
            ? data.disabledSites.map(normalizeRule).filter(Boolean)
            : [];
        const idle = Number(data.idleTimeout);

        return {
            globalEnabled: data.globalEnabled !== false,
            disabledSites: Array.from(new Set(sites)),
            spotlightShape: SHAPES.includes(data.spotlightShape) ? data.spotlightShape : DEFAULTS.spotlightShape,
            spotlightSize: clampNumber(data.spotlightSize, RANGES.spotlightSize, DEFAULTS.spotlightSize),
            blurStrength: clampNumber(data.blurStrength, RANGES.blurStrength, DEFAULTS.blurStrength),
            keepVideosClear: data.keepVideosClear !== false,
            keepTypingClear: data.keepTypingClear !== false,
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

    function ruleMatches(rule, site) {
        if (rule.startsWith('*.')) {
            const domain = rule.slice(2);
            return site === domain || site.endsWith('.' + domain);
        }
        return rule === site;
    }

    function matchingRules(settings, site) {
        return settings.disabledSites.filter(function (rule) { return ruleMatches(rule, site); });
    }

    function isActiveOn(settings, site) {
        return settings.globalEnabled && matchingRules(settings, site).length === 0;
    }

    // Without the public suffix list this is a heuristic: "a.b.co.uk" -> "b.co.uk".
    function registrableDomain(host) {
        if (!host || host === 'file://' || /^[\d.]+$/.test(host) || host.includes(':')) return host;
        const parts = host.split('.');
        if (parts.length <= 2) return host;
        const sld = parts[parts.length - 2];
        const tld = parts[parts.length - 1];
        const take = tld.length === 2 && /^(co|com|org|net|gov|edu|ac|or|ne|go)$/.test(sld) ? 3 : 2;
        return parts.slice(-take).join('.');
    }

    return Object.freeze({
        SHAPES,
        DEFAULTS,
        RANGES,
        IDLE_CHOICES,
        KEYS,
        normalize,
        normalizeRule,
        load,
        save,
        siteKeyFromUrl,
        ruleMatches,
        matchingRules,
        isActiveOn,
        registrableDomain
    });
})();
