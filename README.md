# 🧿 Smart Blur

**A privacy screen for Google Chrome.** Smart Blur blurs the whole page and keeps a clear spotlight around your mouse cursor, so only the part you are reading can be read by anyone looking at your screen.

[**Install from the Chrome Web Store**](https://chromewebstore.google.com/detail/smart-blur/jpldganokfniaogppagfgbbelcdpkgim)

Developed by **Ahmad Alhalabi** — [ahmadalhalabi.com](https://ahmadalhalabi.com/)

![Manifest V3](https://img.shields.io/badge/Manifest-V3-a855f7)
![License MIT](https://img.shields.io/badge/License-MIT-22d3ee)
![Chrome 120+](https://img.shields.io/badge/Chrome-120%2B-6d8cf5)

English · [العربية](#العربية)

---

## Features

**Cursor spotlight.** A clear area follows your mouse. You can set its size (40–400 px) and how strong the blur around it is (2–24 px). It comes in three shapes:

| Shape | What stays clear |
|---|---|
| **Circle** | A round spotlight around the cursor |
| **Line** | A band across the whole page that moves up and down with the cursor, comfortable for long articles |
| **Paragraph** | The paragraph, list item or heading under the cursor |

**Alt+Shift+L** switches between the shapes.

**Typing stays clear.** The field you type in is never blurred, even when the mouse is somewhere else. In long editors only the lines around the text cursor are cleared, not the whole editor.

**Touch screens.** On touch screens and with a pen, the spotlight moves to where you touch and stays there.

**Videos stay clear.** Video players (`<video>`, also inside web components, and YouTube, Vimeo, Twitch, Dailymotion, Loom, Wistia, Facebook, Kick, Streamable, Bilibili and TED embeds) are cut out of the blur, so you can keep watching while the rest of the page stays private. Turn off *Keep videos clear* to blur them too.

**Article Focus.** Pin one part of the page clear while everything else stays blurred:

| Keys | What happens |
|---|---|
| Hold **Alt** + move | A dashed frame highlights the element under the cursor and names it (Paragraph, Article, Image…) |
| **Alt** + scroll | Scroll up to widen the frame to the surrounding container, down to narrow it again |
| **Alt** + click | Pins the framed region. It stays fully clear and the spotlight turns off |
| **Alt** + click again | Releases the pin and brings the spotlight back |

On macOS, use **Option** instead of Alt. The frame appears after holding Alt for a moment, so quick Alt+clicks and shortcuts like Alt+Shift+S keep working on websites.

**Auto-blur when idle.** When you stop using the mouse and keyboard for 5, 15 or 30 seconds, the spotlight closes. Any key press, click, scroll or mouse movement opens it again. Videos stay clear while you sit still and watch.

**Panic key.** Press **Esc twice** quickly to cover the screen with an opaque layer, videos included. Press **Esc twice** again to uncover it. A single Esc still works normally on websites, for example to close dialogs or exit fullscreen.

**Per-site pause.** Pause Smart Blur on one website and keep it running everywhere else, or pause a whole domain with all its subdomains (`*.google.com`). Paused sites are listed in the panel, where you can resume them or add new ones by hand.

**Keyboard shortcuts.** **Alt+Shift+S** turns Smart Blur on or off on every site, and **Alt+Shift+L** switches the spotlight shape. You can change both at `chrome://extensions/shortcuts`.

**Toolbar badge.** The icon shows **OFF** on every tab where the blur is paused or turned off, and **–** on pages where Chrome does not allow extensions.

**English and Arabic.** The panel follows your browser language, with a right-to-left layout in Arabic.

## Control panel

| Setting | What it does | Default |
|---|---|---|
| Master switch (top right) | Turns Smart Blur on or off on every site | On |
| Pause here / Resume here | Turns it off or on for the current site only | Running |
| Pause all of `*.domain` | Turns it off for the current domain and all its subdomains | — |
| Spotlight shape | Circle, Line or Paragraph | Circle |
| Spotlight size / Line height | Size of the clear area (40–400 px) | 170 px |
| Blur strength | How strongly the rest of the page is blurred (2–24 px) | 8 px |
| Keep videos clear | Video players are not blurred | On |
| Keep typing clear | The field you type in is not blurred | On |
| Article Focus | Turns on the Alt-based region picker | Off |
| Auto-blur when idle | Time without input before the spotlight closes | 15 s |
| Panic key | Double Esc covers the screen | On |
| Paused sites | List of paused sites and domains; add `news.example.com` or `*.example.com` by hand | Empty |

## Installation

**From the Chrome Web Store** — [one click](https://chromewebstore.google.com/detail/smart-blur/jpldganokfniaogppagfgbbelcdpkgim).

**From source** (for development):

1. Clone the repository:
   ```bash
   git clone https://github.com/Sir-Devs/Smart-Blur.git
   ```
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the folder that contains `manifest.json`.

Tabs that are already open start working right away; there is no need to reload them. After editing the source, press the reload button on the Smart Blur card in `chrome://extensions`.

Smart Blur cannot run on Chrome's own pages (`chrome://…`, the New Tab page) or on the Chrome Web Store. Chrome blocks every extension there. To use it on local files, turn on **Allow access to file URLs** in the extension's details.

## Project structure

| File | Role |
|---|---|
| `manifest.json` | Manifest V3 definition, permissions, shortcut, entry points |
| `settings.js` | Defaults and validation for every stored setting, shared by all parts |
| `content.js` | Blur layer, spotlight, video cut-outs, Article Focus, idle and panic logic |
| `content.css` | Everything drawn on the page: mask compositing, ring, frame, toast |
| `frame.js` | Tells the top frame about typing and Esc presses inside iframes |
| `popup.html` / `popup.css` / `popup.js` | Control panel |
| `background.js` | Service worker: injects into open tabs, badge, shortcut, iframe relay |
| `_locales/` | English and Arabic text |

## Technical notes

**The page is never restyled.** The blur, the spotlight ring, the Article Focus frame and the toast are four nodes owned by the extension. Nothing is added to the page's own elements except a cursor class on `<html>` while picking. Adding filters or classes to page elements breaks layouts, because a `filter` re-parents `position: fixed` descendants.

**Top layer.** The four nodes are manual popovers, so they sit in the browser's top layer. Modal dialogs, page popovers, fullscreen elements and anything at the maximum z-index are blurred too, and the layers move back on top whenever the page opens something new there.

**Mask compositing instead of z-index.** Videos and the pinned region are not raised above the blur. Their rectangles, together with the field you type in and the paragraph under the cursor, are subtracted from the blur layer's mask with seven layers and `mask-composite: subtract, add, add, add, add, add, add`. Raising a player's ancestors would lift entire framework roots (such as `ytd-app` on YouTube) above the blur and break it.

**One frame, reads before writes.** Input handlers only record state. A single `requestAnimationFrame` callback does all layout reads first and all style writes after, so 1000 mouse events per second cost one frame, and a frame driven only by the mouse does no layout reads at all.

**No flash of content.** The content script runs at `document_start` and mounts the blur straight away with the default settings, then adjusts once the stored settings are read. A paused site may show the blur for a split second; the other way round would show the page before the blur.

**Cheap idle detection.** Input events only stamp a time. One timer checks the elapsed time when it fires and re-arms itself for the remainder, so continuous mouse movement creates no timer churn.

**Clean updates.** A newly injected script tells any older copy on the page to remove itself, and a script whose extension was disabled or removed unblurs the page on the next mouse move. If a framework replaces the page's `<html>` element, the blur is put back before the next paint.

**Iframes.** Key presses inside an iframe never reach the page around it. `frame.js` reports "there was input" (at most once a second) and Esc presses through the service worker, so typing in an iframe editor does not count as idle and Esc Esc works there too. Nothing else is sent — no keys, no positions — and the embedding page cannot see these messages. The spotlight itself does not follow the pointer into an iframe; it stays where the pointer entered it.

## Privacy

Smart Blur **collects no data, sends nothing anywhere and makes no network requests.** Settings are stored locally with `chrome.storage.local` and never leave your device. There is no tracking or analytics of any kind.

## What's new in 4.0

- New spotlight shapes: Line for long articles and Paragraph, switched with Alt+Shift+L
- The field you type in stays clear, and long editors clear only the lines around the text cursor
- The spotlight works on touch screens and with a pen
- Pause a whole domain with all its subdomains, and add paused sites by hand
- The spotlight ring has a light and a dark edge, so it is visible on white pages too
- The panic cover is fully opaque
- More video players stay clear: players inside web components, Loom, Wistia, Facebook, Kick, Streamable, Bilibili and TED
- Article Focus starts after holding Alt for a moment, so quick Alt+clicks and Alt shortcuts work on websites again
- The blur appears before the page paints even on pages loaded from cache
- The badge shows – on Chrome pages where no extension can run
- Smart Blur does no work in tabs you are not looking at
- Easier-to-read secondary text in the panel

## What's new in 3.0

- Redesigned control panel in the icon's colours, in English and Arabic
- New: blur strength, keyboard shortcut, OFF badge, paused-sites list
- Article Focus now keeps the pinned region fully clear, with readable labels and on-page hints
- Panic key moved to a double Esc and now covers the screen completely, so a single Esc no longer interferes with websites
- Idle auto-blur now counts keyboard, scroll and clicks as activity, including inside iframes, not only mouse movement
- Pages are blurred before they first paint, and tabs open at install time work without a reload
- Modal dialogs, pop-ups and fullscreen elements are now blurred too
- Fixed: Article Focus changed page layouts, busy pages never detected new videos, Back/Forward restored pages lost tracking, the page stayed blurred after the extension was disabled, and a constant background animation used GPU time on every tab

## License

MIT — see [LICENSE](LICENSE). Anyone may use, modify, distribute and sell this code, **provided** the copyright notice naming Ahmad Alhalabi is kept in all copies.

---

<div dir="rtl">

<h2 id="العربية">العربية</h2>

**شاشة خصوصية لمتصفح Google Chrome.** تضبّب إضافة Smart Blur الصفحة بالكامل وتُبقي بقعة واضحة حول مؤشر الماوس، فلا يستطيع من ينظر إلى شاشتك قراءة شيء إلا الجزء الذي تقرؤه أنت.

[**التثبيت من متجر Chrome**](https://chromewebstore.google.com/detail/smart-blur/jpldganokfniaogppagfgbbelcdpkgim)

تطوير **أحمد الحلبي** — [ahmadalhalabi.com](https://ahmadalhalabi.com/)

### المزايا

**بقعة الرؤية.** منطقة واضحة تتبع الماوس، ويمكنك ضبط حجمها (40–400 بكسل) وقوة التضبيب حولها (2–24 بكسل). ولها ثلاثة أشكال:

| الشكل | ما يبقى واضحاً |
|---|---|
| **دائرة** | دائرة حول المؤشر |
| **سطر** | شريط بعرض الصفحة يتحرك للأعلى والأسفل مع المؤشر، مريح لقراءة المقالات الطويلة |
| **فقرة** | الفقرة أو عنصر القائمة أو العنوان الذي تحت المؤشر |

**Alt+Shift+L** يبدّل بين الأشكال.

**الكتابة تبقى واضحة.** الحقل الذي تكتب فيه لا يُضبَّب أبداً حتى لو كان الماوس في مكان آخر. وفي المحررات الطويلة تبقى الأسطر القريبة من مؤشر الكتابة فقط واضحة، لا المحرر كله.

**الشاشات اللمسية.** على الشاشات اللمسية ومع القلم تنتقل بقعة الرؤية إلى مكان اللمس وتبقى فيه.

**إبقاء الفيديو واضحاً.** تُستثنى مشغّلات الفيديو (`<video>` حتى داخل مكوّنات الويب، وYouTube وVimeo وTwitch وDailymotion وLoom وWistia وFacebook وKick وStreamable وBilibili وTED) من التضبيب، فتتابع المشاهدة وتبقى بقية الصفحة محمية. أوقف خيار *إبقاء الفيديو واضحاً* إذا أردت تضبيبها أيضاً.

**التركيز على المقال.** ثبّت جزءاً من الصفحة واضحاً وتبقى بقية الصفحة مضبّبة:

| المفاتيح | النتيجة |
|---|---|
| إمساك **Alt** + تحريك الماوس | يظهر إطار متقطّع حول العنصر تحت المؤشر مع اسمه (فقرة، مقال، صورة…) |
| **Alt** + عجلة الماوس | للأعلى يوسّع الإطار إلى العنصر الأكبر، وللأسفل يضيّقه |
| **Alt** + نقر | يثبّت المنطقة المحددة فتبقى واضحة تماماً وتتوقف بقعة الرؤية |
| **Alt** + نقر مرة أخرى | يلغي التثبيت وتعود بقعة الرؤية |

على macOS استخدم **Option** بدلاً من Alt. يظهر الإطار بعد إمساك Alt لحظة، فيبقى النقر السريع مع Alt والاختصارات مثل Alt+Shift+S تعمل في المواقع.

**تضبيب عند الخمول.** إذا توقفت عن استخدام الماوس ولوحة المفاتيح لمدة 5 أو 15 أو 30 ثانية تُغلق بقعة الرؤية، وأي ضغطة أو نقرة أو تمرير أو حركة للماوس تعيدها. يبقى الفيديو واضحاً وأنت تشاهده دون حركة.

**زر الطوارئ.** اضغط **Esc مرتين** بسرعة لتغطية الشاشة بطبقة معتمة بالكامل، بما فيها الفيديو، ومرتين مجدداً لإظهارها. ضغطة Esc الواحدة تبقى تعمل كالمعتاد في المواقع، مثل إغلاق النوافذ المنبثقة أو الخروج من ملء الشاشة.

**إيقاف لكل موقع.** أوقف الإضافة على موقع واحد وأبقها تعمل في بقية المواقع، أو أوقفها على نطاق كامل بكل مواقعه الفرعية (`*.google.com`). تظهر المواقع المتوقفة في لوحة التحكم، ويمكنك إعادة تشغيلها أو إضافة مواقع جديدة يدوياً.

**اختصارات لوحة المفاتيح.** **Alt+Shift+S** يشغّل الإضافة أو يوقفها على كل المواقع، و**Alt+Shift+L** يبدّل شكل بقعة الرؤية. يمكنك تغييرهما من `chrome://extensions/shortcuts`.

**شارة على الأيقونة.** تظهر كلمة **OFF** على الأيقونة في كل تبويب أُوقف فيه التضبيب، وتظهر **–** في صفحات Chrome التي لا يسمح فيها بالإضافات.

**العربية والإنجليزية.** تظهر لوحة التحكم بلغة المتصفح، وباتجاه من اليمين إلى اليسار في العربية.

### لوحة التحكم

| الإعداد | الوظيفة | الافتراضي |
|---|---|---|
| المفتاح الرئيسي (أعلى اللوحة) | تشغيل الإضافة أو إيقافها على كل المواقع | مفعّل |
| إيقاف هنا / تشغيل هنا | إيقاف الإضافة أو تشغيلها على الموقع الحالي فقط | تعمل |
| إيقاف كل `*.domain` | إيقاف الإضافة على النطاق الحالي وكل مواقعه الفرعية | — |
| شكل بقعة الرؤية | دائرة أو سطر أو فقرة | دائرة |
| حجم بقعة الرؤية / ارتفاع السطر | حجم المنطقة الواضحة (40–400 بكسل) | 170 بكسل |
| قوة التضبيب | شدة تضبيب بقية الصفحة (2–24 بكسل) | 8 بكسل |
| إبقاء الفيديو واضحاً | عدم تضبيب مشغّلات الفيديو | مفعّل |
| إبقاء الكتابة واضحة | عدم تضبيب الحقل الذي تكتب فيه | مفعّل |
| التركيز على المقال | تفعيل أداة اختيار المنطقة بمفتاح Alt | متوقف |
| تضبيب عند الخمول | مدة عدم الاستخدام قبل إغلاق بقعة الرؤية | 15 ثانية |
| زر الطوارئ | ضغط Esc مرتين يغطّي الشاشة | مفعّل |
| المواقع المتوقفة | قائمة المواقع والنطاقات المتوقفة، ويمكن إضافة `news.example.com` أو `*.example.com` يدوياً | فارغة |

### التثبيت

**من متجر Chrome** — [بنقرة واحدة](https://chromewebstore.google.com/detail/smart-blur/jpldganokfniaogppagfgbbelcdpkgim).

**من الكود المصدري** (للتطوير):

1. انسخ المستودع:
   ```bash
   git clone https://github.com/Sir-Devs/Smart-Blur.git
   ```
2. افتح `chrome://extensions` وفعّل **وضع المطوّر (Developer mode)**.
3. اضغط **Load unpacked** واختر المجلد الذي يحتوي على `manifest.json`.

التبويبات المفتوحة مسبقاً تعمل فوراً دون الحاجة لإعادة تحميلها. بعد تعديل الكود اضغط زر إعادة التحميل على بطاقة Smart Blur في `chrome://extensions`.

لا تعمل الإضافة في صفحات Chrome الخاصة (`chrome://…` وصفحة التبويب الجديد) ولا في متجر Chrome، لأن Chrome يمنع كل الإضافات هناك. لاستخدامها مع الملفات المحلية فعّل خيار **Allow access to file URLs** من تفاصيل الإضافة.

### الخصوصية

الإضافة **لا تجمع أي بيانات ولا ترسل أي شيء ولا تتصل بالإنترنت إطلاقاً.** تُحفظ الإعدادات محلياً عبر `chrome.storage.local` ولا تغادر جهازك، ولا يوجد أي تتبّع أو تحليلات.

### الجديد في الإصدار 4.0

- أشكال جديدة لبقعة الرؤية: سطر لقراءة المقالات الطويلة، وفقرة، والتبديل بينها بـ Alt+Shift+L
- الحقل الذي تكتب فيه يبقى واضحاً، وفي المحررات الطويلة تبقى الأسطر حول مؤشر الكتابة فقط واضحة
- بقعة الرؤية تعمل على الشاشات اللمسية ومع القلم
- إيقاف نطاق كامل بكل مواقعه الفرعية، وإضافة مواقع متوقفة يدوياً
- حلقة بقعة الرؤية لها حافة فاتحة وأخرى داكنة فتظهر على الصفحات البيضاء أيضاً
- طبقة الطوارئ معتمة بالكامل
- مشغّلات فيديو أكثر تبقى واضحة: داخل مكوّنات الويب، وLoom وWistia وFacebook وKick وStreamable وBilibili وTED
- التركيز على المقال يبدأ بعد إمساك Alt لحظة، فعاد النقر مع Alt واختصاراته يعمل في المواقع
- يظهر التضبيب قبل رسم الصفحة حتى في الصفحات المحمّلة من الذاكرة المؤقتة
- تظهر – على الشارة في صفحات Chrome التي لا تعمل فيها أي إضافة
- لا تعمل الإضافة في الخلفية داخل التبويبات التي لا تنظر إليها
- نصوص ثانوية أوضح في لوحة التحكم

### الجديد في الإصدار 3.0

- لوحة تحكم بتصميم جديد بألوان الأيقونة، بالعربية والإنجليزية
- جديد: قوة التضبيب، اختصار لوحة المفاتيح، شارة OFF، قائمة المواقع المتوقفة
- التركيز على المقال يُبقي المنطقة المثبّتة واضحة تماماً، مع أسماء مفهومة للعناصر وتلميحات على الصفحة
- زر الطوارئ أصبح Esc مرتين ويغطّي الشاشة بالكامل، فلم تعد ضغطة Esc الواحدة تتعارض مع المواقع
- التضبيب عند الخمول يحتسب لوحة المفاتيح والتمرير والنقر، حتى داخل الإطارات المضمّنة، لا حركة الماوس فقط
- تُضبَّب الصفحة قبل ظهور محتواها، والتبويبات المفتوحة عند التثبيت تعمل دون إعادة تحميل
- أصبحت النوافذ المنبثقة والعناصر المعروضة بملء الشاشة تُضبَّب أيضاً
- إصلاحات: التركيز على المقال كان يغيّر تنسيق الصفحات، والصفحات كثيرة التحديث لم تكن تكتشف الفيديو الجديد، والصفحات المستعادة بزر الرجوع كانت تفقد التتبّع، والصفحة كانت تبقى مضبّبة بعد تعطيل الإضافة، وحركة خلفية دائمة كانت تستهلك المعالج الرسومي في كل تبويب

### الترخيص

رخصة MIT — انظر ملف [LICENSE](LICENSE). يحق لأي شخص استخدام الكود وتعديله وتوزيعه وبيعه، **بشرط** الإبقاء على إشعار حقوق النشر باسم أحمد الحلبي في جميع النسخ.

</div>

---

Copyright © 2025–2026 Ahmad Alhalabi — [ahmadalhalabi.com](https://ahmadalhalabi.com/)
