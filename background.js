importScripts('settings.js');

const Settings = self.SmartBlurSettings;

const BADGE_OFF = 'OFF';
const BADGE_COLOR = '#6b7280';

function badgeTextFor(url, settings) {
    const site = Settings.siteKeyFromUrl(url || '');
    const active = site ? Settings.isActiveOn(settings, site) : settings.globalEnabled;
    return active ? '' : BADGE_OFF;
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

async function bootOnce() {
    const { booted } = await chrome.storage.session.get('booted');
    if (booted) return;
    await chrome.storage.session.set({ booted: true });
    await Promise.all([injectIntoOpenTabs(), refreshAllBadges()]);
}

bootOnce();

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
    if (command !== 'toggle-global') return;
    const settings = await Settings.load();
    await Settings.save({ globalEnabled: !settings.globalEnabled });
});
