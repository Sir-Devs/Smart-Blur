/* ============================================================================
   Smart Blur — content script
   ----------------------------------------------------------------------------
   Developed by Ahmad Alhalabi — https://ahmadalhalabi.com/
   Copyright (c) 2025-2026 Ahmad Alhalabi. All rights reserved.
   Released under the MIT License. See LICENSE for details.
   ========================================================================== */

(function () {
    'use strict';
    if (window.top !== window.self) return;

    // =====================================================================
    // Constants
    // =====================================================================

    const OVERLAY_ID = 'smart-blur-overlay';
    const SPOTLIGHT_ID = 'smart-blur-spotlight';
    const PICKER_ID = 'smart-blur-picker';

    const CLASS_IDLE = 'sb-idle';
    const CLASS_DIMMING = 'sb-dimming';
    const CLASS_INSTANT = 'sb-instant';
    const CLASS_BLACKOUT = 'sb-blackout';
    const CLASS_ACTIVE = 'sb-active';
    const CLASS_PICKING = 'sb-picking';
    const CLASS_LABEL_INSIDE = 'sb-label-inside';
    const CLASS_CLUTTER = 'sb-clutter';
    const CLASS_MAIN = 'sb-focus-main';

    const DEFAULT_SIZE = 170;
    const MIN_SIZE = 60;
    const MAX_SIZE = 400;
    const HOLE_RATIO = 2.75;
    const MEDIA_SLOTS = 3;

    const SLOT_VARS = [
        { x: '--v-x',  y: '--v-y',  w: '--v-w',  h: '--v-h'  },
        { x: '--v2-x', y: '--v2-y', w: '--v2-w', h: '--v2-h' },
        { x: '--v3-x', y: '--v3-y', w: '--v3-w', h: '--v3-h' }
    ];

    const PARKED = { x: '-9999px', y: '-9999px', w: '0px', h: '0px' };

    const MEDIA_SELECTOR = [
        'video',
        'iframe[src*="youtube.com"]',
        'iframe[src*="youtube-nocookie.com"]',
        'iframe[src*="youtu.be"]',
        'iframe[src*="vimeo.com"]',
        'iframe[src*="dailymotion.com"]',
        'iframe[src*="twitch.tv"]'
    ].join(',');

    const AD_SELECTOR = [
        'ins.adsbygoogle',
        '[id^="google_ads"]',
        '[id*="div-gpt-ad"]',
        '[data-ad-slot]',
        '[data-ad-client]',
        'aside',
        '[role="complementary"]',
        '[class*="sidebar"]',
        '[id*="sidebar"]',
        '[class*="advert"]',
        '[id*="advert"]',
        '[class*="promo"]',
        '[class*="newsletter"]',
        '[class*="related-post"]',
        '[class*="recommend"]'
    ].join(',');

    const MIN_CLUTTER_AREA = 6000;
    const MIN_PICK_AREA = 400;

    const MUTATION_DEBOUNCE_MS = 350;
    const IO_ROOT_MARGIN = '150px';
    const MEDIA_POLL_MS = 250;
    const DEFAULT_IDLE_TIMEOUT = 15000;
    const IDLE_CHOICES = [0, 5000, 15000, 30000];

    // =====================================================================
    // State
    // =====================================================================

    let overlay = null;
    let spotlight = null;
    let picker = null;
    let pickerLabel = null;

    let isEnabled = false;
    let currentSite = window.location.hostname;

    const settings = {
        spotlightSize: DEFAULT_SIZE,
        blurVideos: false,
        articleFocus: false,
        idleTimeout: DEFAULT_IDLE_TIMEOUT,
        panicEnabled: true
    };

    // Frame lane
    let pointerX = -9999;
    let pointerY = -9999;
    let pointerDirty = false;
    let mediaDirty = false;
    let pickDirty = false;
    let frameRafId = null;

    // Mutate lane
    let mutateRafId = null;
    const writeQueue = [];

    // Scan lane
    let scanHandle = null;
    let scanIsIdleCallback = false;

    // Observers
    let mediaObserver = null;
    let mediaResizeObserver = null;
    let clutterObserver = null;
    let domObserver = null;
    let domDebounceTimer = null;
    let mediaPollTimer = null;

    const visibleMedia = new Map();
    const observedMedia = new WeakSet();
    const observedClutter = new WeakSet();

    const slotCache = [];
    for (let i = 0; i < MEDIA_SLOTS; i++) slotCache.push(null);

    // Interactive focus
    let pickBase = null;
    let pickDepth = 0;
    let pickTarget = null;
    let pickShown = false;
    let focusRoot = null;
    let wheelBound = false;

    // Spotlight size state
    let autoBlurred = false;
    let panicOn = false;
    let lastMoveAt = 0;
    let idleTimer = null;

    let lastUrl = location.href;

    // =====================================================================
    // Scheduling primitives
    // =====================================================================

    function scheduleFrame() {
        if (frameRafId === null) frameRafId = requestAnimationFrame(renderFrame);
    }

    function scheduleWrite(job) {
        writeQueue.push(job);
        if (mutateRafId === null) mutateRafId = requestAnimationFrame(flushWrites);
    }

    function flushWrites() {
        mutateRafId = null;
        const jobs = writeQueue.splice(0, writeQueue.length);
        for (let i = 0; i < jobs.length; i++) {
            try { jobs[i](); } catch (error) { }
        }
    }

    function scheduleScan(fn) {
        cancelScan();
        if (typeof window.requestIdleCallback === 'function') {
            scanIsIdleCallback = true;
            scanHandle = window.requestIdleCallback(fn, { timeout: 1000 });
        } else {
            scanIsIdleCallback = false;
            scanHandle = window.setTimeout(fn, 50);
        }
    }

    function cancelScan() {
        if (scanHandle === null) return;
        if (scanIsIdleCallback && typeof window.cancelIdleCallback === 'function') {
            window.cancelIdleCallback(scanHandle);
        } else if (!scanIsIdleCallback) {
            window.clearTimeout(scanHandle);
        }
        scanHandle = null;
    }

    // =====================================================================
    // Helpers
    // =====================================================================
    function clampSize(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return DEFAULT_SIZE;
        return Math.min(MAX_SIZE, Math.max(MIN_SIZE, n));
    }

    function clampIdle(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return DEFAULT_IDLE_TIMEOUT;
        return IDLE_CHOICES.indexOf(n) === -1 ? DEFAULT_IDLE_TIMEOUT : n;
    }

    function isOwnNode(node) {
        return !!node && node.nodeType === 1 &&
            (node.id === OVERLAY_ID || node.id === SPOTLIGHT_ID || node.id === PICKER_ID);
    }

    // =====================================================================
    // Spotlight size — three sources of truth, one resolved value
    // =====================================================================
    function effectiveSize() {
        if (panicOn || autoBlurred) return 0;
        return settings.spotlightSize;
    }

    function writeSize(mode) {
        if (!overlay || !spotlight) return;

        const px = effectiveSize();
        const holeRadius = (px * HOLE_RATIO) / 2;
        const dim = mode === 'dim';
        const instant = mode === 'instant';

        overlay.classList.toggle(CLASS_DIMMING, dim);
        spotlight.classList.toggle(CLASS_DIMMING, dim);
        overlay.classList.toggle(CLASS_INSTANT, instant);
        spotlight.classList.toggle(CLASS_INSTANT, instant);
        spotlight.classList.toggle(CLASS_BLACKOUT, px === 0);

        overlay.style.setProperty('--sb-hole', holeRadius + 'px');
        spotlight.style.setProperty('--sb-size', px + 'px');

        if (instant) {
            requestAnimationFrame(function () {
                if (!overlay || !spotlight) return;
                overlay.classList.remove(CLASS_INSTANT);
                spotlight.classList.remove(CLASS_INSTANT);
            });
        }
    }

    // =====================================================================
    // Idle auto-blur
    // =====================================================================
    function armIdleTimer(delay) {
        if (idleTimer !== null) { clearTimeout(idleTimer); idleTimer = null; }
        if (!settings.idleTimeout) return;
        idleTimer = setTimeout(checkIdle, delay);
    }

    function cancelIdleBlur() {
        if (idleTimer !== null) { clearTimeout(idleTimer); idleTimer = null; }
        if (autoBlurred) {
            autoBlurred = false;
            scheduleWrite(function () { writeSize('instant'); });
        }
    }

    function checkIdle() {
        idleTimer = null;
        if (!overlay || !isEnabled) return;

        if (!settings.idleTimeout) return;

        const elapsed = performance.now() - lastMoveAt;

        if (elapsed >= settings.idleTimeout) {
            if (!autoBlurred) {
                autoBlurred = true;
                scheduleWrite(function () { writeSize('dim'); });
            }
        } else {
            armIdleTimer(settings.idleTimeout - elapsed);
        }
    }

    // =====================================================================
    // Frame lane
    // =====================================================================
    function handleMouseMove(event) {
        if (!overlay) return;

        pointerX = event.clientX;
        pointerY = event.clientY;
        pointerDirty = true;

        const wantPick = settings.articleFocus && event.altKey === true;
        pickBase = wantPick ? event.target : null;

        if (wantPick) {
            if (!wheelBound) bindWheel();
            const html = document.documentElement;
            if (!html.classList.contains(CLASS_PICKING)) html.classList.add(CLASS_PICKING);
        }

        const next = resolvePickTarget();
        if (next !== pickTarget) {
            pickTarget = next;
            pickDirty = true;
        }

        scheduleFrame();
    }

    function invalidateMediaGeometry() {
        if (!overlay) return;
        mediaDirty = true;
        scheduleFrame();
    }

    function renderFrame() {
        frameRafId = null;
        if (!overlay || !spotlight) return;
        let slots = null;
        if (mediaDirty) {
            mediaDirty = false;
            slots = readMediaSlots();
        }

        let pickBox;
        let pickChanged = false;
        if (pickDirty) {
            pickDirty = false;
            pickChanged = true;
            pickBox = readPickBox();
        }

        if (pointerDirty) {
            pointerDirty = false;
            lastMoveAt = performance.now();

            if (autoBlurred) {
                autoBlurred = false;
                writeSize('instant');
            }
            if (idleTimer === null && !panicOn) {
                armIdleTimer(settings.idleTimeout);
            }

            const x = pointerX + 'px';
            const y = pointerY + 'px';
            overlay.style.setProperty('--sb-x', x);
            overlay.style.setProperty('--sb-y', y);
            spotlight.style.setProperty('--sb-x', x);
            spotlight.style.setProperty('--sb-y', y);

            overlay.classList.remove(CLASS_IDLE);
            spotlight.classList.remove(CLASS_IDLE);
        }

        if (pickChanged) writePickBox(pickBox);
        if (slots !== null) writeMediaSlots(slots);
    }

    function handleMouseLeave(event) {
        if (!overlay || !spotlight) return;
        if (event.relatedTarget !== null && event.relatedTarget.nodeName !== 'HTML') return;

        pointerDirty = false;
        overlay.classList.add(CLASS_IDLE);
        spotlight.classList.add(CLASS_IDLE);
    }

    function handleMouseEnter() {
        if (!overlay || !spotlight) return;
        overlay.classList.remove(CLASS_IDLE);
        spotlight.classList.remove(CLASS_IDLE);
    }

    // =====================================================================
    // Feature — media cut-out
    // =====================================================================
    function readMediaSlots() {
        if (settings.blurVideos || panicOn) return [];

        const ranked = [];

        visibleMedia.forEach(function (area, el) {
            if (!el.isConnected) {
                visibleMedia.delete(el);
                return;
            }
            ranked.push({ el: el, area: area });
        });

        if (ranked.length === 0) return [];

        ranked.sort(function (a, b) { return b.area - a.area; });

        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const slots = [];

        for (let i = 0; i < ranked.length && slots.length < MEDIA_SLOTS; i++) {
            const rect = ranked[i].el.getBoundingClientRect();

            if (rect.width < 1 || rect.height < 1) continue;
            if (rect.bottom <= 0 || rect.top >= vh) continue;
            if (rect.right <= 0 || rect.left >= vw) continue;

            slots.push({
                x: Math.round(rect.left) + 'px',
                y: Math.round(rect.top) + 'px',
                w: Math.round(rect.width) + 'px',
                h: Math.round(rect.height) + 'px'
            });
        }

        return slots;
    }

    function writeMediaSlots(slots) {
        for (let i = 0; i < MEDIA_SLOTS; i++) {
            const next = slots[i] || PARKED;
            const prev = slotCache[i];

            if (prev &&
                prev.x === next.x && prev.y === next.y &&
                prev.w === next.w && prev.h === next.h) {
                continue;
            }

            const vars = SLOT_VARS[i];
            overlay.style.setProperty(vars.x, next.x);
            overlay.style.setProperty(vars.y, next.y);
            overlay.style.setProperty(vars.w, next.w);
            overlay.style.setProperty(vars.h, next.h);

            slotCache[i] = next;
        }
    }

    function handleMediaIntersect(entries) {
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const el = entry.target;

            if (entry.isIntersecting && el.isConnected) {
                const r = entry.intersectionRect;
                visibleMedia.set(el, r.width * r.height);
                if (mediaResizeObserver) mediaResizeObserver.observe(el);
            } else {
                visibleMedia.delete(el);
                if (mediaResizeObserver) mediaResizeObserver.unobserve(el);
            }
        }

        updateMediaPoll();
        invalidateMediaGeometry();
    }

    function updateMediaPoll() {
        const shouldPoll = visibleMedia.size > 0 && !settings.blurVideos && !panicOn;

        if (shouldPoll && mediaPollTimer === null) {
            mediaPollTimer = window.setInterval(invalidateMediaGeometry, MEDIA_POLL_MS);
        } else if (!shouldPoll && mediaPollTimer !== null) {
            window.clearInterval(mediaPollTimer);
            mediaPollTimer = null;
        }
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

    // =====================================================================
    // Feature — interactive focus (Alt+hover / Alt+click)
    // =====================================================================
    function resolvePickTarget() {
        let el = pickBase;
        if (!el || el.nodeType !== 1) return null;

        let climb = pickDepth;
        while (climb-- > 0) {
            const parent = el.parentElement;
            if (!parent || parent === document.body || parent === document.documentElement) break;
            el = parent;
        }
        return el;
    }

    function describeElement(el) {
        let text = el.tagName.toLowerCase();
        if (el.id) text += '#' + el.id;
        else if (typeof el.className === 'string' && el.className.trim()) {
            text += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
        }
        if (text.length > 44) text = text.slice(0, 43) + '…';
        return text + (pickDepth > 0 ? '  ↑' + pickDepth : '');
    }

    function readPickBox() {
        if (!pickTarget || !pickTarget.isConnected) return null;
        if (isOwnNode(pickTarget)) return null;

        const tag = pickTarget.tagName;
        if (tag === 'HTML' || tag === 'BODY') return null;

        const rect = pickTarget.getBoundingClientRect();
        if (rect.width * rect.height < MIN_PICK_AREA) return null;

        return {
            x: Math.round(rect.left) + 'px',
            y: Math.round(rect.top) + 'px',
            w: Math.round(rect.width) + 'px',
            h: Math.round(rect.height) + 'px',
            label: describeElement(pickTarget),
            labelInside: rect.top < 24
        };
    }

    function writePickBox(box) {
        if (!picker) return;

        if (!box) {
            if (pickShown) {
                picker.classList.remove(CLASS_ACTIVE);
                pickShown = false;
            }
            return;
        }

        picker.style.setProperty('--p-x', box.x);
        picker.style.setProperty('--p-y', box.y);
        picker.style.setProperty('--p-w', box.w);
        picker.style.setProperty('--p-h', box.h);

        if (pickerLabel && pickerLabel.textContent !== box.label) {
            pickerLabel.textContent = box.label;
        }
        picker.classList.toggle(CLASS_LABEL_INSIDE, box.labelInside);

        if (!pickShown) {
            picker.classList.add(CLASS_ACTIVE);
            pickShown = true;
        }
    }

    function clearPicker() {
        pickBase = null;
        pickTarget = null;
        pickDepth = 0;
        pickDirty = true;
        unbindWheel();
        document.documentElement.classList.remove(CLASS_PICKING);
        scheduleFrame();
    }

    function bindWheel() {
        if (wheelBound) return;
        window.addEventListener('wheel', handlePickWheel, { capture: true, passive: false });
        wheelBound = true;
    }

    function unbindWheel() {
        if (!wheelBound) return;
        window.removeEventListener('wheel', handlePickWheel, { capture: true });
        wheelBound = false;
    }

    function handlePickWheel(event) {
        if (!settings.articleFocus || !event.altKey || !pickBase) return;

        event.preventDefault();
        event.stopPropagation();

        if (event.deltaY < 0) {
            pickDepth++;
        } else if (event.deltaY > 0 && pickDepth > 0) {
            pickDepth--;
        } else {
            return;
        }

        const next = resolvePickTarget();
        if (next === pickTarget) {
            if (event.deltaY < 0) pickDepth--;
            return;
        }

        pickTarget = next;
        pickDirty = true;
        scheduleFrame();
    }

    function handlePickClick(event) {
        if (!settings.articleFocus || !event.altKey) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        if (event.type !== 'click') return;

        if (focusRoot) {
            setFocusRoot(null);
            return;
        }

        pickBase = event.target;
        const target = resolvePickTarget();

        if (!target || target.nodeType !== 1) return;
        if (isOwnNode(target)) return;

        const tag = target.tagName;
        if (tag === 'HTML' || tag === 'BODY') return;

        setFocusRoot(target);
    }

    function setFocusRoot(el) {
        const previous = focusRoot;
        focusRoot = el;

        if (!el) {
            scheduleWrite(clearClutter);
            clearPicker();
            return;
        }

        const clutter = collectClutter(el);

        scheduleWrite(function () {
            if (previous) previous.classList.remove(CLASS_MAIN);
            clearClutter();
            el.classList.add(CLASS_MAIN);

            for (let i = 0; i < clutter.length; i++) {
                const node = clutter[i];
                if (observedClutter.has(node)) continue;
                observedClutter.add(node);
                if (clutterObserver) clutterObserver.observe(node);
            }
        });

        clearPicker();
    }

    function collectClutter(main) {
        const candidates = new Set();
        let node = main;

        while (node && node.parentElement && node !== document.body) {
            const siblings = node.parentElement.children;
            for (let i = 0; i < siblings.length; i++) {
                if (siblings[i] !== node) candidates.add(siblings[i]);
            }
            node = node.parentElement;
        }

        const ads = document.querySelectorAll(AD_SELECTOR);
        for (let i = 0; i < ads.length; i++) candidates.add(ads[i]);

        const keep = [];

        candidates.forEach(function (el) {
            if (isOwnNode(el)) return;

            const tag = el.tagName;
            if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' ||
                tag === 'NOSCRIPT' || tag === 'TEMPLATE') return;

            if (el.contains(main) || main.contains(el)) return;
            if (el.querySelector(MEDIA_SELECTOR)) return;

            let redundant = false;
            candidates.forEach(function (other) {
                if (other !== el && other.contains(el)) redundant = true;
            });
            if (redundant) return;

            const rect = el.getBoundingClientRect();
            if (rect.width * rect.height < MIN_CLUTTER_AREA) return;

            keep.push(el);
        });

        return keep;
    }

    function handleClutterIntersect(entries) {
        if (!settings.articleFocus || !focusRoot) return;

        const enter = [];
        const leave = [];

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            if (!entry.target.isConnected) continue;
            (entry.isIntersecting ? enter : leave).push(entry.target);
        }

        if (enter.length === 0 && leave.length === 0) return;

        scheduleWrite(function () {
            for (let i = 0; i < enter.length; i++) enter[i].classList.add(CLASS_CLUTTER);
            for (let i = 0; i < leave.length; i++) leave[i].classList.remove(CLASS_CLUTTER);
        });
    }

    function clearClutter() {
        if (clutterObserver) clutterObserver.disconnect();

        const marked = document.querySelectorAll('.' + CLASS_CLUTTER + ', .' + CLASS_MAIN);
        for (let i = 0; i < marked.length; i++) {
            marked[i].classList.remove(CLASS_CLUTTER, CLASS_MAIN);
        }
    }

    function refreshFocus() {
        if (!settings.articleFocus || !focusRoot) return;

        if (!focusRoot.isConnected) {
            focusRoot = null;
            scheduleWrite(clearClutter);
            return;
        }

        const clutter = collectClutter(focusRoot);

        scheduleWrite(function () {
            focusRoot.classList.add(CLASS_MAIN);
            for (let i = 0; i < clutter.length; i++) {
                const node = clutter[i];
                if (observedClutter.has(node)) continue;
                observedClutter.add(node);
                if (clutterObserver) clutterObserver.observe(node);
            }
        });
    }

    // =====================================================================
    // Feature — panic key
    // =====================================================================

    function handleKeyDown(event) {
        if (event.repeat) return;

        if (event.key === 'Escape' && settings.panicEnabled &&
            !event.ctrlKey && !event.metaKey && !event.altKey) {
            panicOn = !panicOn;

            if (panicOn) {
                if (idleTimer !== null) { clearTimeout(idleTimer); idleTimer = null; }
            } else {
                lastMoveAt = performance.now();
                armIdleTimer(settings.idleTimeout);
            }

            updateMediaPoll();
            invalidateMediaGeometry();
            scheduleWrite(function () { writeSize('instant'); });
            return;
        }

        if (event.key === 'Alt' && settings.articleFocus) {
            pickDepth = 0;
            document.documentElement.classList.add(CLASS_PICKING);
            bindWheel();
        }
    }

    function handleKeyUp(event) {
        if (event.key === 'Alt') clearPicker();
    }

    function handleWindowBlur() {
        clearPicker();
    }

    // =====================================================================
    // Combined scan
    // =====================================================================

    function runScan() {
        scanHandle = null;
        if (!isEnabled || !overlay) return;
        scanMedia();
        refreshFocus();
    }

    // =====================================================================
    // DOM lifecycle
    // =====================================================================

    function createOverlay() {
        if (overlay) return;

        const root = document.body || document.documentElement;
        if (!root) return;

        overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.classList.add(CLASS_IDLE);

        spotlight = document.createElement('div');
        spotlight.id = SPOTLIGHT_ID;
        spotlight.classList.add(CLASS_IDLE);

        picker = document.createElement('div');
        picker.id = PICKER_ID;
        pickerLabel = document.createElement('span');
        pickerLabel.className = 'sb-pick-label';
        picker.appendChild(pickerLabel);
        root.appendChild(overlay);
        root.appendChild(spotlight);
        root.appendChild(picker);

        writeSize('instant');

        document.addEventListener('mousemove', handleMouseMove, { passive: true });
        document.addEventListener('mouseleave', handleMouseLeave);
        document.addEventListener('mouseenter', handleMouseEnter);
        document.addEventListener('scroll', invalidateMediaGeometry, { passive: true, capture: true });
        window.addEventListener('resize', invalidateMediaGeometry, { passive: true });
        document.addEventListener('fullscreenchange', invalidateMediaGeometry);
        window.addEventListener('click', handlePickClick, true);
        window.addEventListener('mousedown', handlePickClick, true);
        window.addEventListener('mouseup', handlePickClick, true);

        window.addEventListener('keydown', handleKeyDown, true);
        window.addEventListener('keyup', handleKeyUp, true);
        window.addEventListener('blur', handleWindowBlur);

        mediaObserver = new IntersectionObserver(handleMediaIntersect, {
            rootMargin: IO_ROOT_MARGIN,
            threshold: [0, 0.25, 0.5, 0.75, 1]
        });

        if (typeof ResizeObserver === 'function') {
            mediaResizeObserver = new ResizeObserver(invalidateMediaGeometry);
        }

        clutterObserver = new IntersectionObserver(handleClutterIntersect, {
            rootMargin: IO_ROOT_MARGIN
        });

        lastMoveAt = performance.now();
        armIdleTimer(settings.idleTimeout);

        startDomObserver();
        scheduleScan(runScan);
    }

    function removeOverlay() {
        if (!overlay) return;

        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseleave', handleMouseLeave);
        document.removeEventListener('mouseenter', handleMouseEnter);
        document.removeEventListener('scroll', invalidateMediaGeometry, { capture: true });
        window.removeEventListener('resize', invalidateMediaGeometry);
        document.removeEventListener('fullscreenchange', invalidateMediaGeometry);

        window.removeEventListener('click', handlePickClick, true);
        window.removeEventListener('mousedown', handlePickClick, true);
        window.removeEventListener('mouseup', handlePickClick, true);
        window.removeEventListener('keydown', handleKeyDown, true);
        window.removeEventListener('keyup', handleKeyUp, true);
        window.removeEventListener('blur', handleWindowBlur);
        unbindWheel();

        stopDomObserver();
        cancelScan();

        if (frameRafId !== null) { cancelAnimationFrame(frameRafId); frameRafId = null; }
        if (mutateRafId !== null) { cancelAnimationFrame(mutateRafId); mutateRafId = null; }
        writeQueue.length = 0;

        if (idleTimer !== null) { clearTimeout(idleTimer); idleTimer = null; }
        if (mediaPollTimer !== null) { window.clearInterval(mediaPollTimer); mediaPollTimer = null; }
        if (mediaObserver) { mediaObserver.disconnect(); mediaObserver = null; }
        if (mediaResizeObserver) { mediaResizeObserver.disconnect(); mediaResizeObserver = null; }
        if (clutterObserver) { clutterObserver.disconnect(); clutterObserver = null; }

        visibleMedia.clear();
        for (let i = 0; i < MEDIA_SLOTS; i++) slotCache[i] = null;

        clearClutter();
        focusRoot = null;
        pickTarget = null;
        pickShown = false;
        autoBlurred = false;
        document.documentElement.classList.remove(CLASS_PICKING);

        overlay.remove();
        if (spotlight) spotlight.remove();
        if (picker) picker.remove();
        overlay = null;
        spotlight = null;
        picker = null;
        pickerLabel = null;
    }

    // =====================================================================
    // Debounced MutationObserver
    // =====================================================================
    function startDomObserver() {
        if (domObserver) return;

        domObserver = new MutationObserver(function (mutations) {
            let relevant = false;

            for (let i = 0; i < mutations.length; i++) {
                const m = mutations[i];
                if (isOwnNode(m.target)) continue;

                let selfOnly = m.addedNodes.length > 0;
                for (let j = 0; j < m.addedNodes.length; j++) {
                    if (!isOwnNode(m.addedNodes[j])) { selfOnly = false; break; }
                }
                if (selfOnly) continue;

                relevant = true;
                break;
            }
            if (!relevant) return;

            if (domDebounceTimer !== null) clearTimeout(domDebounceTimer);
            domDebounceTimer = setTimeout(function () {
                domDebounceTimer = null;

                if (location.href !== lastUrl) {
                    lastUrl = location.href;
                    currentSite = new URL(location.href).hostname;
                    focusRoot = null;
                    scheduleWrite(clearClutter);
                    refreshFromStorage();
                }

                scheduleScan(runScan);
            }, MUTATION_DEBOUNCE_MS);
        });

        domObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    function stopDomObserver() {
        if (domDebounceTimer !== null) { clearTimeout(domDebounceTimer); domDebounceTimer = null; }
        if (domObserver) { domObserver.disconnect(); domObserver = null; }
    }

    // =====================================================================
    // Enable / disable
    // =====================================================================

    function updateEffect(globalEnabled, disabledSites) {
        const shouldBeEnabled = globalEnabled && !disabledSites.includes(currentSite);

        if (shouldBeEnabled && !isEnabled) {
            isEnabled = true;
            createOverlay();
        } else if (!shouldBeEnabled && isEnabled) {
            isEnabled = false;
            removeOverlay();
        }
    }

    function refreshFromStorage() {
        chrome.storage.local.get(['globalEnabled', 'disabledSites'], function (data) {
            updateEffect(data.globalEnabled !== false, data.disabledSites || []);
        });
    }

    // =====================================================================
    // Boot
    // =====================================================================

    chrome.storage.local.get(
        ['globalEnabled', 'disabledSites', 'spotlightSize', 'blurVideos',
         'articleFocus', 'idleTimeout', 'panicEnabled'],
        function (data) {
            settings.spotlightSize = clampSize(data.spotlightSize);
            settings.blurVideos = data.blurVideos === true;
            settings.articleFocus = data.articleFocus === true;
            settings.idleTimeout = clampIdle(
                data.idleTimeout === undefined ? DEFAULT_IDLE_TIMEOUT : data.idleTimeout);
            settings.panicEnabled = data.panicEnabled !== false;

            const globalEnabled = data.globalEnabled !== false;
            const disabledSites = data.disabledSites || [];

            isEnabled = globalEnabled && !disabledSites.includes(currentSite);
            if (isEnabled) createOverlay();
        }
    );

    // =====================================================================
    // Messaging
    // =====================================================================

    chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
        if (request.action === 'updateEffect') {
            if (request.globalEnabled === undefined && request.disabledSites === undefined) {
                refreshFromStorage();
            } else {
                updateEffect(
                    request.globalEnabled !== undefined ? request.globalEnabled : true,
                    request.disabledSites || []
                );
            }
            sendResponse({ success: true });
        }
        return true;
    });

    // =====================================================================
    // Storage changes
    // =====================================================================

    chrome.storage.onChanged.addListener(function (changes, namespace) {
        if (namespace !== 'local') return;

        if (changes.spotlightSize) {
            settings.spotlightSize = clampSize(changes.spotlightSize.newValue);
            scheduleWrite(function () { writeSize('normal'); });
        }

        if (changes.blurVideos) {
            settings.blurVideos = changes.blurVideos.newValue === true;
            updateMediaPoll();
            invalidateMediaGeometry();
        }

        if (changes.articleFocus) {
            settings.articleFocus = changes.articleFocus.newValue === true;

            if (!settings.articleFocus) {
                focusRoot = null;
                clearPicker();
                scheduleWrite(clearClutter);
            }
        }

        if (changes.idleTimeout) {
            settings.idleTimeout = clampIdle(changes.idleTimeout.newValue);

            cancelIdleBlur();
            lastMoveAt = performance.now();
            if (!panicOn) armIdleTimer(settings.idleTimeout);
        }

        if (changes.panicEnabled) {
            settings.panicEnabled = changes.panicEnabled.newValue !== false;

            if (!settings.panicEnabled && panicOn) {
                panicOn = false;
                lastMoveAt = performance.now();
                armIdleTimer(settings.idleTimeout);
                updateMediaPoll();
                invalidateMediaGeometry();
                scheduleWrite(function () { writeSize('instant'); });
            }
        }

        if (changes.globalEnabled || changes.disabledSites) {
            refreshFromStorage();
        }
    });

    // =====================================================================
    // Teardown
    // =====================================================================

    window.addEventListener('pagehide', function () {
        stopDomObserver();
        cancelScan();
        if (idleTimer !== null) { clearTimeout(idleTimer); idleTimer = null; }
        if (mediaPollTimer !== null) { window.clearInterval(mediaPollTimer); mediaPollTimer = null; }
        unbindWheel();
        if (mediaObserver) mediaObserver.disconnect();
        if (mediaResizeObserver) mediaResizeObserver.disconnect();
        if (clutterObserver) clutterObserver.disconnect();
    }, { once: true });
})();
