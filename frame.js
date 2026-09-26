(function () {
    'use strict';

    if (window.top === window) return;

    const ACTIVITY_INTERVAL_MS = 1000;
    const TEARDOWN_EVENT = 'smart-blur:frame-teardown';
    const PASSIVE_CAPTURE = { passive: true, capture: true };

    let lastSent = -Infinity;

    function send(key) {
        try {
            chrome.runtime.sendMessage({ type: 'smart-blur:frame-input', key: key }).catch(function () {});
        } catch {
            stop();
        }
    }

    function onActivity() {
        const now = performance.now();
        if (now - lastSent < ACTIVITY_INTERVAL_MS) return;
        lastSent = now;
        send('');
    }

    function onKeyDown(event) {
        const plainEscape = event.key === 'Escape' && !event.repeat && !event.isComposing &&
            !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
        if (plainEscape) send('Escape');
        else onActivity();
    }

    function stop() {
        document.removeEventListener(TEARDOWN_EVENT, stop);
        window.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('pointerdown', onActivity, PASSIVE_CAPTURE);
        window.removeEventListener('pointermove', onActivity, PASSIVE_CAPTURE);
        window.removeEventListener('wheel', onActivity, PASSIVE_CAPTURE);
    }

    document.dispatchEvent(new CustomEvent(TEARDOWN_EVENT));
    document.addEventListener(TEARDOWN_EVENT, stop);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onActivity, PASSIVE_CAPTURE);
    window.addEventListener('pointermove', onActivity, PASSIVE_CAPTURE);
    window.addEventListener('wheel', onActivity, PASSIVE_CAPTURE);
})();
