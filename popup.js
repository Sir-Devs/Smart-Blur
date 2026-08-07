/* ============================================================================
   Smart Blur — popup control panel
   ----------------------------------------------------------------------------
   Developed by Ahmad Alhalabi — https://ahmadalhalabi.com/
   Copyright (c) 2025-2026 Ahmad Alhalabi. All rights reserved.
   Released under the MIT License. See LICENSE for details.
   ========================================================================== */

document.addEventListener('DOMContentLoaded', function () {
    'use strict';

    const el = {
        toggleGlobal:  document.getElementById('toggleGlobal'),
        toggleCurrent: document.getElementById('toggleCurrent'),
        status:        document.getElementById('status'),
        sizeSlider:    document.getElementById('spotlightSize'),
        sizeValue:     document.getElementById('spotlightSizeValue'),
        blurVideos:    document.getElementById('blurVideos'),
        blurVideosHint:document.getElementById('blurVideosHint'),
        articleFocus:  document.getElementById('articleFocus'),
        idleTimeout:   document.getElementById('idleTimeout'),
        idleHint:      document.getElementById('idleTimeoutHint'),
        panicEnabled:  document.getElementById('panicEnabled')
    };

    const DEFAULT_SIZE = 170;
    const DEFAULT_IDLE = 15000;
    const IDLE_CHOICES = [0, 5000, 15000, 30000];
    const SIZE_WRITE_DELAY = 120;
    let sizeWriteTimer = null;

    // ---- Helpers -----------------------------------------------------------

    function clampSize(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return DEFAULT_SIZE;
        return Math.min(Number(el.sizeSlider.max), Math.max(Number(el.sizeSlider.min), n));
    }

    function clampIdle(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return DEFAULT_IDLE;
        return IDLE_CHOICES.indexOf(n) === -1 ? DEFAULT_IDLE : n;
    }

    function renderSizeLabel(size) {
        el.sizeValue.textContent = size + ' px';
    }

    function renderVideoHint(blurVideos) {
        el.blurVideosHint.textContent = blurVideos
            ? 'On: video players are blurred like the rest of the page.'
            : 'Off: video players stay sharp so you can keep watching.';
    }

    function renderIdleHint(ms) {
        el.idleHint.textContent = ms === 0
            ? 'Off: the screen never blurs on its own.'
            : 'Blurs the whole screen after ' + (ms / 1000) + 's of stillness.';
    }

    function setStatus(text, state) {
        el.status.textContent = text;
        el.status.className = 'status ' + state;
    }

    function broadcast(message) {
        chrome.tabs.query({}, function (tabs) {
            tabs.forEach(function (tab) {
                if (!tab.id) return;
                chrome.tabs.sendMessage(tab.id, message).catch(function () {

                });
            });
        });
    }

    // ---- UI state ----------------------------------------------------------

    function updateUI() {
        chrome.storage.local.get(
            ['globalEnabled', 'disabledSites', 'spotlightSize', 'blurVideos',
             'articleFocus', 'idleTimeout', 'panicEnabled'],
            function (data) {
                const globalEnabled = data.globalEnabled !== false;
                const disabledSites = data.disabledSites || [];

                const size = clampSize(
                    data.spotlightSize === undefined ? DEFAULT_SIZE : data.spotlightSize);
                const idle = clampIdle(
                    data.idleTimeout === undefined ? DEFAULT_IDLE : data.idleTimeout);


                const blurVideos = data.blurVideos === true;
                const articleFocus = data.articleFocus === true;
                const panicEnabled = data.panicEnabled !== false;


                el.toggleGlobal.textContent = globalEnabled
                    ? 'Turn Off Everywhere' : 'Turn On Everywhere';
                el.toggleGlobal.classList.toggle('off', !globalEnabled);


                if (sizeWriteTimer === null) {
                    el.sizeSlider.value = size;
                    renderSizeLabel(size);
                }

                el.blurVideos.checked = blurVideos;
                renderVideoHint(blurVideos);

                el.articleFocus.checked = articleFocus;

                el.idleTimeout.value = String(idle);
                renderIdleHint(idle);

                el.panicEnabled.checked = panicEnabled;


                el.sizeSlider.disabled = !globalEnabled;
                el.blurVideos.disabled = !globalEnabled;
                el.articleFocus.disabled = !globalEnabled;
                el.idleTimeout.disabled = !globalEnabled;
                el.panicEnabled.disabled = !globalEnabled;

                
                chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
                    const tab = tabs[0];
                    if (!tab || !tab.url) {
                        el.toggleCurrent.disabled = true;
                        setStatus('No active web page.', 'inactive');
                        return;
                    }

                    let currentSite;
                    try {
                        currentSite = new URL(tab.url).hostname;
                    } catch (error) {
                        currentSite = '';
                    }

                    if (!currentSite) {
                        el.toggleCurrent.disabled = true;
                        setStatus('This page is not supported.', 'inactive');
                        return;
                    }

                    el.toggleCurrent.disabled = false;
                    const isCurrentDisabled = disabledSites.includes(currentSite);

                    el.toggleCurrent.textContent = isCurrentDisabled
                        ? 'Enable On This Site' : 'Disable On This Site';
                    el.toggleCurrent.classList.toggle('off', isCurrentDisabled);

                    if (!globalEnabled) {
                        setStatus('The effect is turned off everywhere.', 'inactive');
                    } else if (isCurrentDisabled) {
                        setStatus('The effect is disabled on this site.', 'inactive');
                    } else {
                        setStatus('The effect is active on this site.', 'active');
                    }
                });
            }
        );
    }

    // ---- Master toggles ----------------------------------------------------

    el.toggleGlobal.addEventListener('click', function () {
        chrome.storage.local.get(['globalEnabled'], function (data) {
            const newState = !(data.globalEnabled !== false);
            chrome.storage.local.set({ globalEnabled: newState }, function () {
                updateUI();
                broadcast({ action: 'updateEffect', globalEnabled: newState });
            });
        });
    });

    el.toggleCurrent.addEventListener('click', function () {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            const tab = tabs[0];
            if (!tab || !tab.url) return;

            let currentSite;
            try {
                currentSite = new URL(tab.url).hostname;
            } catch (error) {
                return;
            }
            if (!currentSite) return;

            chrome.storage.local.get(['disabledSites', 'globalEnabled'], function (data) {
                const disabledSites = data.disabledSites || [];
                const globalEnabled = data.globalEnabled !== false;

                const newDisabledSites = disabledSites.includes(currentSite)
                    ? disabledSites.filter(function (s) { return s !== currentSite; })
                    : disabledSites.concat([currentSite]);

                chrome.storage.local.set({ disabledSites: newDisabledSites }, function () {
                    updateUI();
                    chrome.tabs.sendMessage(tab.id, {
                        action: 'updateEffect',
                        globalEnabled: globalEnabled,
                        disabledSites: newDisabledSites
                    }).catch(function () {
                        
                    });
                });
            });
        });
    });

    // ---- Spotlight size ----------------------------------------------------

    el.sizeSlider.addEventListener('input', function () {
        const size = clampSize(el.sizeSlider.value);
        renderSizeLabel(size);

        // Label updates instantly; storage is written once the user pauses.
        if (sizeWriteTimer !== null) clearTimeout(sizeWriteTimer);
        sizeWriteTimer = setTimeout(function () {
            sizeWriteTimer = null;
            chrome.storage.local.set({ spotlightSize: size });
        }, SIZE_WRITE_DELAY);
    });


    el.sizeSlider.addEventListener('change', function () {
        if (sizeWriteTimer !== null) { clearTimeout(sizeWriteTimer); sizeWriteTimer = null; }
        chrome.storage.local.set({ spotlightSize: clampSize(el.sizeSlider.value) });
    });

    // ---- Feature toggles ---------------------------------------------------

    el.blurVideos.addEventListener('change', function () {
        const value = el.blurVideos.checked;
        renderVideoHint(value);
        chrome.storage.local.set({ blurVideos: value });
    });

    el.articleFocus.addEventListener('change', function () {
        chrome.storage.local.set({ articleFocus: el.articleFocus.checked });
    });

    el.panicEnabled.addEventListener('change', function () {
        chrome.storage.local.set({ panicEnabled: el.panicEnabled.checked });
    });

    el.idleTimeout.addEventListener('change', function () {
        const value = clampIdle(el.idleTimeout.value);
        renderIdleHint(value);
        chrome.storage.local.set({ idleTimeout: value });
    });

    // ---- Init --------------------------------------------------------------

    updateUI();
});
