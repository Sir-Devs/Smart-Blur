# 🧿 Smart Blur

**A privacy overlay for Google Chrome.** It blurs the whole page and keeps a clear "spotlight" that follows your mouse cursor, so only the part you are actually reading is legible to anyone else looking at your screen.

Developed by **Ahmad Alhalabi** — [ahmadalhalabi.com](https://ahmadalhalabi.com/)

![Manifest V3](https://img.shields.io/badge/Manifest-V3-4CAF50)
![License MIT](https://img.shields.io/badge/License-MIT-2196F3)
![Chrome 120+](https://img.shields.io/badge/Chrome-120%2B-ff9800)

---

<div dir="rtl">
## What is Smart Blur?

**Smart Blur** is a Google Chrome extension that protects your on-screen privacy. It blurs the entire page and leaves a transparent "spotlight" that follows your mouse cursor, so only the part you are actually reading stays legible.

Useful in cafés, open-plan offices, on planes, and while screen-sharing in meetings.

## Features

**Cursor spotlight** — a transparent circle tracks your mouse smoothly, with an adjustable diameter from 60px to 400px.

**Automatic video bypass** — the extension detects video players (`<video>` elements plus YouTube, Vimeo, Twitch and Dailymotion embeds) and subtracts their bounding boxes from the blur layer, so they stay perfectly sharp while the rest of the page stays blurred. Turn on *Blur Videos* if you would rather have them blurred like everything else.

**Article Focus (manual selection)** — instead of guessing which part of the page matters, you pick it yourself:

- Hold **Alt** and move the mouse — a dashed red outline highlights the element under the cursor, labelled with its tag and class.
- **Alt + wheel up** — widen the selection to the parent element (for example, from one paragraph to the whole article).
- **Alt + wheel down** — narrow it back toward the original element.
- **Alt + click** — lock the selection. The chosen element stays perfectly clear while sidebars, ads and headers around it stay permanently blurred.
- **Alt + click again** — release the lock and return to normal cursor tracking.

**Idle auto-blur** — if the mouse sits still for a duration you choose (Off / 5s / 15s / 30s), the spotlight smoothly closes and the whole screen blurs. Any mouse movement restores it instantly.

**Panic button (boss key)** — press **Esc** to black out the screen instantly, including video. Press **Esc** again to restore. The feature can be disabled from the control panel.

**Per-site control** — disable the extension on one site while keeping it active everywhere else.

## Installation

The extension is not published on the Chrome Web Store yet, so it is installed manually as an unpacked extension:

1. Download or clone the project:
   ```bash
   git clone https://github.com/ahmadcodes-de/smart-blur.git
   ```
   Or download the ZIP from GitHub and extract it into a permanent folder.

2. Open Chrome and navigate to:
   ```
   chrome://extensions
   ```

3. Enable **Developer mode** using the toggle in the top-right corner.

4. Click **Load unpacked**.

5. Select the project folder (the one containing `manifest.json`).

6. The extension icon appears in your toolbar. Click it to open the control panel.

> **Important:** do not delete the folder after installing — Chrome reads the files from that location directly. Deleting the folder breaks the extension.

### Updating

After editing any file, return to `chrome://extensions`, click the reload button (🔄) on the Smart Blur card, then refresh any open tabs.

## Control panel

| Setting | What it does | Default |
|---|---|---|
| Turn Off Everywhere | Master on/off switch for all sites | Enabled |
| Disable On This Site | Turn the effect off for the current site only | Enabled |
| Spotlight Size | Spotlight diameter (60–400 px) | 170 px |
| Blur Videos | Blur video players like the rest of the page | Off |
| Article Focus | Arm the Alt-based manual selection tool | Off |
| Idle Auto-Blur | Stillness delay before the screen blurs | 15 seconds |
| Panic Button | Enable the Esc instant-blackout key | Enabled |

## Project structure

| File | Role |
|---|---|
| `manifest.json` | Manifest V3 definition, permissions, entry points |
| `content.js` | Overlay lifecycle, cursor tracking, media detection, Alt picker |
| `content.css` | All static presentation, mask compositing, animations |
| `popup.html` | Control panel markup and styling |
| `popup.js` | Binds every control to `chrome.storage.local` |
| `background.js` | Service worker: seeds defaults, syncs tabs |

## Technical notes

**Mask compositing instead of z-index.** Videos are not lifted above the overlay — their bounding boxes are subtracted from the overlay's mask using four layers combined with `mask-composite: subtract, add, add, add`. Raising the z-index of a player's ancestors would hoist entire framework roots (`ytd-app` on YouTube) above the overlay and break the blur completely. Up to three players can be cut out simultaneously.

**Read/write separation.** All layout reads happen before any style writes, in a single `requestAnimationFrame` callback. A frame driven purely by mouse movement performs zero layout reads. A burst of 1000 mousemove events resolves to one animation frame and a couple of style recalculations rather than 1000 forced reflows.

**Efficient idle detection.** The last-movement timestamp is stamped once per animation frame rather than per event, and one timer re-arms itself for the remaining interval instead of being rebuilt. 1000 mousemove events create zero new timers.

**Registered custom properties.** `--sb-hole` and `--sb-size` are declared with `@property` as `<length>` so they can be interpolated, which is what makes the idle auto-blur close smoothly. Cursor coordinates are deliberately left unregistered so they can never be interpolated and lag behind the pointer.

## Requirements

Google Chrome 120 or newer (or any Chromium-based browser such as Edge, Brave or Opera). Chrome 120 is required for the standard `mask-composite` property; a `-webkit-mask-composite` fallback is provided for older builds.

## Privacy

This extension **collects no data, sends nothing to any server, and makes no network requests at all.** Every setting is stored locally on your device via `chrome.storage.local` and never leaves it. There is no tracking or analytics code of any kind.

## License

MIT — see [LICENSE](LICENSE).

Anyone may use, modify, distribute and even sell this code, **provided** the copyright notice naming Ahmad Alhalabi is retained in all copies.

## Author

**Ahmad Alhalabi**
Website: [ahmadalhalabi.com](https://ahmadalhalabi.com/)

Copyright © 2025–2026 Ahmad Alhalabi. All rights reserved.
