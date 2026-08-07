/* ============================================================================
   Smart Blur — service worker
   ----------------------------------------------------------------------------
   Developed by Ahmad Alhalabi — https://ahmadalhalabi.com/
   Copyright (c) 2025-2026 Ahmad Alhalabi. All rights reserved.
   Released under the MIT License. See LICENSE for details.
   ========================================================================== */

const DEFAULTS = {
    globalEnabled: true,
    disabledSites: [],
    spotlightSize: 170,
    blurVideos: false,
    articleFocus: false,
    idleTimeout: 15000,
    panicEnabled: true
};

chrome.runtime.onInstalled.addListener(function () {
    chrome.storage.local.get(Object.keys(DEFAULTS), function (data) {
        const missing = {};

        Object.keys(DEFAULTS).forEach(function (key) {
            if (data[key] === undefined) missing[key] = DEFAULTS[key];
        });

        if (Object.keys(missing).length > 0) {
            chrome.storage.local.set(missing);
        }
    });

    console.log('Smart Blur installed and ready.');
});

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    if (changeInfo.status !== 'complete' || !tab.url) return;

    let currentSite;
    try {
        currentSite = new URL(tab.url).hostname;
    } catch (error) {
        return;
    }

    chrome.storage.local.get(['globalEnabled', 'disabledSites'], function (data) {
        const globalEnabled = data.globalEnabled !== false;
        const disabledSites = data.disabledSites || [];

        if (globalEnabled && !disabledSites.includes(currentSite)) {
            chrome.tabs.sendMessage(tabId, {
                action: 'updateEffect',
                globalEnabled: globalEnabled,
                disabledSites: disabledSites
            }).catch(function () {

            });
        }
    });
});

chrome.storage.onChanged.addListener(function (changes, namespace) {
    if (namespace !== 'local') return;
    if (!changes.globalEnabled && !changes.disabledSites) return;

    chrome.tabs.query({}, function (tabs) {
        tabs.forEach(function (tab) {
            if (!tab.id || !tab.url || !tab.url.startsWith('http')) return;
            chrome.tabs.sendMessage(tab.id, { action: 'updateEffect' }).catch(function () {});
        });
    });
});
