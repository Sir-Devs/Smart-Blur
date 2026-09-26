(function () {
    'use strict';

    if (window.top !== window) return;

    const Settings = self.SmartBlurSettings;
    if (!Settings) return;

    const IDS = {
        veil: 'smart-blur-veil',
        ring: 'smart-blur-ring',
        marquee: 'smart-blur-marquee',
        toast: 'smart-blur-toast'
    };

    // ids from older versions too, in case an orphaned script left them behind
    const STALE_IDS = [
        'smart-blur-overlay', 'smart-blur-spotlight', 'smart-blur-picker',
        IDS.veil, IDS.ring, IDS.marquee, IDS.toast
    ];

    const TEARDOWN_EVENT = 'smart-blur:teardown';

    const XHTML_NS = 'http://www.w3.org/1999/xhtml';

    const CUTOUT_SLOTS = 4;
    const PARKED_POSITION = '-9999px -9999px';
    const PARKED_SIZE = '0px 0px';

    const MEDIA_SELECTOR = [
        'video',
        'iframe[src*="youtube.com/embed"]',
        'iframe[src*="youtube-nocookie.com"]',
        'iframe[src*="player.vimeo.com"]',
        'iframe[src*="dailymotion.com/embed"]',
        'iframe[src*="geo.dailymotion.com"]',
        'iframe[src*="player.twitch.tv"]'
    ].join(',');

    const MIN_MEDIA_AREA = 100 * 80;
    const MIN_PICK_AREA = 400;
    const RESCAN_THROTTLE_MS = 400;
    const REATTACH_LIMIT = 5;
    const GEOMETRY_POLL_MS = 250;
    const DOUBLE_ESC_MS = 450;
    const TOAST_MS = 2800;
    const WHEEL_STEP = 50;

    const SHAPE_MODES = {
        close:   { rank: 0, duration: '700ms', easing: 'ease-in' },
        normal:  { rank: 1, duration: '160ms', easing: 'ease' },
        instant: { rank: 2, duration: '0ms',   easing: 'linear' }
    };

    const PICK_LABELS = {
        ARTICLE: 'pickArticle', MAIN: 'pickMain', SECTION: 'pickSection',
        P: 'pickParagraph', BLOCKQUOTE: 'pickParagraph',
        H1: 'pickHeading', H2: 'pickHeading', H3: 'pickHeading',
        H4: 'pickHeading', H5: 'pickHeading', H6: 'pickHeading',
        UL: 'pickList', OL: 'pickList', DL: 'pickList',
        TABLE: 'pickTable',
        IMG: 'pickImage', PICTURE: 'pickImage', FIGURE: 'pickImage',
        SVG: 'pickImage', CANVAS: 'pickImage',
        VIDEO: 'pickVideo', IFRAME: 'pickVideo',
        NAV: 'pickNavigation', HEADER: 'pickHeader', FOOTER: 'pickFooter',
        ASIDE: 'pickSidebar', FORM: 'pickForm'
    };

    const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    const ALT_NAME = /mac/i.test(platform) ? 'Option' : 'Alt';

    const PASSIVE_CAPTURE = { passive: true, capture: true };

    const site = Settings.siteKeyFromUrl(location.href);
    let settings = Settings.normalize({});

    let destroyed = false;
    let loaded = false;
    let mounted = false;
    let nodes = null;

    const pointer = { x: 0, y: 0, inside: false };
    let panicOn = false;
    let autoBlurred = false;
    let lastActivity = 0;
    let idleTimer = 0;
    let lastEscAt = 0;

    let focusRoot = null;
    let focusPage = '';
    const pick = { active: false, base: null, depth: 0, target: null, shown: false, wheel: 0 };

    let frameId = 0;
    const dirty = { pointer: false, shape: false, geometry: false, pick: false };
    let shapeMode = 'normal';
    let lastMaskPosition = '';
    let lastMaskSize = '';

    let mediaObserver = null;
    let resizeObserver = null;
    let domObserver = null;
    let rescanTimer = 0;
    let pollTimer = 0;
    let toastTimer = 0;
    const visibleMedia = new Map();
    let observedMedia = new WeakSet();
    let reattachWindow = 0;
    let reattachCount = 0;

    function t(key, substitutions) {
        try {
            return chrome.i18n.getMessage(key, substitutions) || '';
        } catch {
            return '';
        }
    }

    function isContextAlive() {
        try {
            return Boolean(chrome.runtime && chrome.runtime.id);
        } catch {
            return false;
        }
    }

    function isOwnNode(node) {
        if (!nodes || !node) return false;
        return node === nodes.veil || node === nodes.ring ||
            nodes.marquee.contains(node) || nodes.toast.contains(node);
    }

    function createNode(id) {
        const el = document.createElement('div');
        el.id = id;
        el.popover = 'manual';
        el.setAttribute('aria-hidden', 'true');
        return el;
    }

    function requestFrame() {
        if (!frameId && mounted) frameId = requestAnimationFrame(render);
    }

    function requestShape(mode) {
        if (!dirty.shape || SHAPE_MODES[mode].rank > SHAPE_MODES[shapeMode].rank) shapeMode = mode;
        dirty.shape = true;
        requestFrame();
    }

    function requestGeometry() {
        dirty.geometry = true;
        requestFrame();
    }

    function render() {
        frameId = 0;
        if (!mounted) return;

        if (!isContextAlive()) {
            destroy();
            return;
        }

        const rects = dirty.geometry ? readCutouts() : null;
        const pickBox = dirty.pick ? readPickBox() : undefined;

        if (dirty.pointer) writePointer();
        if (dirty.shape) writeShape(shapeMode);
        if (rects) writeCutouts(rects);
        if (pickBox !== undefined) writePickBox(pickBox);

        dirty.pointer = dirty.shape = dirty.geometry = dirty.pick = false;
    }

    function spotlightRadius() {
        if (!pointer.inside || panicOn || autoBlurred || focusRoot) return 0;
        return settings.spotlightSize / 2;
    }

    function writePointer() {
        const x = pointer.x + 'px';
        const y = pointer.y + 'px';
        nodes.veil.style.setProperty('--sb-x', x);
        nodes.veil.style.setProperty('--sb-y', y);
        nodes.ring.style.setProperty('--sb-x', x);
        nodes.ring.style.setProperty('--sb-y', y);
    }

    function writeShape(mode) {
        const preset = SHAPE_MODES[mode];
        const radius = spotlightRadius();
        const veil = nodes.veil;
        const ring = nodes.ring;

        for (const el of [veil, ring]) {
            el.style.setProperty('--sb-dur', preset.duration);
            el.style.setProperty('--sb-ease', preset.easing);
            el.style.setProperty('--sb-r', radius + 'px');
        }

        veil.style.setProperty('--sb-blur', settings.blurStrength + 'px');
        veil.classList.toggle('sb-panic', panicOn);
        ring.classList.toggle('sb-hidden', radius === 0);
    }

    function pushRect(list, rect, minArea) {
        if (rect.width * rect.height < minArea) return;
        if (rect.bottom <= 0 || rect.right <= 0) return;
        if (rect.top >= window.innerHeight || rect.left >= window.innerWidth) return;
        list.push({
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            w: Math.round(rect.width),
            h: Math.round(rect.height)
        });
    }

    function readCutouts() {
        const rects = [];
        if (panicOn) return rects;

        if (focusRoot && !autoBlurred && focusRoot.isConnected) {
            pushRect(rects, focusRoot.getBoundingClientRect(), 1);
        }

        if (settings.keepVideosClear && visibleMedia.size > 0) {
            const ranked = [];
            visibleMedia.forEach(function (area, el) {
                if (!el.isConnected) {
                    visibleMedia.delete(el);
                    return;
                }
                if (el !== focusRoot) ranked.push({ el, area });
            });
            ranked.sort(function (a, b) { return b.area - a.area; });

            for (let i = 0; i < ranked.length && rects.length < CUTOUT_SLOTS; i++) {
                pushRect(rects, ranked[i].el.getBoundingClientRect(), MIN_MEDIA_AREA);
            }
        }
        return rects;
    }

    function writeCutouts(rects) {
        let position = '0 0';
        let size = '100% 100%';

        for (let i = 0; i < CUTOUT_SLOTS; i++) {
            const r = rects[i];
            position += ', ' + (r ? r.x + 'px ' + r.y + 'px' : PARKED_POSITION);
            size += ', ' + (r ? r.w + 'px ' + r.h + 'px' : PARKED_SIZE);
        }

        if (position !== lastMaskPosition) {
            nodes.veil.style.setProperty('mask-position', position);
            lastMaskPosition = position;
        }
        if (size !== lastMaskSize) {
            nodes.veil.style.setProperty('mask-size', size);
            lastMaskSize = size;
        }
    }

    function updatePoll() {
        const needed = mounted && !panicOn &&
            (focusRoot !== null || (settings.keepVideosClear && visibleMedia.size > 0));

        if (needed && !pollTimer) {
            pollTimer = setInterval(requestGeometry, GEOMETRY_POLL_MS);
        } else if (!needed && pollTimer) {
            clearInterval(pollTimer);
            pollTimer = 0;
        }
    }

    function onMediaIntersect(entries) {
        for (const entry of entries) {
            const el = entry.target;
            if (entry.isIntersecting && el.isConnected) {
                const r = entry.intersectionRect;
                visibleMedia.set(el, r.width * r.height);
                if (resizeObserver) resizeObserver.observe(el);
            } else {
                visibleMedia.delete(el);
                if (resizeObserver && el !== focusRoot) resizeObserver.unobserve(el);
            }
        }
        updatePoll();
        requestGeometry();
    }

    function scanMedia() {
        if (!mediaObserver) return;
        const found = document.querySelectorAll(MEDIA_SELECTOR);
        for (let i = 0; i < found.length; i++) {
            const el = found[i];
            if (observedMedia.has(el)) continue;
            observedMedia.add(el);
            mediaObserver.observe(el);
        }
    }

    function markActivity() {
        lastActivity = performance.now();
        if (autoBlurred) {
            autoBlurred = false;
            requestShape('instant');
            requestGeometry();
        }
        if (!idleTimer && !panicOn) armIdle(settings.idleTimeout);
    }

    function armIdle(delay) {
        if (idleTimer) {
            clearTimeout(idleTimer);
            idleTimer = 0;
        }
        if (!mounted || !settings.idleTimeout) return;
        idleTimer = setTimeout(checkIdle, delay);
    }

    function checkIdle() {
        idleTimer = 0;
        if (!mounted || !settings.idleTimeout || panicOn) return;

        const elapsed = performance.now() - lastActivity;
        if (elapsed < settings.idleTimeout) {
            armIdle(settings.idleTimeout - elapsed);
            return;
        }
        if (!autoBlurred) {
            autoBlurred = true;
            requestShape(document.visibilityState === 'visible' ? 'close' : 'instant');
            requestGeometry();
        }
    }

    function handleEscape(event) {
        if (event.repeat || event.isComposing) return;
        if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
        handleEscapePress();
    }

    // A single Esc belongs to the page (dialogs, fullscreen), so panic needs two.
    function handleEscapePress() {
        if (!settings.panicEnabled) return;
        const now = performance.now();
        if (now - lastEscAt <= DOUBLE_ESC_MS) {
            lastEscAt = 0;
            setPanic(!panicOn);
        } else {
            lastEscAt = now;
        }
    }

    function setPanic(on) {
        if (panicOn === on) return;
        panicOn = on;

        if (on) {
            if (idleTimer) {
                clearTimeout(idleTimer);
                idleTimer = 0;
            }
            stopPicking();
        } else {
            lastActivity = performance.now();
            armIdle(settings.idleTimeout);
        }

        updatePoll();
        requestShape('instant');
        requestGeometry();
    }

    function resolvePick(base, depth) {
        let el = base;
        if (!el || el.nodeType !== 1) return null;
        while (depth-- > 0) {
            const parent = el.parentElement;
            if (!parent || parent === document.body || parent === document.documentElement) break;
            el = parent;
        }
        return el;
    }

    function startPicking(base) {
        if (pick.active || focusRoot || panicOn) return;
        pick.active = true;
        pick.depth = 0;
        pick.wheel = 0;
        pick.base = base || null;
        document.documentElement.classList.add('sb-picking');
        window.addEventListener('wheel', onPickWheel, { capture: true, passive: false });
        retarget();
    }

    function stopPicking() {
        if (!pick.active) return;
        pick.active = false;
        pick.base = null;
        pick.target = null;
        pick.depth = 0;
        document.documentElement.classList.remove('sb-picking');
        window.removeEventListener('wheel', onPickWheel, { capture: true });
        dirty.pick = true;
        requestFrame();
    }

    function retarget() {
        const next = resolvePick(pick.base, pick.depth);
        if (next !== pick.target) {
            pick.target = next;
            dirty.pick = true;
            requestFrame();
        }
    }

    function onPickWheel(event) {
        if (!pick.active) return;
        if (!event.altKey) {
            stopPicking();
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (!pick.base) return;

        pick.wheel += event.deltaY;
        if (Math.abs(pick.wheel) < WHEEL_STEP) return;
        const widen = pick.wheel < 0;
        pick.wheel = 0;

        if (widen) {
            if (resolvePick(pick.base, pick.depth + 1) !== pick.target) pick.depth++;
        } else if (pick.depth > 0) {
            pick.depth--;
        }
        retarget();
    }

    function onPickPointer(event) {
        if (!event.altKey || (!settings.articleFocus && !focusRoot)) return;

        // Alt+click on a link starts a download in Chrome, so swallow the whole click.
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.type !== 'click') return;

        if (focusRoot) {
            setFocus(null, false);
            return;
        }

        const target = (pick.active && pick.target) || event.target;
        if (!target || target.nodeType !== 1 || isOwnNode(target)) return;
        if (target === document.body || target === document.documentElement) return;
        const rect = target.getBoundingClientRect();
        if (rect.width * rect.height < MIN_PICK_AREA) return;
        setFocus(target, false);
    }

    function pageKey() {
        return location.origin + location.pathname + location.search;
    }

    function setFocus(el, silent) {
        if (el === focusRoot) return;
        if (focusRoot && resizeObserver && !visibleMedia.has(focusRoot)) {
            resizeObserver.unobserve(focusRoot);
        }

        const hadFocus = focusRoot !== null;
        focusRoot = el;
        focusPage = el ? pageKey() : '';
        if (el && resizeObserver) resizeObserver.observe(el);

        stopPicking();
        updatePoll();
        requestShape('normal');
        requestGeometry();

        if (silent) return;
        if (el) showToast(t('toastLocked', [ALT_NAME]));
        else if (hadFocus) showToast(t('toastReleased'));
    }

    function labelFor(el) {
        const key = PICK_LABELS[el.tagName.toUpperCase()] || 'pickBlock';
        return t(key) + '  ·  ' + t('pickHint');
    }

    function readPickBox() {
        const el = pick.active ? pick.target : null;
        if (!el || !el.isConnected || isOwnNode(el)) return null;
        if (el === document.body || el === document.documentElement) return null;

        const rect = el.getBoundingClientRect();
        if (rect.width * rect.height < MIN_PICK_AREA) return null;

        return {
            x: Math.round(rect.left) + 'px',
            y: Math.round(rect.top) + 'px',
            w: Math.round(rect.width) + 'px',
            h: Math.round(rect.height) + 'px',
            label: labelFor(el),
            labelInside: rect.top < 28
        };
    }

    function writePickBox(box) {
        const marquee = nodes.marquee;
        if (!box) {
            if (pick.shown) {
                marquee.classList.remove('sb-show');
                pick.shown = false;
            }
            return;
        }

        marquee.style.setProperty('--p-x', box.x);
        marquee.style.setProperty('--p-y', box.y);
        marquee.style.setProperty('--p-w', box.w);
        marquee.style.setProperty('--p-h', box.h);
        if (nodes.marqueeLabel.textContent !== box.label) nodes.marqueeLabel.textContent = box.label;
        marquee.classList.toggle('sb-label-inside', box.labelInside);

        if (!pick.shown) {
            marquee.classList.add('sb-show');
            pick.shown = true;
        }
    }

    function showToast(text) {
        if (!nodes || !text) return;
        const toast = nodes.toast;
        toast.textContent = text;
        toast.classList.add('sb-show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
            if (nodes) nodes.toast.classList.remove('sb-show');
        }, TOAST_MS);
    }

    function onPointerMove(event) {
        pointer.x = event.clientX;
        pointer.y = event.clientY;
        dirty.pointer = true;

        if (!pointer.inside) {
            pointer.inside = true;
            requestShape('instant');
        }
        markActivity();

        if (pick.active) {
            if (!event.altKey) {
                stopPicking();
            } else if (event.target !== pick.base) {
                pick.base = event.target;
                retarget();
            }
        } else if (event.altKey && settings.articleFocus) {
            startPicking(event.target);
        }

        requestFrame();
    }

    function onDragOver(event) {
        pointer.x = event.clientX;
        pointer.y = event.clientY;
        dirty.pointer = true;
        if (!pointer.inside) {
            pointer.inside = true;
            requestShape('instant');
        }
        markActivity();
        requestFrame();
    }

    function onPointerOut(event) {
        if (event.relatedTarget || !pointer.inside) return;
        pointer.inside = false;
        requestShape('normal');
    }

    function onKeyDown(event) {
        markActivity();

        if (event.key === 'Escape') {
            handleEscape(event);
        } else if (event.key === 'Alt' && !event.repeat && settings.articleFocus) {
            startPicking(pointer.inside ? document.elementFromPoint(pointer.x, pointer.y) : null);
        }
    }

    function onKeyUp(event) {
        if (event.key === 'Alt') stopPicking();
    }

    function onDomMutations(records) {
        if (!isAttached()) reattachNow();

        let raise = false;
        let relevant = false;
        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            if (record.type === 'attributes') {
                if (record.attributeName === 'open' && record.target.localName === 'dialog' &&
                    record.target.hasAttribute('open')) raise = true;
                relevant = true;
            } else if (!relevant && !isOwnNode(record.target)) {
                relevant = true;
            }
        }

        if (raise) showLayers();
        if (relevant && !rescanTimer) rescanTimer = setTimeout(rescan, RESCAN_THROTTLE_MS);
    }

    function rescan() {
        rescanTimer = 0;
        if (!mounted) return;

        if (!isAttached()) attachNodes();

        if (focusRoot && (pageKey() !== focusPage || !focusRoot.isConnected)) setFocus(null, true);

        scanMedia();
        requestGeometry();
    }

    // Re-entering the top layer keeps page dialogs and popovers under the blur.
    function showLayers() {
        if (!mounted) return;
        for (const node of [nodes.veil, nodes.ring, nodes.marquee, nodes.toast]) {
            if (!node.isConnected) continue;
            try {
                if (node.matches(':popover-open')) node.hidePopover();
                node.showPopover();
            } catch {}
        }
    }

    function onBeforeToggle(event) {
        if (event.newState === 'open' && !isOwnNode(event.target)) queueMicrotask(showLayers);
    }

    function onToggle(event) {
        if (event.newState === 'closed' && isOwnNode(event.target) &&
            !event.target.matches(':popover-open')) showLayers();
    }

    function onFullscreenChange() {
        showLayers();
        requestGeometry();
    }

    function isAttached() {
        const root = document.documentElement;
        return Boolean(root) && nodes.veil.parentNode === root && nodes.ring.parentNode === root &&
            nodes.marquee.parentNode === root && nodes.toast.parentNode === root;
    }

    // Some pages keep deleting foreign nodes; don't get into an endless loop with them.
    function reattachNow() {
        const now = performance.now();
        if (now - reattachWindow > 1000) {
            reattachWindow = now;
            reattachCount = 0;
        }
        if (++reattachCount > REATTACH_LIMIT) {
            if (!rescanTimer) rescanTimer = setTimeout(rescan, RESCAN_THROTTLE_MS);
            return;
        }
        attachNodes();
    }

    function attachNodes() {
        const root = document.documentElement;
        if (!root) return;
        root.append(nodes.veil, nodes.ring, nodes.marquee, nodes.toast);
        showLayers();
    }

    function mount(animate) {
        if (mounted || destroyed) return;

        const veil = createNode(IDS.veil);
        const ring = createNode(IDS.ring);
        const marquee = createNode(IDS.marquee);
        const toast = createNode(IDS.toast);
        const marqueeLabel = document.createElement('span');

        marqueeLabel.className = 'sb-label';
        marqueeLabel.dir = 'auto';
        marquee.appendChild(marqueeLabel);
        toast.dir = 'auto';
        veil.dir = t('textDirection') || 'ltr';
        veil.dataset.hint = t('panicOverlayHint');
        if (animate) {
            veil.classList.add('sb-enter');
            veil.addEventListener('animationend', function () {
                veil.classList.remove('sb-enter');
            }, { once: true });
        }

        nodes = { veil, ring, marquee, marqueeLabel, toast };
        mounted = true;
        attachNodes();
        lastMaskPosition = '';
        lastMaskSize = '';

        window.addEventListener('pointermove', onPointerMove, PASSIVE_CAPTURE);
        window.addEventListener('pointerout', onPointerOut, PASSIVE_CAPTURE);
        window.addEventListener('dragover', onDragOver, PASSIVE_CAPTURE);
        window.addEventListener('pointerdown', markActivity, PASSIVE_CAPTURE);
        window.addEventListener('wheel', markActivity, PASSIVE_CAPTURE);
        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('keyup', onKeyUp, true);
        window.addEventListener('blur', stopPicking);

        window.addEventListener('pointerdown', onPickPointer, true);
        window.addEventListener('mousedown', onPickPointer, true);
        window.addEventListener('mouseup', onPickPointer, true);
        window.addEventListener('click', onPickPointer, true);

        window.addEventListener('scroll', requestGeometry, PASSIVE_CAPTURE);
        window.addEventListener('resize', requestGeometry, { passive: true });
        document.addEventListener('fullscreenchange', onFullscreenChange);
        window.addEventListener('beforetoggle', onBeforeToggle, true);
        window.addEventListener('toggle', onToggle, true);

        mediaObserver = new IntersectionObserver(onMediaIntersect, {
            rootMargin: '150px',
            threshold: [0, 0.25, 0.5, 0.75, 1]
        });
        resizeObserver = new ResizeObserver(function () { requestGeometry(); });
        domObserver = new MutationObserver(onDomMutations);
        domObserver.observe(document, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src', 'open']
        });

        scanMedia();
        lastActivity = performance.now();
        armIdle(settings.idleTimeout);
        requestShape('instant');
        requestGeometry();
    }

    function unmount() {
        if (!mounted) return;
        mounted = false;

        window.removeEventListener('pointermove', onPointerMove, PASSIVE_CAPTURE);
        window.removeEventListener('pointerout', onPointerOut, PASSIVE_CAPTURE);
        window.removeEventListener('dragover', onDragOver, PASSIVE_CAPTURE);
        window.removeEventListener('pointerdown', markActivity, PASSIVE_CAPTURE);
        window.removeEventListener('wheel', markActivity, PASSIVE_CAPTURE);
        window.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('keyup', onKeyUp, true);
        window.removeEventListener('blur', stopPicking);
        window.removeEventListener('pointerdown', onPickPointer, true);
        window.removeEventListener('mousedown', onPickPointer, true);
        window.removeEventListener('mouseup', onPickPointer, true);
        window.removeEventListener('click', onPickPointer, true);
        window.removeEventListener('scroll', requestGeometry, PASSIVE_CAPTURE);
        window.removeEventListener('resize', requestGeometry, { passive: true });
        document.removeEventListener('fullscreenchange', onFullscreenChange);
        window.removeEventListener('beforetoggle', onBeforeToggle, true);
        window.removeEventListener('toggle', onToggle, true);

        stopPicking();

        if (mediaObserver) mediaObserver.disconnect();
        if (resizeObserver) resizeObserver.disconnect();
        if (domObserver) domObserver.disconnect();
        mediaObserver = resizeObserver = domObserver = null;
        visibleMedia.clear();
        observedMedia = new WeakSet();

        if (frameId) cancelAnimationFrame(frameId);
        clearTimeout(idleTimer);
        clearTimeout(rescanTimer);
        clearTimeout(toastTimer);
        clearInterval(pollTimer);
        frameId = idleTimer = rescanTimer = toastTimer = pollTimer = 0;
        dirty.pointer = dirty.shape = dirty.geometry = dirty.pick = false;

        focusRoot = null;
        focusPage = '';
        panicOn = false;
        autoBlurred = false;
        pointer.inside = false;
        pick.shown = false;

        nodes.veil.remove();
        nodes.ring.remove();
        nodes.marquee.remove();
        nodes.toast.remove();
        nodes = null;
    }

    function applySettings(next, animate) {
        const prev = settings;
        settings = next;

        if (!Settings.isActiveOn(next, site)) {
            unmount();
            return;
        }
        if (!mounted) {
            mount(animate);
            return;
        }

        if (prev.spotlightSize !== next.spotlightSize || prev.blurStrength !== next.blurStrength) {
            requestShape('normal');
        }

        if (prev.keepVideosClear !== next.keepVideosClear) {
            updatePoll();
            requestGeometry();
        }

        if (prev.articleFocus && !next.articleFocus) {
            stopPicking();
            setFocus(null, true);
        }

        if (prev.idleTimeout !== next.idleTimeout) {
            clearTimeout(idleTimer);
            idleTimer = 0;
            if (autoBlurred) {
                autoBlurred = false;
                requestShape('instant');
                requestGeometry();
            }
            lastActivity = performance.now();
            if (!panicOn) armIdle(next.idleTimeout);
        }

        if (!next.panicEnabled && panicOn) setPanic(false);
    }

    async function syncFromStorage(animate) {
        let next;
        try {
            next = await Settings.load();
        } catch {
            return;
        }
        if (destroyed) return;
        loaded = true;
        applySettings(next, animate);
    }

    function onStorageChanged(changes, area) {
        if (area !== 'local' || destroyed) return;
        if (!loaded) {
            syncFromStorage(true);
            return;
        }
        const patch = {};
        let relevant = false;
        for (const key of Settings.KEYS) {
            if (key in changes) {
                patch[key] = changes[key].newValue;
                relevant = true;
            }
        }
        if (relevant) applySettings(Settings.normalize(Object.assign({}, settings, patch)), true);
    }

    function onMessage(message, sender, sendResponse) {
        if (!message) return;
        if (message.type === 'smart-blur:status') {
            sendResponse({ site, running: mounted });
        } else if (message.type === 'smart-blur:frame-input' && mounted) {
            markActivity();
            if (message.key === 'Escape') handleEscapePress();
        }
    }

    function onPageShow(event) {
        if (event.persisted) syncFromStorage(false);
    }

    function destroy() {
        if (destroyed) return;
        destroyed = true;
        unmount();
        document.removeEventListener(TEARDOWN_EVENT, destroy);
        window.removeEventListener('pageshow', onPageShow);
        try {
            chrome.storage.onChanged.removeListener(onStorageChanged);
            chrome.runtime.onMessage.removeListener(onMessage);
        } catch {}
    }

    function boot() {
        const root = document.documentElement;
        if (!root || root.namespaceURI !== XHTML_NS) return;

        document.dispatchEvent(new CustomEvent(TEARDOWN_EVENT));
        for (const id of STALE_IDS) {
            const stale = document.getElementById(id);
            if (stale) stale.remove();
        }

        document.addEventListener(TEARDOWN_EVENT, destroy);
        window.addEventListener('pageshow', onPageShow);
        chrome.storage.onChanged.addListener(onStorageChanged);
        chrome.runtime.onMessage.addListener(onMessage);
        syncFromStorage(false);
    }

    if (document.documentElement) {
        boot();
    } else {
        document.addEventListener('readystatechange', boot, { once: true });
    }
})();
