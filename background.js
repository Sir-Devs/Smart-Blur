importScripts('settings.js');

const Settings = self.SmartBlurSettings;

const BADGE_OFF = 'OFF';
// Chrome's own pages and the Web Store: no extension may run there, so don't imply protection.
const BADGE_UNAVAILABLE = '–';
const BADGE_COLOR = '#5B6170';

function badgeTextFor(url, settings) {
    const site = Settings.siteKeyFromUrl(url || '');
    if (!site) return BADGE_UNAVAILABLE;
    return Settings.isActiveOn(settings, site) ? '' : BADGE_OFF;
}

async function refreshBadge(tab, settings) {
    const current = settings || await Settings.load();
    try {
        await chrome.action.setBadgeText({
            tabId: tab.id,
            text: badgeTextFor(tab.pendingUrl || tab.url, current)
        });
    } catch {}
}

async function refreshAllBadges() {
    const [settings, tabs] = await Promise.all([Settings.load(), chrome.tabs.query({})]);
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
    await Promise.all(tabs.map(function (tab) { return refreshBadge(tab, settings); }));
}

// Content scripts only reach pages loaded after install, so tabs that were already open get them here.
async function injectIntoOpenTabs() {
    const tabs = await chrome.tabs.query({
        url: ['http://*/*', 'https://*/*', 'file:///*'],
        discarded: false
    });

    await Promise.all(tabs.map(async function (tab) {
        const alive = await chrome.tabs.sendMessage(tab.id, { type: 'smart-blur:status' }, { frameId: 0 })
            .then(function () { return true; }, function () { return false; });
        if (alive) return;

        try {
            await Promise.all([
                chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content.css'] }),
                chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['settings.js', 'content.js'] }),
                chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['frame.js'] })
            ]);
        } catch {}
    }));
}

chrome.runtime.onInstalled.addListener(function () {
    injectIntoOpenTabs();
    refreshAllBadges();
});

chrome.runtime.onStartup.addListener(refreshAllBadges);

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    if (changeInfo.url || changeInfo.status === 'loading') refreshBadge(tab);
});

chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'local' && (changes.globalEnabled || changes.disabledSites)) refreshAllBadges();
});

chrome.runtime.onMessage.addListener(function (message, sender) {
    if (!message || message.type !== 'smart-blur:frame-input' || !sender.tab || !sender.frameId) return;
    chrome.tabs.sendMessage(sender.tab.id, message, { frameId: 0 }).catch(function () {});
});

chrome.commands.onCommand.addListener(async function (command) {
    const settings = await Settings.load();

    if (command === 'toggle-global') {
        await Settings.save({ globalEnabled: !settings.globalEnabled });
    } else if (command === 'cycle-shape') {
        const shapes = ['circle', 'band', 'block'];
        const next = shapes[(shapes.indexOf(settings.spotlightShape) + 1) % shapes.length];
        const patch = { spotlightShape: next };
        if (next === 'band') patch.spotlightSize = 90;
        else if (settings.spotlightShape === 'band') patch.spotlightSize = Settings.DEFAULTS.spotlightSize;
        await Settings.save(patch);
    }
});