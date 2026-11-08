// ==UserScript==
// @name         LiquidCloud
// @namespace    http://tampermonkey.net/
// @version      7.7
// @homepageURL  https://github.com/Cagiest/LiquidCloud
// @supportURL   https://github.com/Cagiest/LiquidCloud/issues
// @updateURL    https://raw.githubusercontent.com/Cagiest/LiquidCloud/main/liquidcloud.user.js
// @downloadURL  https://raw.githubusercontent.com/Cagiest/LiquidCloud/main/liquidcloud.user.js
// @description  LiquidCloud: a new look for SoundCloud. Floating player bar with the progress under the controls, SF Pro font, a background coloured by the cover, and synced lyrics
// @match        https://soundcloud.com/*
// @grant        GM_addStyle
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM.addStyle
// @grant        GM.xmlHttpRequest
// @connect      genius.com
// @connect      127.0.0.1
// @noframes
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // Settings saved under the script's old name (before 7.3) move to the LiquidCloud names once
    try {
        [['sc-spotify-lyrics-keys', 'sc-lc-lyrics-keys'], ['sc-spotify-track-ids', 'sc-lc-track-ids'],
         ['sc-spotify-lyrics-full', 'sc-lc-settings'], ['sc-spotify-lyrics-timing', 'sc-lc-lyrics-timing']].forEach(([from, to]) => {
            const old = localStorage.getItem(from);
            if (old !== null && localStorage.getItem(to) === null) localStorage.setItem(to, old);
            localStorage.removeItem(from);
        });
    } catch (e) {}

    /* The script starts before the page is read (document-start) for one thing only: Safari's "Open in the
       SoundCloud app" banner on iPhone comes from <meta name="apple-itunes-app">, and removing it only works
       before Safari reaches it. Everything else waits for the page (main, below). */
    const stripAppBanner = () => document.querySelectorAll('meta[name="apple-itunes-app"]').forEach(m => m.remove());
    stripAppBanner();
    const bannerWatch = new MutationObserver(stripAppBanner);
    bannerWatch.observe(document.documentElement || document, { childList: true, subtree: true });
    const start = () => { stripAppBanner(); bannerWatch.disconnect(); main(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();

    function main() {

    // Page-context window (needed to read SoundCloud's __sc_hydration from the sandbox)
    const W = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

    /* ---------- Tampermonkey or the Userscripts app (Safari) ----------
       Tampermonkey has GM_addStyle, GM_xmlhttpRequest and unsafeWindow. The Userscripts app for Safari has the
       newer GM.addStyle / GM.xmlHttpRequest and no unsafeWindow, so the script uses these stand-ins. */
    const addStyle = (css) => {
        if (typeof GM_addStyle === 'function') return GM_addStyle(css);
        const style = document.createElement('style');
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
        return style;
    };
    // GM_xmlhttpRequest's way: { method, url, headers, data, timeout, onload, onerror, ontimeout }, onload gets
    // { status, responseText }. Without either, a plain fetch (enough for sites that allow it, like LRCLIB).
    const gmRequest = (details) => {
        if (typeof GM_xmlhttpRequest === 'function') { GM_xmlhttpRequest(details); return; }
        let done = false;
        const once = (fn) => (value) => { if (done) return; done = true; if (fn) fn(value); };
        const onload = once(details.onload), onerror = once(details.onerror), ontimeout = once(details.ontimeout || details.onerror);
        if (typeof GM !== 'undefined' && GM && typeof GM.xmlHttpRequest === 'function') {
            const result = GM.xmlHttpRequest({ ...details, onload, onerror, ontimeout });
            if (result && typeof result.then === 'function') result.then((r) => { if (r && 'status' in r) onload(r); }, onerror);
            return;
        }
        const ctrl = new AbortController();
        const timer = details.timeout ? setTimeout(() => { ctrl.abort(); ontimeout(new Error('timeout')); }, details.timeout) : null;
        fetch(details.url, { method: details.method || 'GET', headers: details.headers, body: details.data, signal: ctrl.signal })
            .then(async (res) => { clearTimeout(timer); onload({ status: res.status, responseText: await res.text(), finalUrl: res.url }); })
            .catch((e) => { clearTimeout(timer); onerror(e); });
    };
    // SoundCloud's page data (who is signed in, the API client id). Without unsafeWindow it is read from the
    // page's own <script> that sets it, once it is there.
    let hydrationCopy = null;
    const pageHydration = () => {
        if (Array.isArray(W.__sc_hydration)) return W.__sc_hydration;
        if (hydrationCopy) return hydrationCopy;
        for (const script of document.querySelectorAll('script:not([src])')) {
            const text = script.textContent;
            const at = text.indexOf('__sc_hydration');
            if (at < 0) continue;
            const start = text.indexOf('[', at);
            const end = text.lastIndexOf(']');
            try { hydrationCopy = JSON.parse(text.slice(start, end + 1)); } catch (e) {}
            break;
        }
        return hydrationCopy;
    };

    /* ---------- Phone layout ----------
       On a phone (Safari's "Request Desktop Website" with the Userscripts app) the desktop layout's three panels
       do not fit, so the page is laid out like Spotify's app instead: full-width pages, a mini player above a
       Home / Search / Your Library / Lyrics tab bar, the library as its own screen, and the fullscreen lyrics as
       Now Playing (see setupPhone). localStorage 'sc-phone' = '1' / '0' forces it on / off. */
    const PHONE = (() => {
        let force = null;
        try { force = localStorage.getItem('sc-phone'); } catch (e) {}
        if (force === '1') return true;
        if (force === '0') return false;
        return navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 600;
    })();
    if (PHONE) {
        document.documentElement.classList.add('sc-phone');
        // the desktop site would otherwise be drawn at desktop width and shrunk
        let meta = document.querySelector('meta[name="viewport"]');
        if (!meta) { meta = document.createElement('meta'); meta.name = 'viewport'; (document.head || document.documentElement).appendChild(meta); }
        meta.content = 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover';
        // Safari tints its own bars with this colour, so they blend into the page
        let tint = document.querySelector('meta[name="theme-color"]');
        if (!tint) { tint = document.createElement('meta'); tint.name = 'theme-color'; (document.head || document.documentElement).appendChild(tint); }
        tint.content = '#121212';
    }

    addStyle(`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800&display=swap');`);

    addStyle(`
        :root {
            --sc-accent: #e8344e; /* fallback; replaced by the playing song's colour (updateAccent) */
        }

        /* registering the variable as a colour lets it fade instead of snapping when the song changes */
        @property --sc-accent {
            syntax: '<color>';
            inherits: true;
            initial-value: #e8344e;
        }

        html {
            transition: --sc-accent 1.4s ease;
        }

        /* Global SF Pro Normal Override */
        *, body, button, input, textarea, a, span, div {
            font-family: "SF Pro Display", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
            font-weight: 400 !important;
        }

        /* 1. Nuke clutter and glitchy tooltips */
        header[role="banner"].header,
        .banner.m-promotion,
        .l-product-banners,
        .announcements,
        .profileHeaderWrapper__stickyHeader,
        .dropbar,
        .l-sidebar-right,
        .userMain__header,
        .profileHeaderWrapper,
        .profileHeaderBackground,
        .backgroundGradient,
        .profileHeader__chooserWrapper,
        .headerImageEditChooser,
        .bannerLinksButton,
        .l-about-left,
        .listen__sidebar,
        .sidebarHeader,
        .heroPlayContext,
        .visualMain__wrapper,
        .playControls__bg,
        .playControls_bg,
        .playControls__bgWrapper,
        .playControls__panel,
        .playControlsPanel,
        .playControls__castControl,
        .sc-visuallyhidden {
            display: none !important;
            height: 0 !important;
            width: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            background: transparent !important;
            border: none !important;
            opacity: 0 !important;
            visibility: hidden !important;
        }

        /* Artist Pro upsells / insights (class names are best guesses, delete if something legit disappears) */
        [class*="artistPro" i],
        [class*="upsell" i],
        [class*="insights" i] {
            display: none !important;
        }

        /* 2. Transparent roots */
        html {
            background: #0b0b0b !important;
        }

        body, #app, .l-fluid-fixed, .l-content {
            background: transparent !important;
            color: #f1f1f1 !important;
        }

        /* Play / pause glyphs: SoundCloud leaves the svg in the top-left of its wrappers */
        .sc-button-play > div,
        .sc-button-play > div > div {
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            width: 100% !important;
            height: 100% !important;
        }

        /* Page offset lives on #app (ONE place) so nested containers never stack margins */
        /* Three floating panels, like Spotify: library (left), main (#app), lyrics (right).
           #app is the scroll area for the page; see setupScrollArea() for why scroll events are forwarded. */
        body {
            --sc-left: 96px;
            --sc-right: 440px;
        }

        /* the top bar's height; the panels start 16px below it. The LiquidCloud app makes it slimmer (see 41) */
        html {
            --sc-bar-h: 64px;
        }

        body.sc-sidebar-is-expanded {
            --sc-left: 324px;
        }

        html, body {
            overflow: hidden !important;
            height: 100% !important;
        }

        #app {
            position: fixed !important;
            top: calc(var(--sc-bar-h) + 16px) !important;
            left: var(--sc-left) !important;
            right: var(--sc-right) !important;
            bottom: 12px !important;
            box-sizing: border-box !important;
            padding: 0 !important;
            overflow-x: hidden !important;
            overflow-y: auto !important;
            border-radius: 16px !important;
            scrollbar-width: thin;
            scrollbar-color: rgba(255, 255, 255, 0.25) transparent;
            transition: left 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
            /* a fixed box is its own layer, so the player bar inside it can only be as high as #app itself:
               keep #app above the library (999) and lyrics (998) panels, below the top bar (9999) */
            z-index: 1000 !important;
        }

        /* SoundCloud's own menus and popovers are added to <body> on its overlay layer (900): keep them over #app */
        .g-z-index-overlay {
            z-index: 1002 !important;
        }

        /* 3. Sticky Edge-to-Edge Top Nav Bar */
        #lc-top-bar {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100vw !important;
            height: var(--sc-bar-h) !important;
            background: rgba(12, 12, 12, 0.85) !important;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
            backdrop-filter: blur(30px) !important;
            -webkit-backdrop-filter: blur(30px) !important;
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            padding: 0 24px !important;
            z-index: 9999 !important;
            box-sizing: border-box !important;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5) !important;
        }

        .sc-top-profile-btn, .sc-top-profile-btn:visited, .sc-top-profile-btn:active, .sc-top-profile-btn:hover {
            display: flex !important;
            align-items: center !important;
            gap: 8px !important;
            text-decoration: none !important;
            color: #ffffff !important;
            padding: 4px 8px !important;
            border-radius: 20px !important;
            transition: background 0.2s ease !important;
            border: none !important;
            outline: none !important;
        }

        .sc-top-profile-btn:hover {
            background: rgba(255, 255, 255, 0.1) !important;
        }

        .sc-top-profile-btn img {
            width: 28px !important;
            height: 28px !important;
            border-radius: 50% !important;
            object-fit: cover !important;
            background: rgba(255, 255, 255, 0.1) !important;
            border: none !important;
        }

        .sc-top-profile-name {
            font-size: 13px !important;
            font-weight: 500 !important;
            color: #ffffff !important;
            text-decoration: none !important;
            background: transparent !important;
        }

        .sc-top-search-wrap {
            display: flex;
            align-items: center;
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 50px;
            padding: 6px 14px;
            width: 360px;
            transition: background 0.2s ease, border-color 0.2s ease;
        }

        .sc-top-search-wrap:focus-within {
            background: rgba(255, 255, 255, 0.14);
            border-color: rgba(255, 255, 255, 0.3);
        }

        .sc-top-search-wrap input {
            background: transparent;
            border: none;
            outline: none;
            color: #fff;
            font-size: 13px;
            margin-left: 8px;
            width: 100%;
        }

        .sc-top-nav-right {
            display: flex;
            align-items: center;
            gap: 16px;
            margin-right: 8px;
        }

        .sc-top-nav-right a {
            color: #b3b3b3;
            text-decoration: none;
            font-size: 13px;
            transition: color 0.2s ease;
        }

        .sc-top-nav-right a:hover {
            color: #fff;
        }

        /* 4. Left Sidebar with Dynamic Expansion */
        #lc-left-bar {
            position: fixed !important;
            top: calc(var(--sc-bar-h) + 16px) !important;
            left: 12px !important;
            width: 72px;
            bottom: 12px !important;
            height: auto !important;
            background: rgba(18, 18, 18, 0.85);
            border: 1px solid rgba(255, 255, 255, 0.08);
            backdrop-filter: blur(30px);
            border-radius: 16px;
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            padding: 8px 0;
            gap: 4px;
            z-index: 999;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            overflow-y: auto;
            overflow-x: hidden;
            scrollbar-width: none;
            transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        #lc-left-bar::-webkit-scrollbar {
            display: none;
        }

        #lc-left-bar.expanded {
            width: 300px;
        }

        .sc-sidebar-row {
            display: flex;
            align-items: center;
            width: calc(100% - 16px); /* 56px when collapsed; grows with the panel, no margin change to animate */
            height: 56px;
            margin: 0 8px;
            border-radius: 12px;
            cursor: pointer;
            transition: background 0.2s ease;
            text-decoration: none;
            color: #b3b3b3;
            flex-shrink: 0;
            box-sizing: border-box;
            overflow: hidden;
        }

        #lc-left-bar.expanded .sc-sidebar-row {
            width: calc(100% - 16px);
            margin: 0 8px;
        }

        .sc-sidebar-row:hover {
            background: rgba(255, 255, 255, 0.08);
            color: #ffffff;
        }

        .sc-sidebar-icon-box {
            width: 56px;
            height: 56px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
        }

        .sc-sidebar-text-wrap {
            display: flex;
            flex-direction: column;
            overflow: hidden;
            opacity: 0;
            transition: opacity 0.2s ease;
            white-space: nowrap;
            pointer-events: none;
            padding-right: 8px;
        }

        #lc-left-bar.expanded .sc-sidebar-text-wrap {
            opacity: 1;
            pointer-events: auto;
        }

        .sc-sidebar-title {
            font-size: 13px;
            color: #ffffff;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .sc-sidebar-item-sub {
            font-size: 11px;
            color: #888;
        }

        .sc-sidebar-divider {
            width: 48px;
            height: 1px;
            background: rgba(255, 255, 255, 0.08);
            margin: 4px auto;
            flex-shrink: 0;
            transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        #lc-left-bar.expanded .sc-sidebar-divider {
            width: calc(100% - 32px);
            margin: 4px 16px;
        }

        .sc-sidebar-liked-box {
            width: 44px;
            height: 44px;
            border-radius: 10px;
            background: linear-gradient(135deg, #450af5, #c4efd9);
            display: flex;
            align-items: center;
            justify-content: center;
            color: #ffffff;
            flex-shrink: 0;
        }

        .sc-sidebar-thumb {
            width: 44px;
            height: 44px;
            border-radius: 10px;
            object-fit: cover;
            flex-shrink: 0;
            background: rgba(255, 255, 255, 0.05);
        }

        .sc-sidebar-thumb.circle {
            border-radius: 50%;
        }

        #sc-sidebar-dynamic-container {
            display: flex;
            flex-direction: column;
            width: 100%;
        }

        /* 5. Main Glass Panel Container
           (The playbar wrapper also carries .l-container, so it is excluded.) */
        .l-container:not(.playControls__wrapper) {
            width: 100% !important;
            max-width: none !important;
            margin: 0 !important;
            padding: 24px 24px 130px 24px !important; /* bottom room so the floating player never covers content */
            min-height: 100% !important;
            box-sizing: border-box !important;
            float: none !important;
            display: block !important;
            background: rgba(18, 18, 18, 0.75) !important;
            border-radius: 16px !important;
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            backdrop-filter: blur(30px);
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        }

        /* Inner wrappers: no extra margins / boxes, so nothing stacks or squeezes */
        .l-fluid-fixed .l-main, .l-main-column, .g-box-full, .listen__content, .l-about-row, .l-about-main,
        .l-container:not(.playControls__wrapper) .l-container:not(.playControls__wrapper) {
            width: 100% !important;
            max-width: none !important;
            margin: 0 !important;
            padding-left: 0 !important;
            padding-right: 0 !important;
            box-sizing: border-box !important;
            float: none !important;
        }

        .l-container:not(.playControls__wrapper) .l-container:not(.playControls__wrapper) {
            background: transparent !important;
            border: none !important;
            box-shadow: none !important;
            backdrop-filter: none !important;
            padding-top: 0 !important;
            padding-bottom: 0 !important;
        }

        /* Profile header: no banner, no label boxes behind the name (class names are best guesses) */
        .profileHeader,
        .profileHeaderInfo,
        .profileHeaderInfo__userName,
        .profileHeaderInfo__userName *,
        .profileHeaderInfo__additional {
            background: transparent !important;
            background-color: transparent !important;
            box-shadow: none !important;
        }

        .profileHeader {
            height: auto !important;
            min-height: 0 !important;
        }

        /* 6. Spotify-style hero on playlist / track pages
              Real structure: .l-listen-hero > .fullHero > .fullHero__foreground
                .fullHero__foreground = [ __artwork , __title (.soundTitle) , __info , __tracksSummary , __playerArea ]
              SoundCloud positions all of those absolutely, so the hero collapsed to 0x0 once the banner was hidden.
              .fullHero__foreground becomes the grid; the title wrappers are flattened with display:contents.
              Grid: [art] | label / TITLE / artist . tracks . date     then a row with the play button      */
        .l-listen-hero {
            display: block !important;
            width: 100% !important;
            height: auto !important;
            min-height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            background: transparent !important;
        }

        .fullHero {
            --sc-hero-art: 232px;
            display: block !important;
            position: relative !important;
            width: 100% !important;
            height: auto !important;
            min-height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
            background: transparent !important;
            border: none !important;
            box-shadow: none !important;
        }

        .fullHero__foreground {
            position: static !important;
            display: grid !important;
            grid-template-columns: var(--sc-hero-art) 24px auto auto auto 1fr !important;
            grid-template-rows: 1fr auto auto 80px !important;
            align-items: center !important;
            width: 100% !important;
            height: auto !important;
            margin: 0 !important;
            padding: 8px 0 0 0 !important;
            box-sizing: border-box !important;
            background: transparent !important;
        }

        .fullHero__title,
        .fullHero .soundTitle,
        .fullHero .soundTitle__titleContainer,
        .fullHero .soundTitle__usernameTitleContainer,
        .fullHero .soundTitle__titleHeroContainer,
        .fullHero .soundTitle__usernameHeroContainer,
        .fullHero .soundTitle__additionalContainer {
            display: contents !important;
        }

        .fullHero__foreground::before {
            content: 'Track';
            grid-column: 3 / -1;
            grid-row: 1;
            align-self: end;
            font-size: 13px;
            font-weight: 600 !important;
            color: #ffffff;
        }

        .fullHero__foreground:has(.playlistTrackCount)::before {
            content: 'Playlist';
        }

        .fullHero__artwork {
            grid-column: 1;
            grid-row: 1 / 4;
            position: static !important;
            width: var(--sc-hero-art) !important;
            height: var(--sc-hero-art) !important;
            margin: 0 !important;
            border-radius: 8px !important;
            overflow: hidden !important;
            box-shadow: 0 8px 24px rgba(0,0,0,0.5) !important;
        }

        .fullHero__artwork .listenArtworkWrapper,
        .fullHero__artwork .listenArtworkWrapper__artwork,
        .fullHero__artwork .image,
        .fullHero__artwork span.sc-artwork {
            display: block !important;
            width: 100% !important;
            height: 100% !important;
            border-radius: 8px !important;
        }

        .fullHero .soundTitle__title {
            grid-column: 3 / -1;
            grid-row: 2;
            display: block !important;
            margin: 4px 0 10px 0 !important;
            padding: 0 !important;
            background: transparent !important;
            min-width: 0 !important;
        }

        .fullHero .soundTitle__title,
        .fullHero .soundTitle__title span {
            font-size: clamp(40px, 4.6vw, 72px) !important;
            font-weight: 800 !important;
            line-height: 1.05 !important;
            letter-spacing: -0.04em !important;
            color: #ffffff !important;
            background: transparent !important;
            overflow-wrap: anywhere !important;
        }

        /* SoundCloud paints a solid "label" bar behind hero text with pseudo-elements */
        .fullHero .soundTitle__title::before,
        .fullHero .soundTitle__title::after,
        .fullHero .soundTitle__username::before,
        .fullHero .soundTitle__username::after {
            display: none !important;
        }

        .fullHero .soundTitle__username {
            grid-column: 3;
            grid-row: 3;
            margin: 0 !important;
            padding: 0 !important;
            white-space: nowrap !important;
            background: transparent !important;
        }

        .fullHero .soundTitle__username,
        .fullHero .soundTitle__username * {
            font-size: 13px !important;
            font-weight: 600 !important;
            line-height: 1.4 !important;
            color: var(--sc-accent) !important;
            text-decoration: none !important;
            background: transparent !important;
        }

        .fullHero .soundTitle__username a:hover * {
            text-decoration: underline !important;
        }

        .fullHero__tracksSummary {
            grid-column: 4;
            grid-row: 3;
            position: static !important;
            display: block !important;
            width: auto !important;
            height: auto !important;
            margin: 0 !important;
            padding: 0 !important;
            background: transparent !important;
        }

        .fullHero__tracksSummary .genericTrackCount {
            display: flex !important;
            align-items: baseline !important;
            gap: 4px !important;
            position: static !important;
            width: auto !important;
            height: auto !important;
            margin: 0 !important;
            padding: 0 !important;
            background: transparent !important;
            border: none !important;
            border-radius: 0 !important;
        }

        .fullHero__tracksSummary .genericTrackCount::before {
            content: '\\2022';
            margin: 0 4px 0 8px;
            color: #b3b3b3;
        }

        .fullHero__tracksSummary .genericTrackCount > div {
            font-size: 13px !important;
            line-height: 1.4 !important;
            color: #b3b3b3 !important;
            margin: 0 !important;
            padding: 0 !important;
            text-transform: lowercase !important;
        }

        .fullHero__tracksSummary .genericTrackCount > div:empty {
            display: none !important;
        }

        .fullHero__tracksSummary .genericTrackCount__duration::before {
            content: '\\2022';
            margin: 0 6px 0 4px;
        }

        .fullHero__info {
            grid-column: 5;
            grid-row: 3;
            position: static !important;
            display: block !important;
            width: auto !important;
            height: auto !important;
            margin: 0 !important;
            padding: 0 !important;
            background: transparent !important;
            white-space: nowrap !important;
        }

        .fullHero__info > * {
            display: inline !important;
            margin: 0 !important;
            padding: 0 !important;
            background: transparent !important;
        }

        .fullHero__info,
        .fullHero__info time,
        .fullHero__info span,
        .fullHero__info a {
            font-size: 13px !important;
            line-height: 1.4 !important;
            color: #b3b3b3 !important;
        }

        .fullHero__info .sc-tag {
            vertical-align: baseline !important;
            border: none !important;
            border-radius: 0 !important;
        }

        .fullHero__info .sc-tag span {
            display: inline !important;
            overflow: visible !important;
        }

        .fullHero__info .sc-tag::before {
            content: '\\2022' !important;
            display: inline !important;
            position: static !important;
            width: auto !important;
            height: auto !important;
            margin: 0 8px !important;
            background: none !important;
            color: #b3b3b3 !important;
        }

        .fullHero__info::before {
            content: '\\2022';
            margin: 0 8px;
            color: #b3b3b3;
        }

        .fullHero__playerArea {
            display: none !important;
        }

        /* round accent play button, on its own row under the artwork */
        .fullHero .soundTitle__playButton {
            grid-column: 1;
            grid-row: 4;
            align-self: end;
            justify-self: start;
            position: static !important;
            float: none !important;
            width: 56px !important;
            height: 56px !important;
            margin: 0 !important;
            padding: 0 !important;
        }

        .fullHero .soundTitle__playButton .sc-button-play {
            width: 56px !important;
            height: 56px !important;
            min-width: 56px !important;
            padding: 0 !important;
            margin: 0 !important;
            border: none !important;
            border-radius: 50% !important;
            background: var(--sc-accent) !important;
            color: #ffffff !important;
            display: block !important;
            transition: transform 0.1s ease !important;
        }

        .fullHero .soundTitle__playButton .sc-button-play:hover {
            transform: scale(1.06);
        }

        .fullHero .soundTitle__playButton svg {
            width: 26px !important;
            height: 26px !important;
        }

        /* like / repost / share ... sit on the same line as the hero play button */
        .l-listen-wrapper,
        .l-about-top,
        .listenEngagement {
            margin-top: 0 !important;
            padding-top: 0 !important;
            border: none !important;
            background: transparent !important;
        }

        /* track pages put the comment box first; the action row has to stay directly under the hero */
        .listenEngagement {
            display: flex !important;
            flex-direction: column !important;
        }

        .listenEngagement::before,
        .listenEngagement::after {
            display: none !important;
        }

        .listenEngagement__footer {
            order: -1 !important;
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            height: 56px !important;
            margin: -56px 0 24px 72px !important;
            padding: 0 !important;
            border: none !important;
            position: relative !important;
        }

        .listenEngagement__footer .soundStats {
            display: flex !important;
            align-items: center !important;
            gap: 14px !important;
            margin: 0 !important;
            padding: 0 !important;
            float: none !important;
        }

        .listenEngagement__footer .soundActions .sc-button-group {
            display: flex !important;
            align-items: center !important;
            gap: 4px !important;
        }

        .listenEngagement__footer .soundActions .sc-button {
            width: 40px !important;
            height: 40px !important;
            min-width: 40px !important;
            padding: 0 !important;
            margin: 0 !important;
            border-radius: 50% !important;
            background: transparent !important;
            border: none !important;
            box-shadow: none !important;
            color: #b3b3b3 !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            transition: color 0.2s ease, background 0.2s ease !important;
        }

        .listenEngagement__footer .soundActions .sc-button:hover {
            color: #ffffff !important;
            background: rgba(255, 255, 255, 0.08) !important;
        }

        .listenEngagement__footer .soundActions .sc-button.sc-button-selected {
            color: var(--sc-accent) !important;
        }

        .listenEngagement__footer .soundActions .sc-button svg {
            width: 20px !important;
            height: 20px !important;
        }

        .listenEngagement__footer .soundActions .sc-button-label,
        body:not(.sc-tiles) .soundList__item .soundActions .sc-button-label {
            display: none !important;
        }

        .listenEngagement__footer .soundStats * {
            font-size: 12px !important;
            color: #b3b3b3 !important;
        }

        .trackList, .systemPlaylistTrackList, .soundList {
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
        }

        /* 7. Spotify-Style Floating Pill Player
              Row 1: shuffle | prev | play | next | repeat | [art + title/artist] | volume
              Row 2: 0:00 ========o======== 2:57                                           */
        div.playControls,
        div.playControls.g-z-index-control-bar {
            background: transparent !important;
            background-color: transparent !important;
            border: none !important;
            box-shadow: none !important;
            position: fixed !important;
            bottom: 20px !important;
            left: 0 !important;
            width: 100vw !important;
            height: 84px !important;
            z-index: 999999 !important;
            pointer-events: none !important;
        }

        section.playControls__inner {
            pointer-events: auto !important;
            position: absolute !important;
            top: 0 !important;
            left: 50% !important;
            transform: translateX(-50%) !important;
            width: 92% !important;
            max-width: 820px !important;
            height: 84px !important;
            background: rgba(18, 18, 18, 0.92) !important;
            backdrop-filter: blur(30px) !important;
            -webkit-backdrop-filter: blur(30px) !important;
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            border-radius: 42px !important;
            box-shadow: 0 16px 40px rgba(0,0,0,0.7) !important;
            padding: 0 32px !important;
            box-sizing: border-box !important;
            margin: 0 !important;
            display: flex !important;
            align-items: center !important;
        }

        /* This element is ALSO .l-container, so neutralise every inherited box style */
        .playControls__wrapper {
            background: transparent !important;
            border: none !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            backdrop-filter: none !important;
            max-width: none !important;
            width: 100% !important;
            height: 100% !important;
            padding: 0 !important;
            margin: 0 !important;
            display: flex !important;
            align-items: center !important;
        }

        .playControls__elements {
            display: grid !important;
            grid-template-columns: auto auto auto auto auto auto minmax(0, 1fr) auto auto auto !important;
            grid-template-rows: 48px 16px !important;
            align-content: center !important;
            align-items: center !important;
            column-gap: 8px !important;
            row-gap: 2px !important;
            position: relative !important;
            width: 100% !important;
            height: auto !important;
            margin: 0 !important;
            padding: 0 !important;
            background: transparent !important;
        }

        /* SoundCloud's spacing utility classes (sc-mr-2x, sc-ml-3x...) must not push the grid around */
        .playControls__elements > * {
            margin: 0 !important;
            min-width: 0;
        }

        /* The badge wrappers are flattened so artwork / title / like / queue are grid items themselves */
        .playControls__soundBadge,
        .playbackSoundBadge,
        .playbackSoundBadge__actions {
            display: contents !important;
        }

        .playControls__shuffle { grid-column: 1; grid-row: 1; }
        .playControls__prev    { grid-column: 2; grid-row: 1; }
        .playControls__play    { grid-column: 3; grid-row: 1; }
        .playControls__next    { grid-column: 4; grid-row: 1; }
        .playControls__repeat  { grid-column: 5; grid-row: 1; margin-right: 6px !important; }
        .playbackSoundBadge__avatar                { grid-column: 6; grid-row: 1; }
        .playbackSoundBadge__titleContextContainer { grid-column: 7; grid-row: 1; }
        .playbackSoundBadge__like                  { grid-column: 8; grid-row: 1; }
        .playbackSoundBadge__showQueue             { grid-column: 9; grid-row: 1; }
        .playControls__volume  { grid-column: 10; grid-row: 1; display: flex !important; align-items: center !important; position: relative !important; }
        .playControls__timeline { grid-column: 1 / -1; grid-row: 2; }

        /* Rounded box behind artwork + title + like (Spotify's now-playing chip) */
        .playControls__elements::before {
            content: '';
            grid-column: 6 / 9;
            grid-row: 1;
            align-self: stretch;
            background: rgba(255, 255, 255, 0.06);
            border-radius: 10px;
            pointer-events: none;
        }

        .playControls__elements:not(:has(.playbackSoundBadge__avatar))::before {
            display: none;
        }

        /* Icon buttons */
        .playControls .sc-button-icon {
            width: 32px !important;
            height: 32px !important;
            min-width: 32px !important;
            padding: 0 !important;
            margin: 0 !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
        }

        .playControls .sc-button-icon svg {
            width: 16px !important;
            height: 16px !important;
        }

        .playControls button, .playControls a[role="button"], .playControls .sc-button {
            background: transparent !important;
            border: none !important;
            box-shadow: none !important;
            color: #b3b3b3 !important;
            cursor: pointer !important;
            transition: color 0.2s ease, transform 0.1s ease !important;
        }

        .playControls button:hover, .playControls a[role="button"]:hover, .playControls .sc-button:hover {
            color: #ffffff !important;
        }

        /* Play button: needs higher specificity than ".playControls button" or it goes transparent */
        .playControls .playControls__play.playControl {
            background: #ffffff !important;
            color: #000000 !important;
            border-radius: 50% !important;
            width: 36px !important;
            height: 36px !important;
            min-width: 36px !important;
            padding: 0 !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
        }

        .playControls .playControls__play.playControl:hover {
            background: #ffffff !important;
            color: #000000 !important;
            transform: scale(1.06);
        }

        .playControls .playControls__play.playControl svg {
            width: 20px !important;
            height: 20px !important;
        }

        .playControls .playControls__play .sc-button-label {
            display: none !important;
        }

        /* Active shuffle / repeat in accent colour (class names are best guesses) */
        .playControls__shuffle .sc-button-selected,
        .playControls__shuffle .m-shuffling,
        .playControls__repeat .sc-button-selected,
        .playControls__repeat .m-one,
        .playControls__repeat .m-all {
            color: var(--sc-accent) !important;
        }

        /* Now playing chip */
        .playbackSoundBadge__avatar {
            position: relative !important;
            width: 40px !important;
            height: 40px !important;
            border-radius: 6px !important;
            overflow: hidden !important;
            margin: 0 0 0 4px !important;
        }

        .playbackSoundBadge__avatar .image,
        .playbackSoundBadge__avatar span.sc-artwork {
            width: 40px !important;
            height: 40px !important;
            border-radius: 6px !important;
        }

        /* Title on top, artist below (SoundCloud's DOM has artist first, so reverse).
           SoundCloud gives this container width:0, which is why the text used to vanish. */
        .playbackSoundBadge__titleContextContainer {
            position: relative !important;
            display: flex !important;
            flex-direction: column-reverse !important;
            justify-content: center !important;
            align-items: center !important;
            width: auto !important;
            min-width: 0 !important;
            max-width: none !important;
            margin: 0 !important;
            padding: 0 4px !important;
            text-align: center !important;
            overflow: hidden !important;
        }

        .playbackSoundBadge__title {
            display: block !important;
            width: 100% !important;
            max-width: 100% !important;
            min-width: 0 !important;
        }

        .playbackSoundBadge__titleLink {
            display: block !important;
            width: 100% !important;
            font-size: 13px !important;
            line-height: 1.3 !important;
            color: #ffffff !important;
            font-weight: 500 !important;
            text-decoration: none !important;
            white-space: nowrap !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
        }

        .playbackSoundBadge__titleLink span {
            font-weight: 500 !important;
        }

        .playbackSoundBadge__lightLink {
            display: block !important;
            width: 100% !important;
            max-width: 100% !important;
            font-size: 11px !important;
            line-height: 1.3 !important;
            color: #b3b3b3 !important;
            text-decoration: none !important;
            white-space: nowrap !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
        }

        .playbackSoundBadge__titleLink:hover,
        .playbackSoundBadge__lightLink:hover {
            text-decoration: underline !important;
        }

        /* Follow is dropped. Needs .playControls in front to beat ".playControls .sc-button-icon",
           which is why this button used to stay visible. */
        .playControls .playbackSoundBadge__follow,
        .playControls .playbackSoundBadge__queueCircle {
            display: none !important;
        }

        .playControls .playbackSoundBadge__like {
            position: relative !important;
            margin: 0 4px 0 0 !important;
        }

        .playControls .playbackSoundBadge__like.sc-button-selected,
        .playControls .playbackSoundBadge__showQueue.m-active {
            color: var(--sc-accent) !important;
        }

        /* Timeline (row 2, full width of the pill) */
        .playbackTimeline {
            width: 100% !important;
            height: 16px !important;
            display: flex !important;
            align-items: center !important;
            gap: 10px !important;
            font-size: 11px !important;
            color: #b3b3b3 !important;
        }

        .playbackTimeline__timePassed,
        .playbackTimeline__duration {
            flex: 0 0 auto !important;
            width: auto !important;
            min-width: 32px !important;
            height: 16px !important;
            margin: 0 !important;
            padding: 0 !important;
            text-align: center !important;
        }

        .playbackTimeline__timePassed,
        .playbackTimeline__timePassed span,
        .playbackTimeline__duration,
        .playbackTimeline__duration span {
            font-size: 11px !important;
            line-height: 16px !important;
            color: #b3b3b3 !important;
        }

        /* SoundCloud pads this wrapper to 28px tall, which turned the fill into a thick block */
        .playbackTimeline__progressWrapper {
            flex: 1 1 auto !important;
            width: auto !important;
            min-width: 60px !important;
            height: 4px !important;
            margin: 0 !important;
            padding: 0 !important;
            box-sizing: border-box !important;
            border-radius: 2px !important;
            position: relative !important;
            cursor: pointer !important;
            background: transparent !important;
        }

        /* Bigger invisible hit area so the 4px bar is easy to grab */
        .playbackTimeline__progressWrapper::before {
            content: '';
            position: absolute;
            left: 0;
            right: 0;
            top: -8px;
            bottom: -8px;
        }

        .playbackTimeline__progressBackground {
            display: block !important;
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            height: 4px !important;
            margin: 0 !important;
            background: rgba(255, 255, 255, 0.15) !important;
            border-radius: 2px !important;
        }

        .playbackTimeline__progressBar {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            height: 4px !important;
            margin: 0 !important;
            background: var(--sc-accent) !important;
            border-radius: 2px !important;
        }

        .playbackTimeline__progressHandle {
            width: 12px !important;
            height: 12px !important;
            margin: 0 !important;
            border: none !important;
            background: #ffffff !important;
            background-image: none !important;
            border-radius: 50% !important;
            position: absolute !important;
            top: 50% !important;
            transform: translate(-50%, -50%) !important;
            box-shadow: 0 2px 6px rgba(0,0,0,0.5) !important;
            opacity: 0 !important;
            transition: opacity 0.15s ease;
        }

        .playbackTimeline__progressWrapper:hover .playbackTimeline__progressHandle,
        .playbackTimeline.is-dragging .playbackTimeline__progressHandle {
            opacity: 1 !important;
        }

        /* Queue ("Next up"): floating glass panel above the pill, toggled by the queue button */
        .playControls .playControls__queue {
            position: absolute !important;
            left: 50% !important;
            right: auto !important;
            bottom: 96px !important;
            width: min(420px, 92vw) !important;
            height: min(520px, calc(100vh - 220px)) !important;
            margin: 0 0 0 calc(min(410px, 46vw) - min(420px, 92vw)) !important;
            padding: 0 !important;
            opacity: 0 !important;
            visibility: hidden !important;
            pointer-events: none !important;
            transform: translateY(8px) !important;
            transition: opacity 0.2s ease, transform 0.2s ease, visibility 0.2s !important;
        }

        .playControls.m-queueVisible .playControls__queue {
            opacity: 1 !important;
            visibility: visible !important;
            pointer-events: auto !important;
            transform: none !important;
        }

        .playControls .queue {
            width: 100% !important;
            height: 100% !important;
            margin: 0 !important;
            background: rgba(18, 18, 18, 0.96) !important;
            backdrop-filter: blur(30px) !important;
            -webkit-backdrop-filter: blur(30px) !important;
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            border-radius: 16px !important;
            box-shadow: 0 16px 40px rgba(0,0,0,0.7) !important;
            overflow: hidden !important;
            transform: none !important;
            opacity: 1 !important;
        }

        .playControls .queue__panel {
            background: transparent !important;
            border: none !important;
        }

        .playControls .queue__title {
            font-size: 16px !important;
            font-weight: 700 !important;
            color: #ffffff !important;
        }

        .playControls .queueItemView {
            background: transparent !important;
            border: none !important;
        }

        .playControls .queueItemView:hover {
            background: rgba(255, 255, 255, 0.06) !important;
        }

        .playControls.m-queueVisible .playbackSoundBadge__showQueue {
            color: var(--sc-accent) !important;
        }

        /* SoundCloud's own dialogs (Add to playlist, Share...) */
        .modal__modal {
            border-radius: 16px !important;
            overflow: hidden !important;
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            box-shadow: 0 16px 40px rgba(0,0,0,0.7) !important;
        }

        /* Volume popup */
        .volume__sliderWrapper {
            background: rgba(18, 18, 18, 0.95) !important;
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            border-radius: 8px !important;
        }

        /* 6b. Spotify-style sound cards in lists (profile Recent / Tracks / etc.)
               Applies to profile lists (.soundList__item) and search results (.searchList__item).
               Real structure: li.soundList__item > .userStreamItem > .sound > .sound__body
                 .sound__body = [ .sound__artwork , .sound__content ]
               .sound__body becomes the grid; every wrapper below it is flattened with display:contents.
               Grid: [art] | label / TITLE / artist . date . tag . stats / (space) / [play] [actions]   */
        body:not(.sc-tiles) .soundList__item {
            --sc-card-art: 190px;
            margin-bottom: 36px !important;
            border: none !important;
        }

        body:not(.sc-tiles) .soundList__item .userStreamItem,
        body:not(.sc-tiles) .soundList__item .sound {
            background: transparent !important;
            border: none !important;
            padding: 0 !important;
            margin: 0 !important;
            box-shadow: none !important;
        }

        body:not(.sc-tiles) .soundList__item .sound__body {
            display: grid !important;
            grid-template-columns: var(--sc-card-art) 24px auto auto auto 1fr !important;
            grid-template-rows: auto auto auto 1fr auto auto !important;
            align-items: center !important;
            min-height: var(--sc-card-art) !important;
            margin: 0 !important;
            padding: 0 !important;
            background: transparent !important;
            border: none !important;
        }

        /* flatten the wrappers so their children become grid items of .sound__body */
        body:not(.sc-tiles) .soundList__item .sound__content,
        body:not(.sc-tiles) .soundList__item .sound__header,
        body:not(.sc-tiles) .soundList__item .sound__footer,
        body:not(.sc-tiles) .soundList__item .sound__soundActions,
        body:not(.sc-tiles) .soundList__item .sound__footerRight,
        body:not(.sc-tiles) .soundList__item .soundTitle,
        body:not(.sc-tiles) .soundList__item .soundTitle__titleContainer,
        body:not(.sc-tiles) .soundList__item .soundTitle__usernameTitleContainer,
        body:not(.sc-tiles) .soundList__item .soundTitle__secondary,
        body:not(.sc-tiles) .soundList__item .soundTitle__additionalContainer {
            display: contents !important;
        }

        /* small type label above the title (Spotify's "EP" / "Album") */
        body:not(.sc-tiles) .soundList__item .sound__body::before {
            content: 'Track';
            grid-column: 3 / -1;
            grid-row: 1;
            align-self: end;
            font-size: 12px;
            font-weight: 700 !important;
            color: #ffffff;
        }

        body:not(.sc-tiles) .soundList__item .sound.playlist .sound__body::before {
            content: 'Playlist';
        }

        /* artwork */
        body:not(.sc-tiles) .soundList__item .sound__artwork {
            grid-column: 1;
            grid-row: 1 / 6;
            align-self: start;
            width: var(--sc-card-art) !important;
            height: var(--sc-card-art) !important;
            margin: 0 !important;
            float: none !important;
            border-radius: 8px !important;
            overflow: hidden !important;
            box-shadow: 0 8px 24px rgba(0,0,0,0.5) !important;
        }

        body:not(.sc-tiles) .soundList__item .sound__coverArt,
        body:not(.sc-tiles) .soundList__item .sound__coverArt .image,
        body:not(.sc-tiles) .soundList__item .sound__coverArt span.sc-artwork {
            display: block !important;
            width: 100% !important;
            height: 100% !important;
            border-radius: 8px !important;
        }

        /* big title */
        body:not(.sc-tiles) .soundList__item .soundTitle__title,
        body:not(.sc-tiles) .soundList__item .soundTitle__title span {
            font-size: 44px !important;
            font-weight: 800 !important;
            line-height: 1.1 !important;
            color: #ffffff !important;
            letter-spacing: -0.02em !important;
            overflow-wrap: anywhere !important;
        }

        body:not(.sc-tiles) .soundList__item .soundTitle__title {
            grid-column: 3 / -1;
            grid-row: 2;
            display: block !important;
            margin: 6px 0 12px 0 !important;
            padding: 0 !important;
        }

        /* meta row: artist (accent) . date . tag . stats */
        body:not(.sc-tiles) .soundList__item .soundTitle__username,
        body:not(.sc-tiles) .soundList__item .soundTitle__username * {
            font-size: 13px !important;
            font-weight: 600 !important;
            color: var(--sc-accent) !important;
            text-decoration: none !important;
            background: transparent !important;
        }

        body:not(.sc-tiles) .soundList__item .soundTitle__username {
            grid-column: 3;
            grid-row: 3;
            margin: 0 !important;
            padding: 0 !important;
            white-space: nowrap !important;
        }

        body:not(.sc-tiles) .soundList__item .soundTitle__username:hover * {
            text-decoration: underline !important;
        }

        body:not(.sc-tiles) .soundList__item .soundTitle__uploadTime {
            grid-column: 4;
            grid-row: 3;
            margin: 0 !important;
            padding: 0 !important;
            white-space: nowrap !important;
        }

        body:not(.sc-tiles) .soundList__item .soundTitle__uploadTime time,
        body:not(.sc-tiles) .soundList__item .soundTitle__uploadTime span {
            font-size: 13px !important;
            color: #b3b3b3 !important;
        }

        body:not(.sc-tiles) .soundList__item .soundTitle__uploadTime::before {
            content: '\\2022';
            margin: 0 8px;
            color: #b3b3b3;
        }

        body:not(.sc-tiles) .soundList__item .soundTitle__tagContainer {
            grid-column: 5;
            grid-row: 3;
            margin: 0 0 0 12px !important;
            padding: 0 !important;
        }

        body:not(.sc-tiles) .soundList__item .sound__soundStats {
            grid-column: 6;
            grid-row: 3;
            justify-self: start;
            display: flex !important;
            align-items: center !important;
            margin: 0 0 0 12px !important;
            color: #b3b3b3 !important;
        }

        body:not(.sc-tiles) .soundList__item .sound__soundStats::before {
            content: '\\2022';
            margin-right: 10px;
            color: #b3b3b3;
        }

        body:not(.sc-tiles) .soundList__item .soundStats {
            display: flex !important;
            align-items: center !important;
            gap: 14px !important;
            margin: 0 !important;
            padding: 0 !important;
            list-style: none !important;
        }

        body:not(.sc-tiles) .soundList__item .soundStats * {
            font-size: 12px !important;
            color: #b3b3b3 !important;
        }

        /* playlist cards: the preview track list gets its own full-width row under the header */
        body:not(.sc-tiles) .soundList__item .sound__trackList {
            grid-column: 1 / -1;
            grid-row: 6;
            margin: 20px 0 0 0 !important;
            min-width: 0;
        }

        body:not(.sc-tiles) .soundList__item .compactTrackList,
        body:not(.sc-tiles) .soundList__item .compactTrackList__listWrapper,
        body:not(.sc-tiles) .soundList__item .compactTrackList__listContainer {
            width: 100% !important;
            max-width: none !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            background: transparent !important;
        }

        body:not(.sc-tiles) .soundList__item .compactTrackList ul {
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
        }

        body:not(.sc-tiles) .soundList__item .compactTrackList__moreLink {
            display: block !important;
            padding: 14px 12px 0 !important;
            border: none !important;
            font-size: 13px !important;
            color: #b3b3b3 !important;
            text-align: left !important;
        }

        body:not(.sc-tiles) .soundList__item .compactTrackList__moreLink:hover {
            color: #ffffff !important;
        }

        /* no trailing bullet when a card has no stats (playlists) */
        body:not(.sc-tiles) .soundList__item .sound__soundStats:not(:has(li))::before {
            display: none;
        }

        /* things a Spotify header doesn't have */
        body:not(.sc-tiles) .soundList__item .releaseDateCompact,
        body:not(.sc-tiles) .soundList__item .sound__waveform,
        body:not(.sc-tiles) .soundList__item .commentForm,
        body:not(.sc-tiles) .soundList__item .amplifyTrackButton,
        body:not(.sc-tiles) .soundList__item .sc-button-upload,
        body:not(.sc-tiles) .soundList__item .purchaseLink__container {
            display: none !important;
        }

        /* round accent play button */
        body:not(.sc-tiles) .soundList__item .soundTitle__playButton {
            grid-column: 3;
            grid-row: 5;
            align-self: center;
            position: static !important;
            float: none !important;
            width: auto !important;
            height: auto !important;
            margin: 0 !important;
            padding: 0 !important;
        }

        body:not(.sc-tiles) .soundList__item .soundTitle__playButton .sc-button-play,
        body:not(.sc-tiles) .soundList__item .soundTitle__playButton a {
            width: 52px !important;
            height: 52px !important;
            min-width: 52px !important;
            padding: 0 !important;
            margin: 0 !important;
            border-radius: 50% !important;
            background: var(--sc-accent) !important;
            color: #ffffff !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            transition: transform 0.1s ease !important;
        }

        body:not(.sc-tiles) .soundList__item .soundTitle__playButton .sc-button-play:hover,
        body:not(.sc-tiles) .soundList__item .soundTitle__playButton a:hover {
            transform: scale(1.06);
            background: var(--sc-accent) !important;
            color: #ffffff !important;
        }

        body:not(.sc-tiles) .soundList__item .soundTitle__playButton svg {
            width: 24px !important;
            height: 24px !important;
        }

        /* ghost circular action buttons */
        body:not(.sc-tiles) .soundList__item .soundActions {
            grid-column: 4 / -1;
            grid-row: 5;
            align-self: center;
            margin: 0 0 0 12px !important;
            padding: 0 !important;
        }

        body:not(.sc-tiles) .soundList__item .soundActions .sc-button-group {
            display: flex !important;
            align-items: center !important;
            gap: 4px !important;
        }

        body:not(.sc-tiles) .soundList__item .soundActions .sc-button {
            width: 40px !important;
            height: 40px !important;
            min-width: 40px !important;
            padding: 0 !important;
            margin: 0 !important;
            border-radius: 50% !important;
            background: transparent !important;
            border: none !important;
            box-shadow: none !important;
            color: #b3b3b3 !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            transition: color 0.2s ease, background 0.2s ease !important;
        }

        body:not(.sc-tiles) .soundList__item .soundActions .sc-button:hover {
            color: #ffffff !important;
            background: rgba(255, 255, 255, 0.08) !important;
        }

        body:not(.sc-tiles) .soundList__item .soundActions .sc-button svg {
            width: 18px !important;
            height: 18px !important;
        }

        /* 6c. Search page: SoundCloud sizes the title bar and filter column for its own full-width
               layout, which made them stick out of the glass panel and added a horizontal scrollbar */
        .l-search .l-fixed-top,
        .l-search .searchTitle {
            width: 100% !important;
            max-width: 100% !important;
            box-sizing: border-box !important;
            background: transparent !important;
        }

        .l-search .l-fixed-left,
        .l-search .searchOptions {
            width: 200px !important;
            overflow: hidden !important;
        }

        .l-search .l-main {
            margin-left: 224px !important;
        }

        /* 8. Track rows. One format everywhere: playlists, playlist previews and the song page.
               Columns: # | cover | title over artist | [hover actions] plays, like, length
               SoundCloud row:  .trackItem = [ __image , __numberWrapper , __content , __additional ]
               Our own row:     .sc-tp-row / .sc-tp-head (song page, and the header above playlists)        */
        .trackItem,
        .sc-tp-head,
        .sc-tp-row {
            display: grid !important;
            grid-template-columns: 24px 34px minmax(0, 1fr) auto !important;
            align-items: center !important;
            gap: 16px !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 10px 12px !important;
            box-sizing: border-box !important;
        }

        .trackItem,
        .sc-tp-row {
            border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
            border-radius: 8px;
            font-size: 13px;
            color: #a7a7a7;
            cursor: pointer;
        }

        .trackItem:hover,
        .trackItem.active,
        .sc-tp-row:hover,
        .sc-tp-row.sc-playing {
            background: rgba(255, 255, 255, 0.07) !important;
        }

        .sc-tp-head {
            padding-top: 0 !important;
            padding-bottom: 0 !important;
            height: 36px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            font-size: 12px;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: #a7a7a7;
        }

        .sc-tp-head > span:nth-child(2) {
            grid-column: 2 / 4;
        }

        .trackItem__numberWrapper,
        .trackItem__number,
        .sc-tp-num {
            grid-column: 1;
            grid-row: 1;
            width: 24px !important;
            margin: 0 !important;
            padding: 0 !important;
            text-align: center !important;
            font-size: 13px !important;
            font-weight: 400 !important;
            color: #a7a7a7 !important;
            font-variant-numeric: tabular-nums;
        }

        .trackItem__number {
            display: block !important;
        }

        .trackItem__number .trackItem__separator {
            margin: 0 !important;
            color: inherit !important;
        }

        .trackItem__image {
            grid-column: 2;
            grid-row: 1;
            position: relative !important;
            width: 34px !important;
            height: 34px !important;
            margin: 0 !important;
            padding: 0 !important;
        }

        .trackItem__image img,
        .trackItem__image .image,
        .trackItem__image span.sc-artwork,
        .sc-tp-row > img {
            width: 34px !important;
            height: 34px !important;
            border-radius: 4px !important;
            object-fit: cover !important;
        }

        /* title on top, artist below. align-items:flex-start keeps each link only as wide as its text,
           so clicking empty space in the row plays the track instead of opening the artist */
        .trackItem__content {
            grid-column: 3;
            grid-row: 1;
            display: flex !important;
            flex-direction: column !important;
            align-items: flex-start !important;
            justify-content: center !important;
            gap: 2px !important;
            min-width: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
        }

        .trackItem__trackTitle,
        .sc-tp-row-title {
            order: 1 !important;
            display: block !important;
            max-width: 100% !important;
            font-size: 13px !important;
            font-weight: 400 !important;
            line-height: 1.2 !important;
            color: #ffffff !important;
            white-space: nowrap !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            text-decoration: none !important;
        }

        .trackItem__username,
        .sc-tp-row-artist {
            order: 2 !important;
            display: block !important;
            max-width: 100% !important;
            margin: 0 !important;
            font-size: 11px !important;
            font-weight: 400 !important;
            line-height: 1.2 !important;
            color: #a7a7a7 !important;
            white-space: nowrap !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            text-decoration: none !important;
        }

        .sc-tp-row-artist {
            margin-top: 2px !important;
        }

        .trackItem__trackTitle:hover,
        .trackItem__username:hover {
            text-decoration: underline !important;
        }

        .trackItem__username:hover {
            color: #ffffff !important;
        }

        .trackItem.active .trackItem__trackTitle,
        .trackItem.active .trackItem__number,
        .sc-tp-row.sc-playing .sc-tp-row-title,
        .sc-tp-row.sc-playing .sc-tp-num {
            color: var(--sc-accent) !important;
        }

        .trackItem__content .sc-text-secondary {
            display: none !important;
        }

        /* right-hand group */
        .trackItem__additional,
        .sc-row-right {
            grid-column: 4;
            grid-row: 1;
            display: flex !important;
            align-items: center !important;
            gap: 16px !important;
            margin: 0 !important;
            padding: 0 !important;
            font-size: 13px !important;
            color: #a7a7a7 !important;
        }

        .trackItem__actions,
        .trackItem__actions .soundActions,
        .trackItem__actions .sc-button-group {
            display: contents !important;
        }

        .trackItem__tierIndicator {
            display: none !important;
        }

        .trackItem__playCount,
        .sc-row-plays {
            order: 2;
            width: 110px !important;
            margin: 0 !important;
            padding: 0 !important;
            text-align: right !important;
            font-size: 13px !important;
            color: #a7a7a7 !important;
            font-variant-numeric: tabular-nums;
        }

        .trackItem__playCount {
            display: block !important; /* SoundCloud hides it on the hovered / playing row */
        }

        .trackItem__playCount > div {
            display: none !important;
        }

        .sc-track-dur,
        .sc-row-dur {
            order: 4;
            width: 48px;
            text-align: right;
            font-size: 13px;
            color: #a7a7a7;
            font-variant-numeric: tabular-nums;
        }

        .sc-row-dur svg {
            width: 16px;
            height: 16px;
            vertical-align: middle;
        }

        .sc-row-like-slot {
            order: 3;
            width: 32px;
        }

        .trackItem__additional .sc-button,
        .sc-row-right .sc-tp-btn {
            order: 1;
            width: 32px !important;
            height: 32px !important;
            min-width: 32px !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            border-radius: 50% !important;
            background: transparent !important;
            box-shadow: none !important;
            color: #b3b3b3 !important;
            display: none !important;
            align-items: center !important;
            justify-content: center !important;
        }

        .trackItem:hover .trackItem__additional .sc-button {
            display: inline-flex !important;
        }

        .trackItem__additional .sc-button:hover {
            color: #ffffff !important;
            background: rgba(255, 255, 255, 0.08) !important;
        }

        .trackItem__additional .sc-button svg,
        .sc-row-right .sc-tp-btn svg {
            width: 16px !important;
            height: 16px !important;
        }

        /* like keeps its own column: invisible until hover, always shown once liked */
        .trackItem__additional .sc-button-like,
        .sc-row-right .sc-tp-btn {
            order: 3;
            display: inline-flex !important;
            visibility: hidden;
        }

        .trackItem:hover .trackItem__additional .sc-button-like,
        .trackItem__additional .sc-button-like.sc-button-selected,
        .sc-tp-row:hover .sc-row-right .sc-tp-btn,
        .sc-row-right .sc-tp-btn.sc-on {
            visibility: visible;
        }

        .trackItem__additional .sc-button-like.sc-button-selected {
            color: var(--sc-accent) !important;
        }

        /* playlist pages: track list uses the full width */
        .l-about-right,
        .listenDetails,
        .listenDetails__trackList {
            width: 100% !important;
            max-width: none !important;
            margin: 0 !important;
            padding: 0 !important;
            float: none !important;
            box-sizing: border-box !important;
        }

        /* 9. Artist page (any profile). Classes on <body> are set by updateArtistPage():
               sc-artist       a profile page is showing
               sc-artist-home  its "All" tab (gets the Popular + Fans also like sections)
               sc-tiles        lists render as Spotify discography tiles instead of big cards
              Order on screen: blurred header, play / follow row, Popular, Discography pills, tile grid */

        /* --- blurred profile picture fading down the panel --- */
        body.sc-artist .l-container.l-content {
            position: relative !important;
            overflow: hidden !important;
        }

        body.sc-artist .l-container.l-content::before {
            content: '';
            display: block !important; /* SoundCloud's clearfix makes this display:table, which collapses it to 0 wide */
            position: absolute;
            top: -120px;
            left: -120px;
            right: -120px;
            height: 900px;
            background-image: var(--sc-artist-img, none);
            background-size: cover;
            background-position: center 30%;
            filter: blur(70px) saturate(1.25);
            opacity: 0.75;
            -webkit-mask-image: linear-gradient(to bottom, #000 0%, rgba(0,0,0,0.75) 35%, rgba(0,0,0,0.25) 70%, transparent 100%);
            mask-image: linear-gradient(to bottom, #000 0%, rgba(0,0,0,0.75) 35%, rgba(0,0,0,0.25) 70%, transparent 100%);
            pointer-events: none;
            z-index: 0;
        }

        body.sc-artist .l-container.l-content > * {
            position: relative;
            z-index: 1;
        }

        /* --- header: avatar, big name, followers line --- */
        body.sc-artist .l-user-hero {
            margin: 0 !important;
            padding: 72px 24px 20px 24px !important;
            background: transparent !important;
        }

        body.sc-artist .profileHeader,
        body.sc-artist .profileHeader__info {
            position: static !important;
            height: auto !important;
            min-height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            background: transparent !important;
        }

        body.sc-artist .profileHeaderInfo {
            display: flex !important;
            align-items: flex-end !important;
            gap: 28px !important;
            margin: 0 !important;
            padding: 0 !important;
        }

        body.sc-artist .profileHeaderInfo__avatar {
            flex: 0 0 auto !important;
            width: 200px !important;
            height: 200px !important;
            margin: 0 !important;
            float: none !important;
            border-radius: 50% !important;
            box-shadow: 0 12px 40px rgba(0,0,0,0.55) !important;
        }

        body.sc-artist .profileHeaderInfo__avatar .image,
        body.sc-artist .profileHeaderInfo__avatar span.sc-artwork {
            width: 200px !important;
            height: 200px !important;
            border-radius: 50% !important;
        }

        body.sc-artist .profileHeaderInfo__content {
            flex: 1 1 auto !important;
            min-width: 0 !important;
            margin: 0 !important;
            padding: 0 0 6px 0 !important;
            overflow: visible !important;
        }

        body.sc-artist .profileHeaderInfo__userName::before,
        body.sc-artist .profileHeaderInfo__userName::after {
            display: none !important;
        }

        body.sc-artist .profileHeaderInfo__userName {
            display: block !important;
            margin: 0 !important;
            padding: 0 !important;
            font-size: clamp(48px, 5.6vw, 96px) !important;
            font-weight: 900 !important;
            line-height: 1.05 !important;
            letter-spacing: -0.04em !important;
            color: #ffffff !important;
            text-shadow: 0 2px 24px rgba(0,0,0,0.35);
            overflow-wrap: anywhere !important;
        }

        body.sc-artist .profileHeaderInfo__userName > div {
            font-size: inherit !important;
            font-weight: 900 !important;
            line-height: inherit !important;
            letter-spacing: inherit !important;
            color: inherit !important;
        }

        body.sc-artist .profileHeaderInfo__verifiedBadge svg {
            width: 24px !important;
            height: 24px !important;
        }

        body.sc-artist .profileHeaderInfo__additional {
            display: none !important;
        }

        #sc-artist-stats {
            margin-top: 10px;
            font-size: 15px;
            color: #ffffff;
            opacity: 0.9;
        }

        /* --- action row + tabs. .userInfoBar = [ __tabs , __buttons ] (+ our Popular section) --- */
        body.sc-artist .l-vertical-bar {
            height: auto !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            background: transparent !important;
            position: static !important;
        }

        body.sc-artist .userInfoBar {
            display: flex !important;
            flex-direction: column !important;
            align-items: stretch !important;
            height: auto !important;
            margin: 0 !important;
            padding: 8px 24px 0 24px !important;
            border: none !important;
            background: transparent !important;
        }

        body.sc-artist .userInfoBar__buttons {
            order: 1;
            display: flex !important;
            align-items: center !important;
            gap: 16px !important;
            float: none !important;
            margin: 0 0 28px 0 !important;
            padding: 0 !important;
        }

        body.sc-artist .userInfoBar__buttons .sc-button-group {
            display: flex !important;
            align-items: center !important;
            gap: 8px !important;
        }

        #sc-artist-popular { order: 2; }

        body.sc-artist .userInfoBar__tabs {
            order: 3;
            float: none !important;
            width: 100% !important;
            margin: 0 0 20px 0 !important;
            padding: 0 !important;
        }

        body.sc-artist .userInfoBar__tabs::before {
            content: 'Discography';
            display: block;
            margin: 0 0 14px 0;
            font-size: 24px;
            font-weight: 800 !important;
            letter-spacing: -0.02em;
            color: #ffffff;
        }

        .sc-artist-play {
            width: 56px;
            height: 56px;
            flex: 0 0 auto;
            border: none;
            border-radius: 50%;
            background: var(--sc-accent);
            color: #ffffff;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: transform 0.1s ease;
        }

        .sc-artist-play:hover {
            transform: scale(1.06);
        }

        .sc-artist-play svg {
            width: 26px;
            height: 26px;
        }

        /* Follow = outlined pill; station / share / more = plain icon circles */
        body.sc-artist .userInfoBar__buttons .sc-button {
            height: 34px !important;
            min-width: 34px !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            border-radius: 50% !important;
            background: transparent !important;
            box-shadow: none !important;
            color: #b3b3b3 !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            transition: color 0.2s ease, border-color 0.2s ease, transform 0.1s ease !important;
        }

        body.sc-artist .userInfoBar__buttons .sc-button:hover {
            color: #ffffff !important;
        }

        body.sc-artist .userInfoBar__buttons .sc-button svg {
            width: 20px !important;
            height: 20px !important;
        }

        body.sc-artist .userInfoBar__buttons .sc-button .sc-button-label {
            display: none !important;
        }

        body.sc-artist .userInfoBar__buttons .sc-button-follow,
        body.sc-artist .userInfoBar__buttons .sc-button-edit {
            order: -1;
            padding: 0 16px !important;
            border: 1px solid rgba(255, 255, 255, 0.45) !important;
            border-radius: 18px !important;
            color: #ffffff !important;
        }

        body.sc-artist .userInfoBar__buttons .sc-button-follow:hover,
        body.sc-artist .userInfoBar__buttons .sc-button-edit:hover {
            border-color: #ffffff !important;
            transform: scale(1.03);
        }

        body.sc-artist .userInfoBar__buttons .sc-button-follow > div,
        body.sc-artist .userInfoBar__buttons .sc-button-edit > div {
            display: none !important;
        }

        body.sc-artist .userInfoBar__buttons .sc-button-follow .sc-button-label,
        body.sc-artist .userInfoBar__buttons .sc-button-edit .sc-button-label {
            display: inline !important;
            font-size: 13px !important;
            font-weight: 700 !important;
            color: #ffffff !important;
        }

        /* tabs as Spotify filter pills */
        body.sc-artist .profileTabs {
            display: flex !important;
            flex-wrap: wrap !important;
            gap: 8px !important;
            height: auto !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
        }

        body.sc-artist .profileTabs .g-tabs-item {
            margin: 0 !important;
            padding: 0 !important;
            float: none !important;
        }

        body.sc-artist .profileTabs .g-tabs-link {
            display: block !important;
            height: auto !important;
            margin: 0 !important;
            padding: 7px 14px !important;
            border: none !important;
            border-radius: 16px !important;
            background: rgba(255, 255, 255, 0.08) !important;
            font-size: 13px !important;
            line-height: 1.3 !important;
            color: #ffffff !important;
            text-decoration: none !important;
            transition: background 0.2s ease !important;
        }

        body.sc-artist .profileTabs .g-tabs-link:hover {
            background: rgba(255, 255, 255, 0.14) !important;
        }

        body.sc-artist .profileTabs .g-tabs-link.active {
            background: var(--sc-accent) !important;
            color: #ffffff !important;
        }

        body.sc-artist .profileTabs .g-tabs-link::after,
        body.sc-artist .profileTabs .g-tabs-link::before {
            display: none !important;
        }

        /* --- Popular (left) + Fans also like (right) --- */
        #sc-artist-popular {
            display: none;
            grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr);
            gap: 48px;
            margin: 0 0 40px 0;
        }

        body.sc-artist-home #sc-artist-popular {
            display: grid;
        }

        #sc-artist-popular h2 {
            margin: 0 0 14px 0;
            font-size: 24px;
            font-weight: 800 !important;
            letter-spacing: -0.02em;
            color: #ffffff;
        }

        .sc-pop-row {
            display: grid;
            grid-template-columns: 28px 40px minmax(0, 1fr) 120px 56px;
            align-items: center;
            gap: 14px;
            padding: 8px 12px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 6px;
            cursor: pointer;
            color: #b3b3b3;
            font-size: 13px;
        }

        .sc-pop-row:hover {
            background: rgba(255, 255, 255, 0.07);
        }

        .sc-pop-row.sc-pop-extra {
            display: none;
        }

        #sc-artist-popular.sc-pop-open .sc-pop-row.sc-pop-extra {
            display: grid;
        }

        .sc-pop-num {
            text-align: center;
        }

        .sc-pop-row img {
            width: 40px;
            height: 40px;
            border-radius: 4px;
            object-fit: cover;
            background: rgba(255, 255, 255, 0.05);
        }

        .sc-pop-title {
            color: #ffffff;
            font-size: 14px;
            font-weight: 500 !important;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .sc-pop-plays {
            text-align: right;
            font-variant-numeric: tabular-nums;
        }

        .sc-pop-time {
            text-align: right;
            font-variant-numeric: tabular-nums;
        }

        .sc-pop-more {
            margin: 12px 0 0 12px;
            padding: 0;
            border: none;
            background: none;
            color: #b3b3b3;
            font-size: 13px;
            font-weight: 700 !important;
            cursor: pointer;
        }

        .sc-pop-more:hover {
            color: #ffffff;
        }

        .sc-fan-row {
            display: flex;
            align-items: center;
            gap: 14px;
            padding: 8px 10px;
            border-radius: 8px;
            color: #ffffff;
            text-decoration: none;
        }

        .sc-fan-row:hover {
            background: rgba(255, 255, 255, 0.07);
        }

        .sc-fan-row img {
            width: 52px;
            height: 52px;
            flex: 0 0 auto;
            border-radius: 50%;
            object-fit: cover;
            background: rgba(255, 255, 255, 0.05);
        }

        .sc-fan-name {
            font-size: 14px;
            font-weight: 600 !important;
            color: #ffffff;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .sc-fan-sub {
            font-size: 12px;
            color: #b3b3b3;
        }

        /* --- discography tiles: cover on top, name, then year ---
               li.soundList__item > (.userStreamItem >) .sound > .sound__body = [ .sound__artwork , .sound__content ] */
        body.sc-artist .l-user-main {
            padding: 0 24px !important;
            border: none !important;
            box-sizing: border-box !important;
        }

        body.sc-tiles .userMain__content ul.soundList,
        body.sc-tiles .userMain__content .soundList > ul {
            display: grid !important;
            grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)) !important;
            gap: 28px 20px !important;
        }

        body.sc-tiles .soundList__item {
            position: relative !important;
            min-width: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
        }

        body.sc-tiles .soundList__item:not(:has(.sound)) {
            display: none !important;
        }

        body.sc-tiles .soundList__item .userStreamItem,
        body.sc-tiles .soundList__item .sound,
        body.sc-tiles .soundList__item .sound__body,
        body.sc-tiles .soundList__item .sound__content,
        body.sc-tiles .soundList__item .sound__header,
        body.sc-tiles .soundList__item .soundTitle,
        body.sc-tiles .soundList__item .soundTitle__titleContainer,
        body.sc-tiles .soundList__item .soundTitle__usernameTitleContainer,
        body.sc-tiles .soundList__item .soundTitle__additionalContainer {
            display: block !important;
            position: static !important;
            width: auto !important;
            height: auto !important;
            min-height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            float: none !important;
            background: transparent !important;
            border: none !important;
            box-shadow: none !important;
        }

        body.sc-tiles .soundList__item .sound__artwork {
            display: block !important;
            width: 100% !important;
            height: auto !important;
            aspect-ratio: 1 / 1;
            margin: 0 0 10px 0 !important;
            float: none !important;
            border-radius: 8px !important;
            overflow: hidden !important;
            box-shadow: 0 8px 24px rgba(0,0,0,0.45) !important;
        }

        body.sc-tiles .soundList__item .sound__coverArt,
        body.sc-tiles .soundList__item .sound__coverArt .image,
        body.sc-tiles .soundList__item .sound__coverArt span.sc-artwork {
            display: block !important;
            width: 100% !important;
            height: 100% !important;
            border-radius: 8px !important;
        }

        body.sc-tiles .soundList__item .soundTitle__title {
            display: block !important;
            margin: 0 !important;
            padding: 0 !important;
            white-space: nowrap !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            text-decoration: none !important;
        }

        body.sc-tiles .soundList__item .soundTitle__title,
        body.sc-tiles .soundList__item .soundTitle__title span {
            font-size: 14px !important;
            font-weight: 600 !important;
            line-height: 1.4 !important;
            letter-spacing: 0 !important;
            color: #ffffff !important;
        }

        body.sc-tiles .soundList__item .soundTitle__title:hover span {
            text-decoration: underline !important;
        }

        /* year comes from data-sc-year, written by markReleaseYears() */
        body.sc-tiles .soundList__item .soundTitle__uploadTime {
            display: block !important;
            float: none !important;
            text-align: left !important;
            margin: 2px 0 0 0 !important;
            padding: 0 !important;
            font-size: 13px !important;
            line-height: 1.4 !important;
            color: #b3b3b3 !important;
        }

        body.sc-tiles .soundList__item .soundTitle__uploadTime > * {
            display: none !important;
        }

        body.sc-tiles .soundList__item .soundTitle__uploadTime::before {
            content: attr(data-sc-year) ' \\2022  Track';
        }

        body.sc-tiles .soundList__item .sound.playlist .soundTitle__uploadTime::before {
            content: attr(data-sc-year) ' \\2022  Playlist';
        }

        body.sc-tiles .soundList__item .soundTitle__secondary,
        body.sc-tiles .soundList__item .soundTitle__tagContainer,
        body.sc-tiles .soundList__item .releaseDateCompact,
        body.sc-tiles .soundList__item .sound__waveform,
        body.sc-tiles .soundList__item .sound__footer,
        body.sc-tiles .soundList__item .soundContext,
        body.sc-tiles .soundList__item .sound__body::before {
            display: none !important;
        }

        /* play button floats over the cover's bottom-right corner on hover */
        body.sc-tiles .soundList__item .soundTitle__playButton {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            height: auto !important;
            aspect-ratio: 1 / 1;
            margin: 0 !important;
            padding: 8px !important;
            box-sizing: border-box !important;
            display: flex !important;
            align-items: flex-end !important;
            justify-content: flex-end !important;
            pointer-events: none !important;
            opacity: 0;
            transform: translateY(6px);
            transition: opacity 0.2s ease, transform 0.2s ease;
        }

        body.sc-tiles .soundList__item:hover .soundTitle__playButton,
        body.sc-tiles .soundList__item .sound.playing .soundTitle__playButton {
            opacity: 1;
            transform: none;
        }

        body.sc-tiles .soundList__item .soundTitle__playButton .sc-button-play {
            pointer-events: auto !important;
            width: 44px !important;
            height: 44px !important;
            min-width: 44px !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            border-radius: 50% !important;
            background: var(--sc-accent) !important;
            color: #ffffff !important;
            box-shadow: 0 6px 16px rgba(0,0,0,0.5) !important;
            display: block !important;
        }

        body.sc-tiles .soundList__item .soundTitle__playButton svg {
            width: 22px !important;
            height: 22px !important;
        }

        /* section headings inside the list ("Spotlight", "Recent") */
        body.sc-artist .spotlightTitle,
        body.sc-artist .userstream__header {
            margin: 0 0 14px 0 !important;
            padding: 0 !important;
            border: none !important;
            background: transparent !important;
            font-size: 16px !important;
            font-weight: 700 !important;
            color: #b3b3b3 !important;
        }

        body.sc-artist .spotlight {
            margin: 0 0 32px 0 !important;
            padding: 0 !important;
            border: none !important;
        }

        body.sc-artist .spotlight > span.g-box-full {
            display: none !important;
        }

        /* 10. Song page.
               Logged-in SoundCloud renders track pages inside a same-origin iframe (iframe.webiIframe, a separate
               app with generated class names), so it cannot be restyled with CSS. Instead updateTrackPage() builds
               #sc-track-page from SoundCloud's API and forwards play / like / add-to-playlist to the real buttons
               inside the hidden iframe. Classes on <body>:
               sc-webi   the iframe is the active page
               sc-track  our own song page is showing (iframe hidden, only its dialogs are let through)      */

        /* iframe shown as-is ("Comments & details" view, or any page we don't rebuild): fit it into the layout */
        body.sc-webi .webiIframe {
            position: fixed !important;
            border: 0 !important;
            margin: 0 !important;
        }

        body.sc-webi:not(.sc-track) .webiIframe {
            top: calc(var(--sc-bar-h) + 16px) !important;
            left: var(--sc-left) !important;
            width: calc(100vw - var(--sc-left) - var(--sc-right)) !important;
            height: calc(100vh - var(--sc-bar-h) - 28px) !important;
            border-radius: 16px !important;
            z-index: 1001 !important; /* over #app (1000), whose page is hidden in this view */
        }

        body.sc-webi:not(.sc-track) .l-container.l-content {
            display: none !important;
        }

        /* iframe hidden behind our page; it is only revealed (full screen, transparent) while one of its
           dialogs or menus is open, e.g. Add to playlist */
        body.sc-track .webiIframe {
            top: 0 !important;
            left: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            background: transparent !important;
            visibility: hidden !important;
            pointer-events: none !important;
            z-index: 1000000 !important;
        }

        body.sc-track .webiIframe.sc-modal-open {
            visibility: visible !important;
            pointer-events: auto !important;
        }

        body.sc-track #content {
            display: none !important;
        }

        #sc-track-page {
            display: none;
        }

        body.sc-track #sc-track-page {
            display: block;
            padding: 24px;
        }

        /* artwork tint fading down the panel, same idea as the artist page */
        body.sc-track .l-container.l-content {
            position: relative !important;
            overflow: hidden !important;
            min-height: calc(100vh - 100px);
        }

        body.sc-track .l-container.l-content::before {
            content: '';
            display: block !important; /* SoundCloud's clearfix makes this display:table, which collapses it to 0 wide */
            position: absolute;
            top: -120px;
            left: -120px;
            right: -120px;
            height: 760px;
            background-image: var(--sc-track-img, none);
            background-size: cover;
            background-position: center;
            filter: blur(80px) saturate(1.4);
            opacity: 0.8;
            -webkit-mask-image: linear-gradient(to bottom, #000 0%, rgba(0,0,0,0.6) 45%, transparent 100%);
            mask-image: linear-gradient(to bottom, #000 0%, rgba(0,0,0,0.6) 45%, transparent 100%);
            pointer-events: none;
            z-index: 0;
        }

        body.sc-track .l-container.l-content > * {
            position: relative;
            z-index: 1;
        }

        .sc-tp-hero {
            display: flex;
            align-items: flex-end;
            gap: 24px;
            padding-top: 48px;
        }

        .sc-tp-art {
            width: 232px;
            height: 232px;
            flex: 0 0 auto;
            border-radius: 8px;
            object-fit: cover;
            background: rgba(255, 255, 255, 0.05);
            box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        }

        .sc-tp-info {
            min-width: 0;
        }

        .sc-tp-type {
            font-size: 13px;
            font-weight: 600 !important;
            color: #ffffff;
        }

        .sc-tp-title {
            margin: 4px 0 10px 0;
            font-size: clamp(40px, 4.6vw, 72px);
            font-weight: 800 !important;
            line-height: 1.05;
            letter-spacing: -0.04em;
            color: #ffffff;
            overflow-wrap: anywhere;
        }

        .sc-tp-meta {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 6px;
            font-size: 13px;
            color: #b3b3b3;
        }

        .sc-tp-artist,
        .sc-tp-artist:visited {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            color: var(--sc-accent) !important;
            font-weight: 600 !important;
            text-decoration: none;
        }

        .sc-tp-artist span {
            font-weight: 600 !important;
        }

        .sc-tp-artist:hover span {
            text-decoration: underline;
        }

        .sc-tp-artist img {
            width: 24px;
            height: 24px;
            border-radius: 50%;
            object-fit: cover;
        }

        .sc-tp-actions {
            display: flex;
            align-items: center;
            gap: 10px;
            margin: 28px 0 22px 0;
        }

        .sc-tp-btn {
            width: 40px;
            height: 40px;
            padding: 0;
            border: none;
            border-radius: 50%;
            background: transparent;
            color: #b3b3b3;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: color 0.2s ease, background 0.2s ease, transform 0.1s ease;
        }

        .sc-tp-btn:hover {
            color: #ffffff;
            background: rgba(255, 255, 255, 0.08);
        }

        .sc-tp-btn.sc-on {
            color: var(--sc-accent);
        }

        .sc-tp-btn.sc-on svg.sc-fillable {
            fill: currentColor;
        }

        .sc-tp-btn svg {
            width: 24px;
            height: 24px;
        }

        .sc-tp-native {
            margin-left: auto;
            padding: 8px 14px;
            border: none;
            border-radius: 16px;
            background: rgba(255, 255, 255, 0.08);
            color: #ffffff;
            font-size: 13px;
            cursor: pointer;
            transition: background 0.2s ease;
        }

        .sc-tp-native:hover {
            background: rgba(255, 255, 255, 0.14);
        }

        .sc-tp-foot {
            margin: 28px 0 0 0;
            font-size: 12px;
            line-height: 1.6;
            color: #a7a7a7;
        }

        .sc-tp-foot div:first-child {
            font-size: 13px;
        }

        .sc-tp-more-head {
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            margin: 56px 0 16px 0;
        }

        .sc-tp-more-head h2 {
            margin: 0;
            font-size: 24px;
            font-weight: 800 !important;
            letter-spacing: -0.02em;
            color: #ffffff;
        }

        .sc-tp-more-head a {
            font-size: 13px;
            font-weight: 700 !important;
            color: #b3b3b3;
            text-decoration: none;
        }

        .sc-tp-more-head a:hover {
            color: #ffffff;
            text-decoration: underline;
        }

        .sc-tp-more {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
            gap: 28px 20px;
        }

        .sc-tile {
            display: block;
            min-width: 0;
            text-decoration: none;
        }

        .sc-tile img {
            display: block;
            width: 100%;
            aspect-ratio: 1 / 1;
            margin-bottom: 10px;
            border-radius: 8px;
            object-fit: cover;
            background: rgba(255, 255, 255, 0.05);
            box-shadow: 0 8px 24px rgba(0,0,0,0.45);
        }

        .sc-tile-title {
            font-size: 14px;
            font-weight: 600 !important;
            line-height: 1.4;
            color: #ffffff;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .sc-tile:hover .sc-tile-title {
            text-decoration: underline;
        }

        .sc-tile-sub {
            margin-top: 2px;
            font-size: 13px;
            color: #b3b3b3;
        }

        #sc-track-back {
            display: none;
            position: fixed;
            top: calc(var(--sc-bar-h) + 28px);
            right: calc(var(--sc-right) + 24px);
            z-index: 1001; /* over #app (1000) */
            padding: 8px 14px;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 18px;
            background: rgba(18, 18, 18, 0.92);
            color: #ffffff;
            font-size: 13px;
            cursor: pointer;
            box-shadow: 0 6px 20px rgba(0,0,0,0.5);
        }

        body.sc-webi.sc-track-native #sc-track-back {
            display: block;
        }

        /* 11. Library panel (expanded state mirrors Spotify: header with Create, filter chips, typed rows) */
        .sc-lib-head {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
            width: 100%;
            flex-shrink: 0;
        }

        .sc-lib-toggle,
        .sc-lib-create {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            width: 56px;
            height: 56px;
            padding: 0;
            border: none;
            border-radius: 12px;
            background: transparent;
            color: #b3b3b3;
            cursor: pointer;
            text-decoration: none;
            flex-shrink: 0;
            transition: background 0.2s ease, color 0.2s ease;
        }

        .sc-lib-create:visited {
            color: #b3b3b3;
        }

        .sc-lib-toggle:hover,
        .sc-lib-create:hover {
            background: rgba(255, 255, 255, 0.08);
            color: #ffffff;
        }

        .sc-lib-toggle span,
        .sc-lib-create span {
            display: none;
            white-space: nowrap;
        }

        #lc-left-bar.expanded .sc-lib-head {
            flex-direction: row;
            justify-content: space-between;
            padding: 6px 12px 6px 8px;
            box-sizing: border-box;
        }

        #lc-left-bar.expanded .sc-lib-toggle {
            width: auto;
            height: 44px;
            padding: 0 10px;
            color: #ffffff;
        }

        #lc-left-bar.expanded .sc-lib-toggle span {
            display: inline;
            font-size: 18px;
            font-weight: 700 !important;
            letter-spacing: -0.01em;
            color: #ffffff;
        }

        #lc-left-bar.expanded .sc-lib-create {
            width: auto;
            height: 32px;
            padding: 0 14px 0 10px;
            gap: 6px;
            border-radius: 16px;
            background: rgba(255, 255, 255, 0.08);
            color: #ffffff;
        }

        #lc-left-bar.expanded .sc-lib-create:hover {
            background: rgba(255, 255, 255, 0.14);
        }

        #lc-left-bar.expanded .sc-lib-create span {
            display: inline;
            font-size: 13px;
            font-weight: 700 !important;
            color: #ffffff;
        }

        #lc-left-bar.expanded .sc-lib-create svg {
            width: 18px;
            height: 18px;
        }

        .sc-lib-chips {
            display: none;
            gap: 8px;
            padding: 4px 16px 10px 16px;
            flex-shrink: 0;
        }

        #lc-left-bar.expanded .sc-lib-chips {
            display: flex;
        }

        .sc-lib-chips button {
            padding: 6px 12px;
            border: none;
            border-radius: 16px;
            background: rgba(255, 255, 255, 0.08);
            color: #ffffff;
            font-size: 13px;
            cursor: pointer;
            transition: background 0.2s ease;
        }

        .sc-lib-chips button:hover {
            background: rgba(255, 255, 255, 0.14);
        }

        #lc-left-bar[data-filter="playlist"] .sc-lib-chips button[data-filter="playlist"],
        #lc-left-bar[data-filter="artist"] .sc-lib-chips button[data-filter="artist"] {
            background: var(--sc-accent);
        }

        #lc-left-bar[data-filter="playlist"] .sc-sidebar-row[data-type="artist"],
        #lc-left-bar[data-filter="artist"] .sc-sidebar-row[data-type="playlist"] {
            display: none;
        }

        /* another lyrics userscript's widgets sat in the space our lyrics panel now uses */
        #scl-panel, #scl-fab-wrap, #scl-artist-pill, #scl-artist-panel, #scl-upgrade-prompt {
            display: none !important;
        }

        /* 12. Lyrics panel (right column). Lines come from LRCLIB; the active line follows playback. */
        #sc-lyrics {
            position: fixed;
            top: calc(var(--sc-bar-h) + 16px);
            right: 12px;
            bottom: 12px;
            width: calc(var(--sc-right) - 24px);
            background: rgba(18, 18, 18, 0.75);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 16px;
            backdrop-filter: blur(30px);
            -webkit-backdrop-filter: blur(30px);
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            overflow: hidden;
            z-index: 998;
        }

        .sc-ly-scroll {
            position: absolute;
            inset: 0;
            padding: 40vh 28px 45vh 28px;
            overflow-y: auto;
            scrollbar-width: none;
            -webkit-mask-image: linear-gradient(to bottom, transparent 0%, #000 14%, #000 80%, transparent 100%);
            mask-image: linear-gradient(to bottom, transparent 0%, #000 14%, #000 80%, transparent 100%);
        }

        .sc-ly-scroll::-webkit-scrollbar {
            display: none;
        }

        .sc-ly-line {
            margin: 0 0 14px 0;
            font-size: 26px;
            font-weight: 700 !important;
            line-height: 1.25;
            letter-spacing: -0.02em;
            color: rgba(255, 255, 255, 0.32);
            cursor: pointer;
            transition: color 0.25s ease, filter 0.25s ease;
            overflow-wrap: anywhere;
        }

        .sc-ly-line:hover {
            color: rgba(255, 255, 255, 0.75);
        }

        .sc-ly-line.sc-past {
            color: rgba(255, 255, 255, 0.5);
        }

        .sc-ly-line.sc-active {
            color: #ffffff;
            text-shadow: 0 0 24px rgba(255, 255, 255, 0.25);
        }

        #sc-lyrics.sc-ly-plain .sc-ly-scroll {
            padding-top: 32px;
            padding-bottom: 140px;
        }

        #sc-lyrics.sc-ly-plain .sc-ly-line {
            font-size: 20px;
            color: rgba(255, 255, 255, 0.85);
            cursor: default;
        }

        .sc-ly-note {
            margin-top: 28px;
            font-size: 11px;
            color: rgba(255, 255, 255, 0.35);
        }

        .sc-ly-empty {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 32px;
            text-align: center;
            font-size: 15px;
            color: rgba(255, 255, 255, 0.45);
        }

        /* 13. Playlist header details + things nobody uses */
        .autoTagger {
            display: none !important;
        }

        /* The cover must sit flush with the bottom of the creator line. A grid item spanning the text rows
           inflates them, so the cover's own box is 0 tall and the picture hangs upward from its bottom edge;
           min-height + align-content keep room for it above. */
        .fullHero__foreground {
            grid-template-rows: auto auto auto 80px !important;
            align-content: end !important;
            min-height: calc(var(--sc-hero-art) + 88px) !important;
        }

        .fullHero__artwork {
            position: relative !important;
            inset: auto !important; /* SoundCloud's own top/right offsets would shift it */
            align-self: end !important;
            height: 0 !important;
            overflow: visible !important;
            border-radius: 0 !important;
            box-shadow: none !important;
        }

        .fullHero__artwork > .listenArtworkWrapper {
            position: absolute !important;
            left: 0 !important;
            bottom: 0 !important;
            width: var(--sc-hero-art) !important;
            height: var(--sc-hero-art) !important;
            border-radius: 8px !important;
            overflow: hidden !important;
            box-shadow: 0 8px 24px rgba(0,0,0,0.5) !important;
        }

        /* your own playlists wrap the cover in an image editor, which collapsed it to 0 height */
        .fullHero__artwork .editImage,
        .fullHero__artwork .editImage__select {
            display: block !important;
            position: static !important;
            width: 100% !important;
            height: 100% !important;
        }

        .fullHero__artwork .imageChooser,
        .fullHero__artwork .editImage__Overlay,
        .fullHero__artwork .editImage__cropper,
        .fullHero__artwork .editImage__error {
            display: none !important;
        }

        /* creator . tracks . length . updated: one centred line */
        .fullHero .soundTitle__username,
        .fullHero__tracksSummary {
            align-self: center !important;
            display: flex !important;
            align-items: center !important;
            height: 24px !important;
            line-height: 24px !important;
        }

        .fullHero__info {
            align-self: center !important;
            display: block !important;
            height: 24px !important;
            line-height: 24px !important;
            white-space: nowrap !important;
        }

        .fullHero__info *,
        .fullHero__info b,
        .fullHero__info strong {
            font-weight: 400 !important;
        }

        .fullHero .soundTitle__username *,
        .fullHero__tracksSummary .genericTrackCount > div,
        .fullHero__info,
        .fullHero__info time,
        .fullHero__info span,
        .fullHero__info a {
            line-height: 24px !important;
        }

        .fullHero__tracksSummary .genericTrackCount {
            align-items: center !important;
        }

        .fullHero .soundTitle__username a {
            display: inline-flex !important;
            align-items: center !important;
            gap: 6px !important;
        }

        .sc-hero-avatar {
            width: 24px;
            height: 24px;
            border-radius: 50%;
            object-fit: cover;
            flex: 0 0 auto;
        }

        /* tabs with nothing behind them (set by updateArtistPage) */
        .profileTabs .g-tabs-item.sc-tab-empty {
            display: none !important;
        }

        /* 14. Song page: about + comments */
        .sc-tp-about {
            margin-top: 40px;
            max-width: 900px;
        }

        .sc-tp-about h2,
        .sc-tp-comments h2 {
            margin: 0 0 14px 0;
            font-size: 24px;
            font-weight: 800 !important;
            letter-spacing: -0.02em;
            color: #ffffff;
        }

        .sc-tp-about-text {
            font-size: 14px;
            line-height: 1.6;
            color: #b3b3b3;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
            display: -webkit-box;
            -webkit-box-orient: vertical;
            -webkit-line-clamp: 5;
            overflow: hidden;
        }

        .sc-tp-about.sc-open .sc-tp-about-text {
            display: block;
        }

        .sc-tp-textbtn {
            margin-top: 10px;
            padding: 0;
            border: none;
            background: none;
            color: #ffffff;
            font-size: 13px;
            font-weight: 700 !important;
            cursor: pointer;
        }

        .sc-tp-textbtn:hover {
            text-decoration: underline;
        }

        .sc-tp-comments {
            margin-top: 56px;
            max-width: 900px;
        }

        .sc-tp-comments h2 span {
            margin-left: 8px;
            font-size: 14px;
            font-weight: 400 !important;
            letter-spacing: 0;
            color: #a7a7a7;
        }

        .sc-comment {
            display: grid;
            grid-template-columns: 40px minmax(0, 1fr);
            gap: 12px;
            padding: 12px 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        }

        .sc-comment img {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            object-fit: cover;
            background: rgba(255, 255, 255, 0.05);
        }

        .sc-comment-head {
            font-size: 12px;
            color: #a7a7a7;
        }

        .sc-comment-head a {
            font-size: 13px;
            font-weight: 600 !important;
            color: #ffffff;
            text-decoration: none;
        }

        .sc-comment-head a:hover {
            text-decoration: underline;
        }

        .sc-comment-time {
            padding: 1px 6px;
            border: none;
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.1);
            color: #ffffff;
            font-size: 11px;
            cursor: pointer;
        }

        .sc-comment-body {
            margin-top: 4px;
            font-size: 14px;
            line-height: 1.45;
            color: #e6e6e6;
            overflow-wrap: anywhere;
        }

        /* 15. Row details: fixed right-hand columns + play button in the number slot */

        /* Right-hand group is a grid with fixed columns, so plays / like / length never shift when
           SoundCloud re-renders a row (it only creates the like button on hover, and rebuilds the row on play).
           cols: repost | share | copy | more | plays | like | length */
        .trackItem__additional,
        .sc-row-right {
            display: grid !important;
            grid-template-columns: auto auto auto auto 110px 48px 64px !important;
            align-items: center !important;
            gap: 0 !important;
        }

        .trackItem__additional > *,
        .trackItem__additional .sc-button,
        .sc-row-right > * {
            grid-row: 1;
        }

        .trackItem__additional .sc-button-repost   { grid-column: 1; }
        .trackItem__additional .sc-button-share    { grid-column: 2; }
        .trackItem__additional .sc-button-copylink { grid-column: 3; }
        .trackItem__additional .sc-button-more     { grid-column: 4; }
        .trackItem__additional .sc-button-queue    { grid-column: 4; }

        .trackItem__playCount,
        .sc-row-plays {
            grid-column: 5;
        }

        .trackItem__additional .sc-button-like,
        .sc-row-right .sc-tp-btn,
        .sc-row-like-slot {
            grid-column: 6;
            justify-self: end;
        }

        .sc-track-dur,
        .sc-row-dur {
            grid-column: 7;
            justify-self: end;
        }

        /* play / pause lives where the track number is (Spotify style), not on the cover */
        .trackItem {
            position: relative !important;
        }

        .trackItem__image {
            position: static !important;
        }

        .trackItem__play {
            position: absolute !important;
            left: 12px !important;
            top: 50% !important;
            width: 24px !important;
            height: 24px !important;
            margin: 0 !important;
            transform: translateY(-50%) !important;
            display: none !important;
            align-items: center !important;
            justify-content: center !important;
            background: transparent !important;
            opacity: 1 !important;
        }

        .trackItem:hover .trackItem__play,
        .trackItem.active .trackItem__play {
            display: flex !important;
        }

        .trackItem:hover .trackItem__number,
        .trackItem.active .trackItem__number {
            visibility: hidden !important;
        }

        .trackItem__play .sc-button-play {
            width: 24px !important;
            height: 24px !important;
            min-width: 24px !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            border-radius: 0 !important;
            background: transparent !important;
            box-shadow: none !important;
            color: #ffffff !important;
        }

        .trackItem.active .trackItem__play .sc-button-play {
            color: var(--sc-accent) !important;
        }

        .trackItem__play .sc-button-play svg {
            width: 16px !important;
            height: 16px !important;
        }

        .sc-tp-row .sc-tp-num {
            position: relative;
        }

        .sc-num-icon {
            display: none;
            color: #ffffff;
        }

        .sc-num-icon svg {
            width: 16px;
            height: 16px;
            vertical-align: middle;
        }

        .sc-tp-row:hover .sc-num-icon,
        .sc-tp-row.sc-playing .sc-num-icon {
            display: inline;
        }

        .sc-tp-row:hover .sc-num-text,
        .sc-tp-row.sc-playing .sc-num-text {
            display: none;
        }

        .sc-tp-row.sc-playing .sc-num-icon {
            color: var(--sc-accent);
        }

        /* 16. Player bar: queue button alignment + inline volume slider */
        .playControls .playbackSoundBadge__like,
        .playControls .playbackSoundBadge__avatar,
        .playControls .playbackSoundBadge__titleContextContainer {
            align-self: center !important;
        }

        .playControls .playbackSoundBadge__showQueue {
            align-self: center !important;
            position: relative !important;
            top: 0 !important;
            margin: 0 !important;
            vertical-align: middle !important;
        }

        .playControls__volume {
            gap: 6px;
        }

        .playControls .volume {
            position: static !important;
            display: flex !important;
            align-items: center !important;
            width: auto !important;
            height: auto !important;
        }

        /* SoundCloud's vertical pop-up stays in the page (our slider drives it) but is never shown */
        .playControls .volume__sliderWrapper {
            display: block !important;
            position: absolute !important;
            left: 0 !important;
            bottom: 40px !important;
            top: auto !important;
            width: 20px !important;
            height: 100px !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            opacity: 0 !important;
            transform: none !important;
            pointer-events: none !important;
        }

        .sc-vol {
            width: 84px;
            height: 24px;
            display: flex;
            align-items: center;
            cursor: pointer;
            touch-action: none;
        }

        .sc-vol-track {
            position: relative;
            width: 100%;
            height: 4px;
            border-radius: 2px;
            background: rgba(255, 255, 255, 0.15);
        }

        .sc-vol-fill {
            position: absolute;
            left: 0;
            top: 0;
            height: 100%;
            border-radius: 2px;
            background: var(--sc-accent);
        }

        .sc-vol-knob {
            position: absolute;
            top: 50%;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: #ffffff;
            transform: translate(-50%, -50%);
            box-shadow: 0 2px 6px rgba(0,0,0,0.5);
            opacity: 0;
            transition: opacity 0.15s ease;
        }

        .sc-vol:hover .sc-vol-knob,
        .sc-vol.sc-dragging .sc-vol-knob {
            opacity: 1;
        }

        /* 17. Your own profile: SoundCloud's edit layers */
        /* a transparent "edit header image" layer covers the whole page and swallows every click under it */
        .profileHeader__edit {
            display: none !important;
        }

        /* the avatar editor draws a square tinted overlay behind the round picture */
        body.sc-artist .profileHeaderInfo__avatar .editImage,
        body.sc-artist .profileHeaderInfo__avatar .editImage__select {
            display: block !important;
            width: 100% !important;
            height: 100% !important;
            border-radius: 50% !important;
            overflow: hidden !important;
            background: transparent !important;
        }

        body.sc-artist .profileHeaderInfo__avatar .editImage__Overlay,
        body.sc-artist .profileHeaderInfo__avatar .editImage__cropper,
        body.sc-artist .profileHeaderInfo__avatar .editImage__error,
        body.sc-artist .profileHeaderInfo__avatar .imageChooser,
        body.sc-artist .profileHeaderInfo__avatar .imageEditDropdownButton,
        body.sc-artist .profileHeaderInfo__avatar .editImage__button {
            display: none !important;
        }

        body.sc-artist .profileHeaderInfo__avatar .image {
            background: transparent !important;
        }

        .profileTabs .g-tabs-item:has(> a[href$="/vinyl-store"]) {
            display: none !important;
        }

        /* 18. Tile shelves (Discover, Library): horizontal rows of 180px tiles with title + subtitle */
        .modularHomeHeading__title {
            margin: 0 0 8px 0 !important;
            padding: 0 !important;
            border: none !important;
            font-size: 32px !important;
            font-weight: 800 !important;
            letter-spacing: -0.03em !important;
            color: #ffffff !important;
        }

        .mixedSelectionModule__title,
        .mixedSelectionModule__titleText {
            margin: 0 !important;
            padding: 0 !important;
            font-size: 22px !important;
            font-weight: 800 !important;
            letter-spacing: -0.02em !important;
            color: #ffffff !important;
        }

        .mixedSelectionModule {
            margin: 0 0 36px 0 !important;
            padding: 0 !important;
            border: none !important;
        }

        .mixedSelectionModule__title {
            margin-bottom: 14px !important;
        }

        .mixedModularHome__item {
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
        }

        .tileGallery {
            position: relative !important;
            width: 100% !important;
            height: auto !important;
            margin: 0 !important;
            padding: 0 !important;
        }

        .tileGallery,
        .tileGallery__slider,
        .tileGallery__sliderPanelSlide {
            max-height: none !important;
            min-height: 0 !important;
        }

        .tileGallery__slider {
            width: 100% !important;
            height: auto !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow-x: auto !important;
            overflow-y: hidden !important;
            scrollbar-width: none;
            scroll-behavior: smooth;
        }

        .tileGallery__slider::-webkit-scrollbar {
            display: none;
        }

        .tileGallery__sliderPeekContainer,
        .tileGallery__sliderPanel {
            width: max-content !important;
            height: auto !important;
            margin: 0 !important;
            padding: 0 !important;
            transform: none !important;
        }

        .tileGallery__sliderPanel {
            display: flex !important;
            gap: 20px !important;
        }

        .tileGallery__sliderPanelSlide {
            flex: 0 0 180px !important;
            width: 180px !important;
            height: auto !important;
            margin: 0 !important;
            padding: 0 !important;
        }

        .tileGallery .playableTile {
            display: block !important;
            width: 180px !important;
            height: auto !important;
            margin: 0 !important;
            padding: 0 !important;
        }

        .tileGallery .playableTile__artwork {
            position: relative !important;
            width: 180px !important;
            height: 180px !important;
            margin: 0 !important;
            padding: 0 !important; /* SoundCloud makes it square with padding-bottom:100%, doubling the height */
            box-sizing: border-box !important;
            border-radius: 8px !important;
            overflow: hidden !important;
            box-shadow: 0 8px 24px rgba(0,0,0,0.45) !important;
        }

        .tileGallery .playableTile__imageOverlay {
            display: none !important;
        }

        .tileGallery .playableTile__artworkLink,
        .tileGallery .playableTile__image,
        .tileGallery .playableTile__image .image,
        .tileGallery .playableTile__image span.sc-artwork {
            display: block !important;
            width: 100% !important;
            height: 100% !important;
            border-radius: 8px !important;
        }

        .tileGallery .playableTile__description {
            display: block !important;
            width: 100% !important;
            margin: 10px 0 0 0 !important;
            padding: 0 !important;
        }

        .tileGallery .playableTile__mainHeading,
        .tileGallery .playableTile__heading {
            display: block !important;
            font-size: 14px !important;
            font-weight: 600 !important;
            line-height: 1.4 !important;
            color: #ffffff !important;
            white-space: nowrap !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
        }

        .tileGallery .playableTile__usernameHeadingContainer,
        .tileGallery .playableTile__usernameHeading,
        .tileGallery .playableTile__releaseData {
            font-size: 13px !important;
            line-height: 1.4 !important;
            color: #b3b3b3 !important;
            white-space: nowrap !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
        }

        .tileGallery .playableTile__usernameHeadingContainer {
            display: block !important;
            margin: 2px 0 0 0 !important;
        }

        .tileGallery .playableTile__actions {
            display: none !important;
        }

        /* accent play button in the cover's corner on hover */
        .tileGallery .playableTile__playButton {
            position: absolute !important;
            inset: auto 8px 8px auto !important;
            width: 44px !important;
            height: 44px !important;
            margin: 0 !important;
            transform: translateY(6px) !important;
            opacity: 0 !important;
            transition: opacity 0.2s ease, transform 0.2s ease !important;
        }

        .tileGallery .playableTile:hover .playableTile__playButton,
        .tileGallery .playableTile.m-playing .playableTile__playButton {
            opacity: 1 !important;
            transform: none !important;
        }

        .tileGallery .playableTile__playButton .sc-button-play {
            display: block !important;
            width: 44px !important;
            height: 44px !important;
            min-width: 44px !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            border-radius: 50% !important;
            background: var(--sc-accent) !important;
            color: #ffffff !important;
            box-shadow: 0 6px 16px rgba(0,0,0,0.5) !important;
        }

        .tileGallery .playableTile__playButton svg {
            width: 22px !important;
            height: 22px !important;
        }

        /* shelf arrows: shown on hover, scroll the row (see setupShelfArrows) */
        .tileGallery__sliderPeek {
            position: absolute !important;
            top: 68px !important;
            width: 44px !important;
            height: 44px !important;
            margin: 0 !important;
            padding: 0 !important;
            background: none !important;
            opacity: 0;
            transition: opacity 0.2s ease;
            z-index: 2;
        }

        .tileGallery:hover .tileGallery__sliderPeek {
            opacity: 1;
        }

        .tileGallery__sliderPeekForward  { right: 4px !important; left: auto !important; }
        .tileGallery__sliderPeekBackward { left: 4px !important; right: auto !important; }

        .tileGallery__sliderButton {
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            width: 44px !important;
            height: 44px !important;
            margin: 0 !important;
            padding: 0 !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
            border-radius: 50% !important;
            background: rgba(18, 18, 18, 0.9) !important;
            color: #ffffff !important;
            box-shadow: 0 6px 16px rgba(0,0,0,0.5) !important;
            visibility: visible !important;
            opacity: 1 !important;
        }

        /* 19. Search: title, filter pills, then results as a two-column grid of compact cards */
        .l-search {
            display: flex !important;
            flex-direction: column !important;
            padding: 16px 8px 0 8px !important;
        }

        .l-search .l-fixed-top,
        .l-search .l-fixed-left,
        .l-search .l-main {
            position: static !important;
            width: 100% !important;
            height: auto !important;
            margin: 0 !important;
            padding: 0 !important;
            float: none !important;
            overflow: visible !important;
            background: transparent !important;
            border: none !important;
        }

        .l-search .searchTitle,
        .l-search .searchTitle__text {
            position: static !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            background: transparent !important;
            border: none !important;
        }

        .l-search .searchTitle__text,
        .l-search .searchTitle__textContent {
            font-size: 36px !important;
            font-weight: 800 !important;
            line-height: 1.1 !important;
            letter-spacing: -0.03em !important;
            color: #ffffff !important;
        }

        .l-search .searchOptions,
        .l-search .searchOptions__scrollable,
        .l-search .searchOptions__scrollableInner,
        .l-search .searchOptions__container {
            position: static !important;
            width: 100% !important;
            height: auto !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
            background: transparent !important;
            border: none !important;
        }

        .l-search .searchOptions__navigation {
            display: flex !important;
            flex-wrap: wrap !important;
            gap: 8px !important;
            margin: 18px 0 28px 0 !important;
            padding: 0 !important;
        }

        .l-search .searchOptions__navigationItem {
            flex: 0 0 auto !important;
            width: auto !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            background: transparent !important;
        }

        .l-search .searchOptions__navigation-high_tier {
            display: none !important;
        }

        .l-search .searchOptions__navigationLink {
            display: block !important;
            padding: 7px 16px !important;
            border-radius: 16px !important;
            background: rgba(255, 255, 255, 0.08) !important;
            font-size: 13px !important;
            line-height: 1.3 !important;
            color: #ffffff !important;
            text-decoration: none !important;
            transition: background 0.2s ease !important;
        }

        .l-search .searchOptions__navigationLink:hover {
            background: rgba(255, 255, 255, 0.14) !important;
        }

        .l-search .searchOptions__navigationItem.active .searchOptions__navigationLink {
            background: var(--sc-accent) !important;
            color: #ffffff !important;
        }

        /* legal links: moved under the results by moveSearchFooter(); hidden until then */
        .l-search .searchOptions__footer {
            display: none !important;
        }

        .sc-search-footer {
            margin: 48px 0 0 0;
            padding: 16px 0 0 0;
            border-top: 1px solid rgba(255, 255, 255, 0.08);
            font-size: 11px;
            line-height: 1.8;
            color: rgba(255, 255, 255, 0.35);
        }

        .sc-search-footer a {
            color: rgba(255, 255, 255, 0.45) !important;
            text-decoration: none !important;
        }

        .sc-search-footer a:hover {
            color: #ffffff !important;
        }

        .sc-search-footer .localeSelector,
        .sc-search-footer [class*="locale" i],
        .sc-search-footer [class*="language" i] {
            display: none !important;
        }

        .l-search .searchList .lazyLoadingList__list {
            display: grid !important;
            grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)) !important;
            gap: 12px !important;
            margin: 0 !important;
            padding: 0 !important;
        }

        /* "Found 500+ playlists, ..." line: its own full-width row above the cards */
        .l-search .searchList .lazyLoadingList__list > :not(.searchList__item) {
            grid-column: 1 / -1 !important;
            margin: 0 !important;
            padding: 0 !important;
            text-align: left !important;
            font-size: 13px !important;
            color: #a7a7a7 !important;
        }

        .l-search .searchList__item {
            min-width: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
        }

        .l-search .searchList__item:not(:has(.sound, .userItem)) {
            display: none !important;
        }

        .l-search .searchItem {
            height: 100%;
        }

        /* one card: [cover 72] [label / title / meta] [play or follow] */
        .l-search .searchItem .sound,
        .l-search .searchItem .userItem {
            position: relative !important;
            display: block !important;
            height: 100% !important;
            min-height: 96px !important;
            margin: 0 !important;
            padding: 12px !important;
            box-sizing: border-box !important;
            border: 1px solid rgba(255, 255, 255, 0.06) !important;
            border-radius: 14px !important;
            background: rgba(255, 255, 255, 0.04) !important;
            transition: background 0.2s ease, border-color 0.2s ease !important;
        }

        .l-search .searchItem .sound:hover,
        .l-search .searchItem .userItem:hover {
            background: rgba(255, 255, 255, 0.09) !important;
            border-color: rgba(255, 255, 255, 0.12) !important;
        }

        .l-search .searchItem .sound__body {
            display: grid !important;
            grid-template-columns: 72px minmax(0, 1fr) 44px !important;
            grid-template-rows: auto auto auto !important;
            column-gap: 14px !important;
            align-items: center !important;
            align-content: center !important;
            min-height: 72px !important;
            margin: 0 !important;
            padding: 0 !important;
        }

        .l-search .searchItem .sound__body::before {
            content: 'Track';
            grid-column: 2;
            grid-row: 1;
            align-self: end;
            font-size: 11px;
            font-weight: 600 !important;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: var(--sc-accent);
        }

        .l-search .searchItem .sound.playlist .sound__body::before {
            content: 'Playlist';
        }

        .l-search .searchItem .sound__artwork {
            grid-column: 1;
            grid-row: 1 / 4;
            align-self: center;
            width: 72px !important;
            height: 72px !important;
            margin: 0 !important;
            border-radius: 8px !important;
            overflow: hidden !important;
            box-shadow: 0 4px 14px rgba(0,0,0,0.4) !important;
        }

        .l-search .searchItem .soundTitle__title {
            grid-column: 2;
            grid-row: 2;
            display: block !important;
            margin: 2px 0 !important;
            white-space: nowrap !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
        }

        .l-search .searchItem .soundTitle__title,
        .l-search .searchItem .soundTitle__title span {
            font-size: 16px !important;
            font-weight: 700 !important;
            line-height: 1.3 !important;
            letter-spacing: -0.01em !important;
            color: #ffffff !important;
        }

        .l-search .searchItem .soundTitle__username {
            grid-column: 2;
            grid-row: 3;
            align-self: start;
            min-width: 0 !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
        }

        .l-search .searchItem .soundTitle__username,
        .l-search .searchItem .soundTitle__username * {
            font-size: 13px !important;
            font-weight: 400 !important;
            color: #b3b3b3 !important;
        }

        .l-search .searchItem .soundTitle__uploadTime,
        .l-search .searchItem .soundTitle__tagContainer,
        .l-search .searchItem .sound__soundStats,
        .l-search .searchItem .sound__trackList,
        .l-search .searchItem .soundActions,
        .l-search .searchItem .sound__footer > *:not(.sound__soundActions):not(.sound__footerRight) {
            display: none !important;
        }

        .l-search .searchItem .soundTitle__playButton {
            grid-column: 3;
            grid-row: 1 / 4;
            align-self: center;
            justify-self: end;
            opacity: 0;
            transition: opacity 0.2s ease;
        }

        .l-search .searchItem .sound:hover .soundTitle__playButton,
        .l-search .searchItem .sound.playing .soundTitle__playButton {
            opacity: 1;
        }

        .l-search .searchItem .soundTitle__playButton .sc-button-play,
        .l-search .searchItem .soundTitle__playButton a {
            width: 44px !important;
            height: 44px !important;
            min-width: 44px !important;
        }

        .l-search .searchItem .soundTitle__playButton svg {
            width: 20px !important;
            height: 20px !important;
        }

        /* people */
        .l-search .searchItem .userItem {
            display: grid !important;
            grid-template-columns: 72px minmax(0, 1fr) auto !important;
            column-gap: 14px !important;
            align-items: center !important;
        }

        .l-search .userItem__coverArt,
        .l-search .userItem__coverArt .image,
        .l-search .userItem__coverArt span.sc-artwork {
            width: 72px !important;
            height: 72px !important;
            margin: 0 !important;
            border-radius: 50% !important;
        }

        .l-search .userItem .sc-media-content {
            min-width: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
        }

        .l-search .userItem .sc-media-content::before {
            content: 'Artist';
            display: block;
            font-size: 11px;
            font-weight: 600 !important;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: var(--sc-accent);
        }

        .l-search .userItem__title,
        .l-search .userItem__title a {
            margin: 2px 0 !important;
            font-size: 16px !important;
            font-weight: 700 !important;
            color: #ffffff !important;
        }

        .l-search .userItem__details {
            display: none !important;
        }

        .l-search .userItem__stats,
        .l-search .userItem__stats * {
            margin: 0 !important;
            font-size: 13px !important;
            color: #b3b3b3 !important;
        }

        .l-search .userItem__actions .sc-button {
            height: 32px !important;
            padding: 0 16px !important;
            border: 1px solid rgba(255, 255, 255, 0.45) !important;
            border-radius: 16px !important;
            background: transparent !important;
            color: #ffffff !important;
            font-size: 13px !important;
        }

        .l-search .userItem__actions .sc-button > div {
            display: none !important;
        }

        .l-search .userItem__actions .sc-button .sc-button-label {
            font-weight: 700 !important;
            color: #ffffff !important;
        }

        /* 20. Fullscreen lyrics. Options are data-* attributes and CSS variables on #sc-ly-full,
               written by applyLyfSettings() from the settings panel. */
        .sc-ly-body {
            position: absolute;
            inset: 0;
        }

        .sc-ly-fs-btn {
            position: absolute;
            right: 12px;
            bottom: 12px;
            width: 36px;
            height: 36px;
            padding: 0;
            border: none;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.08);
            color: #ffffff;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            z-index: 2;
            transition: background 0.2s ease;
        }

        .sc-ly-fs-btn:hover {
            background: rgba(255, 255, 255, 0.18);
        }

        .sc-ly-fs-btn svg {
            width: 18px;
            height: 18px;
        }

        #sc-ly-full {
            --lyf-brightness: 0.45;
            --lyf-art: 1;
            --lyf-lyric: 1;
            --lyf-text: 1;
            --lyf-spin: 60s;
            /* drawn at (viewport x zoom) and scaled back by 1/zoom, so nothing in here changes with page zoom.
               --lyf-vh / --lyf-vw are the zoom-independent replacements for vh / vw used throughout. */
            --lyf-zoom: 1;
            --lyf-vh: calc(1vh * var(--lyf-zoom));
            --lyf-vw: calc(1vw * var(--lyf-zoom));
            position: fixed;
            top: 0;
            left: 0;
            width: calc(100vw * var(--lyf-zoom));
            height: calc(100vh * var(--lyf-zoom));
            transform: scale(calc(1 / var(--lyf-zoom)));
            transform-origin: 0 0;
            z-index: 999990; /* under the lifted player bar, over everything else */
            display: none;
            background: #050505;
            overflow: hidden;
        }

        #sc-ly-full.sc-open {
            display: block;
        }

        /* keep the player bar usable on top of the fullscreen view: it lives inside #app, so lift #app
           above the overlay and hide everything in it except the bar */
        body.sc-lyf-open #app {
            z-index: 999995 !important;
            pointer-events: none !important;
            overflow: visible !important;
        }

        body.sc-lyf-open #app > *:not(.playControls) {
            opacity: 0 !important; /* not display:none, so the page keeps its scroll position */
        }

        /* player bar: always / on hover / off */
        body.sc-lyf-open[data-lyf-bar="off"] #app div.playControls {
            display: none !important;
        }

        /* background: a square big enough to still cover the screen while it rotates */
        .sc-lyf-bg {
            position: absolute;
            left: 50%;
            top: 50%;
            width: max(calc(var(--lyf-vw) * 170), calc(var(--lyf-vh) * 170));
            height: max(calc(var(--lyf-vw) * 170), calc(var(--lyf-vh) * 170));
            margin: calc(max(calc(var(--lyf-vw) * 170), calc(var(--lyf-vh) * 170)) / -2) 0 0 calc(max(calc(var(--lyf-vw) * 170), calc(var(--lyf-vh) * 170)) / -2);
            background-size: cover;
            background-position: center;
            filter: blur(70px) saturate(1.3) brightness(var(--lyf-brightness));
            transition: background-image 0.6s ease;
        }

        @keyframes sc-lyf-spin {
            to { transform: rotate(360deg); }
        }

        #sc-ly-full[data-rotate="on"] .sc-lyf-bg {
            animation: sc-lyf-spin var(--lyf-spin) linear infinite;
            animation-play-state: paused;
        }

        #sc-ly-full[data-rotate="on"].sc-playing .sc-lyf-bg {
            animation-play-state: running;
        }

        .sc-lyf-stage {
            position: absolute;
            inset: 0 0 120px 0;
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
            align-items: center;
            gap: calc(var(--lyf-vw) * 6);
            padding: calc(var(--lyf-vh) * 8) calc(var(--lyf-vw) * 8) 0 calc(var(--lyf-vw) * 8);
            box-sizing: border-box;
        }

        body[data-lyf-bar="off"] .sc-lyf-stage,
        body[data-lyf-bar="hover"] .sc-lyf-stage {
            inset: 0;
            padding-bottom: calc(var(--lyf-vh) * 8);
        }

        .sc-lyf-art {
            justify-self: end;
            width: calc(min(calc(var(--lyf-vh) * 46), 520px) * var(--lyf-art));
            max-width: 100%;
        }

        .sc-lyf-cover {
            position: relative;
        }

        .sc-lyf-cover img {
            display: block;
            width: 100%;
            aspect-ratio: 1 / 1;
            border-radius: 14px;
            object-fit: cover;
            box-shadow: 0 30px 80px rgba(0,0,0,0.6);
        }

        .sc-lyf-title {
            margin-top: 22px;
            font-size: calc(28px * var(--lyf-text));
            font-weight: 800 !important;
            line-height: 1.15;
            letter-spacing: -0.02em;
            color: #ffffff;
            overflow-wrap: anywhere;
        }

        .sc-lyf-artist {
            margin-top: 4px;
            font-size: calc(16px * var(--lyf-text));
            color: rgba(255, 255, 255, 0.7);
        }

        #sc-ly-full[data-show-title="off"] .sc-lyf-title,
        #sc-ly-full[data-show-artist="off"] .sc-lyf-artist {
            display: none;
        }

        #sc-ly-full[data-show-title="off"] .sc-lyf-artist {
            margin-top: 22px;
        }

        #sc-ly-full[data-text-align="left"] .sc-lyf-title,
        #sc-ly-full[data-text-align="left"] .sc-lyf-artist { text-align: left; }
        #sc-ly-full[data-text-align="center"] .sc-lyf-title,
        #sc-ly-full[data-text-align="center"] .sc-lyf-artist { text-align: center; }
        #sc-ly-full[data-text-align="right"] .sc-lyf-title,
        #sc-ly-full[data-text-align="right"] .sc-lyf-artist { text-align: right; }

        .sc-lyf-lyrics {
            position: relative;
            height: 100%;
            min-height: 0;
        }

        .sc-lyf-lyrics .sc-ly-scroll {
            padding: calc(var(--lyf-vh) * 36) 0 calc(var(--lyf-vh) * 40) 0;
        }

        .sc-lyf-lyrics .sc-ly-line {
            font-size: calc(clamp(26px, calc(var(--lyf-vw) * 2.6), 44px) * var(--lyf-lyric));
            margin-bottom: 20px;
        }

        .sc-lyf-lyrics.sc-ly-plain .sc-ly-scroll {
            padding: calc(var(--lyf-vh) * 8) 0 calc(var(--lyf-vh) * 20) 0;
        }

        .sc-lyf-lyrics.sc-ly-plain .sc-ly-line {
            font-size: calc(22px * var(--lyf-lyric));
            color: rgba(255, 255, 255, 0.85);
            cursor: default;
        }

        /* lyrics position */
        #sc-ly-full[data-layout="left"] .sc-lyf-art { order: 2; justify-self: start; }
        #sc-ly-full[data-layout="left"] .sc-lyf-lyrics { order: 1; }

        #sc-ly-full[data-layout="below"] .sc-lyf-stage {
            grid-template-columns: minmax(0, 1fr);
            grid-template-rows: auto minmax(0, 1fr);
            justify-items: center;
            gap: calc(var(--lyf-vh) * 3);
            padding-top: calc(var(--lyf-vh) * 6);
        }

        #sc-ly-full[data-layout="below"] .sc-lyf-art {
            justify-self: center;
            width: calc(min(calc(var(--lyf-vh) * 30), 340px) * var(--lyf-art));
        }

        #sc-ly-full[data-layout="below"] .sc-lyf-lyrics {
            width: min(900px, 100%);
            text-align: center;
        }

        #sc-ly-full[data-layout="below"] .sc-lyf-lyrics .sc-ly-scroll {
            padding-top: calc(var(--lyf-vh) * 12);
        }

        /* one half hidden (by choice, or because no lyrics were found): the other is centred */
        #sc-ly-full[data-art="off"] .sc-lyf-art,
        #sc-ly-full[data-lyrics="off"] .sc-lyf-lyrics,
        #sc-ly-full[data-nolyrics="on"] .sc-lyf-lyrics {
            display: none;
        }

        #sc-ly-full[data-art="off"] .sc-lyf-stage,
        #sc-ly-full[data-lyrics="off"] .sc-lyf-stage,
        #sc-ly-full[data-nolyrics="on"] .sc-lyf-stage {
            grid-template-columns: minmax(0, 1fr);
            grid-template-rows: minmax(0, 1fr);
            justify-items: center;
        }

        #sc-ly-full[data-art="off"] .sc-lyf-lyrics {
            width: min(1000px, 100%);
        }

        #sc-ly-full[data-lyrics="off"] .sc-lyf-art,
        #sc-ly-full[data-nolyrics="on"] .sc-lyf-art {
            justify-self: center;
            width: calc(min(calc(var(--lyf-vh) * 56), 640px) * var(--lyf-art));
        }

        /* volume bar (vertical). Placed next to the cover or at a screen edge by placeLyfVolume() */
        .sc-lyf-vol {
            position: absolute;
            top: 50%;
            width: 36px;
            height: min(260px, calc(var(--lyf-vh) * 40));
            transform: translateY(-50%);
            display: flex;
            justify-content: center;
            cursor: pointer;
            touch-action: none;
            z-index: 2;
            transition: opacity 0.25s ease;
        }

        .sc-lyf-vol[data-pos="cover-left"]   { left: -52px; }
        .sc-lyf-vol[data-pos="cover-right"]  { right: -52px; }
        .sc-lyf-vol[data-pos="screen-left"]  { left: 28px; }
        .sc-lyf-vol[data-pos="screen-right"] { right: 28px; }

        .sc-lyf-vol-track {
            position: relative;
            width: 5px;
            height: 100%;
            border-radius: 3px;
            background: rgba(255, 255, 255, 0.2);
        }

        .sc-lyf-vol-fill {
            position: absolute;
            left: 0;
            bottom: 0;
            width: 100%;
            border-radius: 3px;
            background: var(--sc-accent);
        }

        .sc-lyf-vol-knob {
            position: absolute;
            left: 50%;
            width: 14px;
            height: 14px;
            border-radius: 50%;
            background: #ffffff;
            transform: translate(-50%, 50%);
            box-shadow: 0 2px 6px rgba(0,0,0,0.5);
        }

        #sc-ly-full[data-vol="off"] .sc-lyf-vol {
            display: none;
        }

        #sc-ly-full[data-vol="hover"] .sc-lyf-vol {
            opacity: 0;
        }

        #sc-ly-full[data-vol="hover"] .sc-lyf-vol:hover,
        #sc-ly-full[data-vol="hover"] .sc-lyf-vol.sc-dragging {
            opacity: 1;
        }

        .sc-lyf-top {
            position: absolute;
            top: 20px;
            right: 24px;
            display: flex;
            gap: 10px;
            z-index: 4;
        }

        .sc-lyf-top button {
            width: 40px;
            height: 40px;
            padding: 0;
            border: none;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.1);
            color: #ffffff;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: background 0.2s ease;
        }

        .sc-lyf-top button:hover {
            background: rgba(255, 255, 255, 0.2);
        }

        .sc-lyf-top svg {
            width: 20px;
            height: 20px;
        }

        .sc-lyf-settings {
            position: absolute;
            top: 72px;
            right: 24px;
            width: 360px;
            max-height: calc(calc(var(--lyf-vh) * 100) - 200px);
            padding: 18px;
            box-sizing: border-box;
            overflow-y: auto;
            scrollbar-width: thin;
            scrollbar-color: rgba(255, 255, 255, 0.25) transparent;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 16px;
            background: rgba(18, 18, 18, 0.92);
            backdrop-filter: blur(30px);
            -webkit-backdrop-filter: blur(30px);
            box-shadow: 0 16px 40px rgba(0,0,0,0.6);
            display: none;
            z-index: 4;
        }

        .sc-lyf-settings.sc-open {
            display: block;
        }

        .sc-lyf-settings h3 {
            margin: 18px 0 12px 0;
            padding-top: 14px;
            border-top: 1px solid rgba(255, 255, 255, 0.08);
            font-size: 11px;
            font-weight: 700 !important;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: rgba(255, 255, 255, 0.55);
        }

        .sc-lyf-settings h3:first-child {
            margin-top: 0;
            padding-top: 0;
            border-top: none;
        }

        .sc-lyf-set {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 12px;
            font-size: 13px;
            color: #e6e6e6;
        }

        .sc-lyf-set.sc-stack {
            flex-direction: column;
            align-items: stretch;
            gap: 6px;
        }

        .sc-lyf-switch {
            position: relative;
            width: 38px;
            height: 22px;
            padding: 0;
            border: none;
            border-radius: 11px;
            background: rgba(255, 255, 255, 0.2);
            cursor: pointer;
            transition: background 0.2s ease;
            flex: 0 0 auto;
        }

        .sc-lyf-switch::after {
            content: '';
            position: absolute;
            top: 3px;
            left: 3px;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: #ffffff;
            transition: transform 0.2s ease;
        }

        .sc-lyf-switch.sc-on {
            background: var(--sc-accent);
        }

        .sc-lyf-switch.sc-on::after {
            transform: translateX(16px);
        }

        .sc-lyf-seg {
            display: flex;
            gap: 4px;
            padding: 3px;
            border-radius: 10px;
            background: rgba(255, 255, 255, 0.08);
        }

        .sc-lyf-seg button {
            flex: 1 1 auto;
            padding: 5px 9px;
            border: none;
            border-radius: 8px;
            background: transparent;
            color: #e6e6e6;
            font-size: 12px;
            white-space: nowrap;
            cursor: pointer;
        }

        .sc-lyf-seg button.sc-on {
            background: var(--sc-accent);
            color: #ffffff;
        }

        /* drawn by hand: SoundCloud's global input styles break the browser's default range look */
        .sc-lyf-set input[type="range"] {
            -webkit-appearance: none !important;
            appearance: none !important;
            width: 150px !important;
            height: 4px !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            border-radius: 2px !important;
            background: rgba(255, 255, 255, 0.2) !important;
            box-shadow: none !important;
            outline: none !important;
            cursor: pointer;
        }

        .sc-lyf-set input[type="range"]::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 14px;
            height: 14px;
            border: none;
            border-radius: 50%;
            background: #ffffff;
            box-shadow: 0 2px 6px rgba(0,0,0,0.5);
            cursor: pointer;
        }

        .sc-lyf-reset {
            width: 100%;
            margin-top: 6px;
            padding: 8px 0;
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 10px;
            background: transparent;
            color: #e6e6e6;
            font-size: 12px;
            cursor: pointer;
        }

        .sc-lyf-reset:hover {
            background: rgba(255, 255, 255, 0.08);
        }

        .sc-lyf-offset {
            display: flex;
            align-items: center;
            gap: 6px;
            flex: 0 0 auto;
        }

        .sc-lyf-offset-label {
            min-width: 0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .sc-lyf-offset button {
            width: 28px;
            height: 28px;
            padding: 0;
            border: none;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.1);
            color: #ffffff;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
        }

        .sc-lyf-offset button:hover {
            background: var(--sc-accent);
        }

        .sc-lyf-offset button svg {
            width: 14px;
            height: 14px;
        }

        .sc-lyf-offset input {
            width: 58px !important;
            height: 28px !important;
            margin: 0 !important;
            padding: 0 4px !important;
            border: 1px solid rgba(255, 255, 255, 0.15) !important;
            border-radius: 8px !important;
            background: rgba(255, 255, 255, 0.06) !important;
            color: #ffffff !important;
            font-size: 13px !important;
            text-align: center !important;
            box-shadow: none !important;
            outline: none !important;
            -moz-appearance: textfield;
        }

        .sc-lyf-offset input::-webkit-outer-spin-button,
        .sc-lyf-offset input::-webkit-inner-spin-button {
            -webkit-appearance: none;
            margin: 0;
        }

        .sc-lyf-offset-row.sc-disabled {
            opacity: 0.4;
            pointer-events: none;
        }

        .sc-lyf-hint {
            margin: 0 0 12px 0;
            font-size: 11px;
            line-height: 1.5;
            color: rgba(255, 255, 255, 0.45);
        }

        /* search cards: flatten SoundCloud's wrappers so cover / title / artist / play are grid items */
        .l-search .searchItem .sound__content,
        .l-search .searchItem .sound__header,
        .l-search .searchItem .soundTitle,
        .l-search .searchItem .soundTitle__titleContainer,
        .l-search .searchItem .soundTitle__usernameTitleContainer,
        .l-search .searchItem .soundTitle__secondary {
            display: contents !important;
        }

        .l-search .searchItem .sound__waveform,
        .l-search .searchItem .sound__footer,
        .l-search .searchItem .commentForm,
        .l-search .searchItem .soundTitle__additionalContainer,
        .l-search .searchItem .releaseDateCompact,
        .l-search .searchItem .soundContext {
            display: none !important;
        }

        .l-search .searchItem .sound__coverArt,
        .l-search .searchItem .sound__coverArt .image,
        .l-search .searchItem .sound__coverArt span.sc-artwork {
            display: block !important;
            width: 100% !important;
            height: 100% !important;
            border-radius: 8px !important;
        }

        .l-search .searchItem .soundTitle__playButton {
            position: static !important;
            float: none !important;
            width: 44px !important;
            height: 44px !important;
            margin: 0 !important;
            padding: 0 !important;
        }

        .l-search .searchItem .soundTitle__playButton .sc-button-play {
            display: block !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            border-radius: 50% !important;
            background: var(--sc-accent) !important;
            color: #ffffff !important;
        }

        /* 21. Library header geometry.
               The toggle icon sits in the same 56px box whether the panel is open or closed, and the header
               block is 116px tall in both states (closed: toggle + create stacked; open: header row + chips),
               so neither the icon nor the list below shifts when the panel opens or closes. */
        .sc-lib-head {
            align-items: flex-start;
            gap: 4px;
            padding: 0 8px;
            box-sizing: border-box;
        }

        .sc-lib-toggle {
            justify-content: flex-start;
            gap: 0;
            width: 56px;
            height: 56px;
            padding: 0;
        }

        .sc-lib-toggle svg {
            flex: 0 0 26px;
            margin: 0 15px;
        }

        #lc-left-bar.expanded .sc-lib-head {
            flex-direction: row;
            align-items: center;
            justify-content: space-between;
            gap: 0;
            height: 56px;
            padding: 0 12px 0 8px;
        }

        #lc-left-bar.expanded .sc-lib-toggle {
            width: auto;
            height: 56px;
            padding: 0 10px 0 0;
        }

        .sc-lib-chips {
            height: 56px;
            box-sizing: border-box;
            align-items: center;
            padding: 0 16px;
        }

        /* 22. Small fixes */

        /* rows: SoundCloud pins them at 48px, so 34px of content + padding overflowed the bottom and the
           content sat low. Let the row be as tall as its padding + content. */
        .trackItem,
        .sc-tp-row {
            height: auto !important;
            min-height: 0 !important;
        }

        .trackList__item,
        .compactTrackList__item {
            height: auto !important;
        }

        /* tile / card grids: the lists' clearfix pseudo-elements became an empty first grid cell */
        body.sc-tiles .userMain__content ul.soundList::before,
        body.sc-tiles .userMain__content ul.soundList::after,
        body.sc-tiles .userMain__content .soundList > ul::before,
        body.sc-tiles .userMain__content .soundList > ul::after,
        .l-search .searchList .lazyLoadingList__list::before,
        .l-search .searchList .lazyLoadingList__list::after {
            display: none !important;
        }

        /* avatar shadow was cut into a square by the header's overflow:hidden */
        body.sc-artist .profileHeader,
        body.sc-artist .profileHeader__info,
        body.sc-artist .profileHeaderInfo {
            overflow: visible !important;
        }

        /* "Your Library" hover highlight: same space after the text as before the icon */
        #lc-left-bar.expanded .sc-lib-toggle {
            padding: 0 15px 0 0;
        }

        /* 23. Top bar: logo + profile on the left, icon buttons on the right */
        .sc-top-left {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .sc-top-logo,
        .sc-top-logo:visited {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            color: var(--sc-accent);
            transition: background 0.2s ease;
        }

        .sc-top-logo:hover {
            background: rgba(255, 255, 255, 0.08);
        }

        .sc-top-logo svg {
            width: 30px;
            height: 30px;
        }

        .sc-top-nav-right {
            gap: 6px !important;
            margin-right: 0 !important;
        }

        .sc-top-icon,
        .sc-top-icon:visited {
            width: 38px;
            height: 38px;
            padding: 0;
            border: none;
            border-radius: 50%;
            background: transparent;
            color: #b3b3b3 !important;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: background 0.2s ease, color 0.2s ease;
        }

        .sc-top-icon:hover {
            background: rgba(255, 255, 255, 0.1);
            color: #ffffff !important;
        }

        .sc-top-icon svg {
            width: 20px;
            height: 20px;
        }

        /* 41. In the LiquidCloud app the top bar is the window's title bar (Windows' own is gone): slimmer,
               its empty parts drag the window (double-click maximises, snap layouts work), and it ends in
               minimise / maximise / close. The app marks <html> with sc-app (and sc-maximized). */
        html.sc-app {
            --sc-bar-h: 46px;
        }

        html.sc-app #lc-top-bar {
            padding: 0 0 0 12px !important;
            app-region: drag;
            box-shadow: none !important;
        }

        /* the icons stay on the right, next to the window buttons (the search box is centred on its own) */
        html.sc-app .sc-top-nav-right {
            margin-left: auto !important;
        }

        html.sc-app #lc-top-bar a,
        html.sc-app #lc-top-bar button,
        html.sc-app #lc-top-bar input,
        html.sc-app .sc-top-search-wrap {
            app-region: no-drag;
        }

        html.sc-app .sc-top-logo,
        html.sc-app .sc-top-logo:visited {
            width: 34px;
            height: 34px;
        }

        html.sc-app .sc-top-logo svg {
            width: 26px;
            height: 26px;
        }

        html.sc-app .sc-top-profile-btn {
            padding: 3px 10px 3px 3px !important;
        }

        html.sc-app .sc-top-profile-btn img {
            width: 26px !important;
            height: 26px !important;
        }

        html.sc-app .sc-top-profile-name {
            font-size: 13px !important;
        }

        /* centred on the window, whatever the width of the groups either side (the window buttons make
           the right one much wider than the left) */
        html.sc-app .sc-top-search-wrap {
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            padding: 5px 14px;
            width: 360px;
            box-sizing: border-box;
        }

        html.sc-app .sc-top-search-wrap svg {
            width: 15px;
            height: 15px;
        }

        html.sc-app .sc-top-search-wrap input {
            font-size: 13px;
        }

        html.sc-app .sc-top-icon,
        html.sc-app .sc-top-icon:visited {
            width: 34px;
            height: 34px;
        }

        html.sc-app .sc-top-icon svg {
            width: 18px;
            height: 18px;
        }

        .sc-win-controls {
            display: flex;
            align-self: stretch;
            margin-left: 10px;
        }

        /* like Spotify's: white, crisp 1px lines */
        .sc-win-btn {
            width: 48px;
            border: none;
            background: transparent;
            color: rgba(255, 255, 255, 0.92);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: default;
            transition: background 0.15s ease, color 0.15s ease;
        }

        .sc-win-btn:hover {
            background: rgba(255, 255, 255, 0.12);
            color: #ffffff;
        }

        .sc-win-btn.sc-win-close:hover {
            background: #e81123;
            color: #ffffff;
        }

        .sc-win-btn svg {
            width: 11px;
            height: 11px;
            shape-rendering: crispEdges;
        }

        .sc-win-btn span {
            display: flex;
        }

        .sc-win-close svg {
            shape-rendering: geometricPrecision; /* the X's diagonals stay smooth */
        }

        /* maximise turns into restore (two squares) while the window is maximised */
        .sc-win-btn .sc-win-restore,
        html.sc-maximized .sc-win-btn .sc-win-maximize {
            display: none;
        }

        html.sc-maximized .sc-win-btn .sc-win-restore {
            display: block;
        }

        /* 23b. Notifications: the bell's count and its panel (same look as the settings panel) */
        .sc-note-bell {
            position: relative;
        }

        .sc-note-badge {
            display: none;
            position: absolute;
            top: 3px;
            right: 2px;
            min-width: 16px;
            height: 16px;
            padding: 0 4px;
            box-sizing: border-box;
            border-radius: 8px;
            background: var(--sc-accent, #1ed760);
            color: #ffffff;
            font-size: 10px;
            font-weight: 700;
            line-height: 16px;
            text-align: center;
            box-shadow: 0 0 0 2px rgba(12, 12, 12, 0.9);
        }

        .sc-note-badge.sc-on {
            display: block;
        }

        #sc-notes {
            position: fixed;
            top: calc(var(--sc-bar-h) + 8px);
            right: 24px;
            width: 400px;
            max-height: calc(100vh - 200px);
            padding: 18px 18px 12px;
            box-sizing: border-box;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 16px;
            background: rgba(18, 18, 18, 0.92);
            backdrop-filter: blur(30px);
            -webkit-backdrop-filter: blur(30px);
            box-shadow: 0 16px 40px rgba(0,0,0,0.6);
            display: none;
            flex-direction: column;
            z-index: 999997;
        }

        #sc-notes.sc-open {
            display: flex;
        }

        .sc-note-filters {
            display: flex;
            gap: 4px;
            margin-bottom: 10px;
            padding: 3px;
            border-radius: 10px;
            background: rgba(255, 255, 255, 0.08);
        }

        .sc-note-filters button {
            flex: 1 1 auto;
            padding: 6px 4px;
            border: none;
            border-radius: 8px;
            background: transparent;
            color: #e6e6e6;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
        }

        .sc-note-filters button.sc-on {
            background: rgba(255, 255, 255, 0.16);
            color: #ffffff;
        }

        .sc-note-list {
            flex: 1 1 auto;
            min-height: 80px;
            overflow-y: auto;
            margin: 0 -8px;
            scrollbar-width: thin;
            scrollbar-color: rgba(255, 255, 255, 0.25) transparent;
        }

        .sc-note {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            padding: 8px;
            border-radius: 10px;
        }

        .sc-note:hover {
            background: rgba(255, 255, 255, 0.06);
        }

        .sc-note.sc-new {
            background: rgba(255, 255, 255, 0.05);
            box-shadow: inset 3px 0 0 var(--sc-accent, #1ed760);
        }

        .sc-note-avatar {
            flex: none;
            width: 36px;
            height: 36px;
            border-radius: 50%;
            object-fit: cover;
            background: rgba(255, 255, 255, 0.08);
        }

        .sc-note-art {
            flex: none;
            width: 40px;
            height: 40px;
            border-radius: 6px;
            object-fit: cover;
            background: rgba(255, 255, 255, 0.08);
        }

        .sc-note-body {
            flex: 1 1 auto;
            min-width: 0;
            font-size: 13px;
            line-height: 1.35;
            color: #b3b3b3;
        }

        .sc-note-line a {
            color: #ffffff !important;
            font-weight: 600;
            text-decoration: none;
        }

        .sc-note-line a:hover {
            text-decoration: underline;
        }

        .sc-note-quote {
            margin-top: 4px;
            padding: 6px 8px;
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.06);
            color: #e6e6e6;
            overflow-wrap: anywhere;
        }

        .sc-note-time {
            margin-top: 3px;
            font-size: 11px;
            color: rgba(255, 255, 255, 0.45);
        }

        .sc-note-empty {
            padding: 24px 8px;
            text-align: center;
            font-size: 13px;
            color: rgba(255, 255, 255, 0.55);
        }

        .sc-note-all {
            margin-top: 10px;
            text-align: center;
            font-size: 12px;
            font-weight: 600;
            color: #b3b3b3 !important;
            text-decoration: none;
        }

        .sc-note-all:hover {
            color: #ffffff !important;
        }

        /* 24. Settings panel (opened from the top bar or the fullscreen view), organised in tabs */
        #sc-settings {
            position: fixed;
            top: calc(var(--sc-bar-h) + 8px);
            right: 24px;
            max-height: calc(100vh - 200px);
            z-index: 999997;
        }

        .sc-set-caption {
            margin-bottom: 12px;
            font-size: 16px;
            font-weight: 700 !important;
            color: #ffffff;
        }

        .sc-set-tabs {
            display: flex;
            gap: 4px;
            margin-bottom: 16px;
            padding: 3px;
            border-radius: 10px;
            background: rgba(255, 255, 255, 0.08);
        }

        .sc-set-tabs button {
            flex: 1 1 auto;
            padding: 6px 4px;
            border: none;
            border-radius: 8px;
            background: transparent;
            color: #e6e6e6;
            font-size: 12px;
            white-space: nowrap;
            cursor: pointer;
        }

        .sc-set-tabs button:hover {
            background: rgba(255, 255, 255, 0.08);
        }

        .sc-set-tabs button.sc-on {
            background: var(--sc-accent);
            color: #ffffff;
        }

        .sc-set-pane {
            display: none;
            min-height: 250px;
        }

        .sc-set-pane.sc-on {
            display: block;
        }

        /* 25. Dialogs (import notice, create playlist) */
        .sc-dialog-backdrop {
            position: fixed;
            inset: 0;
            z-index: 1000001;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(0, 0, 0, 0.6);
            backdrop-filter: blur(6px);
            -webkit-backdrop-filter: blur(6px);
        }

        .sc-dialog {
            width: min(440px, 92vw);
            padding: 24px;
            box-sizing: border-box;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 16px;
            background: rgba(24, 24, 24, 0.98);
            box-shadow: 0 24px 60px rgba(0,0,0,0.7);
        }

        .sc-dialog h2 {
            margin: 0 0 10px 0;
            font-size: 22px;
            font-weight: 800 !important;
            letter-spacing: -0.02em;
            color: #ffffff;
        }

        .sc-dialog p {
            margin: 0 0 16px 0;
            font-size: 14px;
            line-height: 1.5;
            color: #b3b3b3;
        }

        .sc-dialog-input {
            width: 100% !important;
            height: 42px !important;
            margin: 0 0 12px 0 !important;
            padding: 0 14px !important;
            box-sizing: border-box !important;
            border: 1px solid rgba(255, 255, 255, 0.15) !important;
            border-radius: 10px !important;
            background: rgba(255, 255, 255, 0.06) !important;
            color: #ffffff !important;
            font-size: 14px !important;
            outline: none !important;
            box-shadow: none !important;
        }

        .sc-dialog-input:focus {
            border-color: var(--sc-accent) !important;
        }

        .sc-dialog-check {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
            font-size: 13px;
            color: #e6e6e6;
            cursor: pointer;
        }

        .sc-dialog-check input {
            accent-color: var(--sc-accent);
        }

        .sc-dialog-error {
            min-height: 18px;
            font-size: 12px;
            color: #ff7a7a;
        }

        .sc-dialog-actions {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            margin-top: 10px;
        }

        .sc-dialog-actions button {
            height: 38px;
            padding: 0 18px;
            border: none;
            border-radius: 19px;
            font-size: 13px;
            font-weight: 700 !important;
            cursor: pointer;
        }

        .sc-dialog-cancel {
            background: transparent;
            color: #ffffff;
        }

        .sc-dialog-cancel:hover {
            background: rgba(255, 255, 255, 0.08);
        }

        .sc-dialog-ok {
            background: var(--sc-accent);
            color: #ffffff;
        }

        .sc-dialog-ok:disabled {
            opacity: 0.6;
            cursor: default;
        }

        /* 26. Page transitions (see the "Page transitions" block in the script).
               #sc-page-ghost is a frozen copy of the page you are leaving; it stays up until the next page
               has loaded, slides out, and then the real panel slides in. */
        #sc-page-ghost {
            position: absolute;
            left: 0;
            width: 100%;
            overflow: hidden;
            border-radius: 16px;
            pointer-events: none;
            z-index: 3;
            transition: transform 0.18s cubic-bezier(0.4, 0, 1, 1), opacity 0.18s ease;
        }

        #sc-page-ghost.sc-leave {
            transform: translateX(-56px);
            opacity: 0;
        }

        #app > .l-container.l-content {
            transition: transform 0.38s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease;
        }

        /* waiting behind the ghost: parked to the right, invisible, no transition while it is put there */
        #app.sc-page-pending > .l-container.l-content {
            transform: translateX(56px);
            opacity: 0;
            transition: none;
        }

        /* 27. Fullscreen lyrics: content arrives blurred and sharpens quickly */
        @keyframes sc-lyf-arrive {
            from { filter: blur(18px); opacity: 0; transform: scale(0.985); }
            to   { filter: blur(0); opacity: 1; transform: none; }
        }

        #sc-ly-full.sc-open .sc-lyf-art,
        #sc-ly-full.sc-open .sc-lyf-lyrics {
            animation: sc-lyf-arrive 0.42s cubic-bezier(0.16, 1, 0.3, 1) both;
        }

        #sc-ly-full.sc-open .sc-lyf-lyrics {
            animation-delay: 0.06s;
        }

        /* background blur is a slider now */
        .sc-lyf-bg {
            filter: blur(calc(var(--lyf-blur, 70) * 1px)) saturate(1.3) brightness(var(--lyf-brightness)) !important;
        }

        /* cover anchor point: where the cover + title block sits in its half of the screen, and therefore
           which corner or edge it grows from when the cover size changes */
        #sc-ly-full[data-anchor^="t"] .sc-lyf-art { align-self: start !important; }
        #sc-ly-full[data-anchor^="m"] .sc-lyf-art { align-self: center !important; }
        #sc-ly-full[data-anchor^="b"] .sc-lyf-art { align-self: end !important; }
        #sc-ly-full[data-anchor$="l"] .sc-lyf-art { justify-self: start !important; }
        #sc-ly-full[data-anchor$="c"] .sc-lyf-art { justify-self: center !important; }
        #sc-ly-full[data-anchor$="r"] .sc-lyf-art { justify-self: end !important; }

        .sc-lyf-anchor {
            display: grid;
            grid-template-columns: repeat(3, 22px);
            gap: 3px;
            padding: 4px;
            border-radius: 8px;
            background: rgba(0, 0, 0, 0.35);
        }

        .sc-lyf-anchor button {
            position: relative;
            width: 22px;
            height: 22px;
            padding: 0;
            border: none;
            border-radius: 3px;
            background: var(--sc-accent);
            opacity: 0.55;
            cursor: pointer;
            transition: opacity 0.15s ease, transform 0.15s ease;
        }

        .sc-lyf-anchor button:hover {
            opacity: 0.85;
        }

        .sc-lyf-anchor button.sc-on {
            opacity: 1;
        }

        /* the chosen cell gets the inner square, like the centre cell in Motion Tools */
        .sc-lyf-anchor button.sc-on::after {
            content: '';
            position: absolute;
            inset: 6px;
            border: 2px solid rgba(255, 255, 255, 0.9);
            border-radius: 1px;
        }

        /* 28. Player bar "On hover": everywhere, not just in fullscreen. It rests as a small capsule
               (think Dynamic Island) and springs open when the pointer reaches it. */
        body[data-lyf-bar="hover"] section.playControls__inner {
            transform-origin: 50% 100% !important;
            transform: translateX(-50%) translateY(18px) scale(0.26, 0.16) !important;
            border-radius: 60px !important;
            opacity: 0.85;
            transition: transform 0.55s cubic-bezier(0.3, 1.35, 0.45, 1), border-radius 0.4s ease, opacity 0.3s ease !important;
        }

        body[data-lyf-bar="hover"] section.playControls__inner .playControls__wrapper {
            opacity: 0;
            transition: opacity 0.18s ease;
        }

        body.sc-bar-open[data-lyf-bar="hover"] section.playControls__inner,
        body[data-lyf-bar="hover"] div.playControls:hover section.playControls__inner,
        body[data-lyf-bar="hover"] div.playControls:focus-within section.playControls__inner,
        body[data-lyf-bar="hover"] div.playControls.m-queueVisible section.playControls__inner {
            transform: translateX(-50%) !important;
            border-radius: 42px !important;
            opacity: 1;
        }

        body.sc-bar-open[data-lyf-bar="hover"] .playControls__wrapper,
        body[data-lyf-bar="hover"] div.playControls:hover .playControls__wrapper,
        body[data-lyf-bar="hover"] div.playControls:focus-within .playControls__wrapper,
        body[data-lyf-bar="hover"] div.playControls.m-queueVisible .playControls__wrapper {
            opacity: 1;
            transition: opacity 0.3s ease 0.12s;
        }

        /* 29. Profile tabs: only the list under the header transitions */
        #sc-page-ghost.sc-list {
            border-radius: 0;
        }

        #app > .l-container .userMain__content {
            transition: transform 0.38s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease;
        }

        #app.sc-list-pending > .l-container .userMain__content {
            transform: translateX(56px);
            opacity: 0;
            transition: none;
        }

        /* 30. Drag tracks into a new order (your own playlists) */
        #sc-reorder-bar {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 8px;
            min-height: 34px;
            margin: 0 0 10px 0;
        }

        #sc-reorder-bar button {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            height: 32px;
            padding: 0 14px;
            border: none;
            border-radius: 16px;
            background: rgba(255, 255, 255, 0.08);
            color: #ffffff;
            font-size: 13px;
            cursor: pointer;
            transition: background 0.2s ease;
        }

        #sc-reorder-bar button:hover {
            background: rgba(255, 255, 255, 0.14);
        }

        #sc-reorder-bar button svg {
            width: 16px;
            height: 16px;
        }

        #sc-reorder-bar .sc-reorder-save {
            background: var(--sc-accent);
            font-weight: 700 !important;
        }

        #sc-reorder-bar .sc-reorder-save:disabled {
            opacity: 0.45;
            cursor: default;
        }

        #sc-reorder-bar .sc-reorder-hint {
            margin-right: auto;
            font-size: 13px;
            color: #b3b3b3;
        }

        /* idle: just the Reorder button. Reordering: hint + Cancel + Save */
        #sc-reorder-bar .sc-reorder-hint,
        #sc-reorder-bar .sc-reorder-cancel,
        #sc-reorder-bar .sc-reorder-save {
            display: none;
        }

        #sc-reorder-bar.sc-on .sc-reorder-hint { display: inline; }
        #sc-reorder-bar.sc-on .sc-reorder-cancel,
        #sc-reorder-bar.sc-on .sc-reorder-save { display: inline-flex; }
        #sc-reorder-bar.sc-on .sc-reorder-start { display: none; }

        body.sc-reordering .listenDetails__trackList li,
        body.sc-reordering .listenDetails__trackList li * {
            cursor: grab !important;
        }

        body.sc-reordering .listenDetails__trackList .trackItem {
            background: rgba(255, 255, 255, 0.03) !important;
        }

        .listenDetails__trackList li.sc-dragging {
            opacity: 0.35;
        }

        .listenDetails__trackList li.sc-drop-before {
            box-shadow: inset 0 3px 0 var(--sc-accent);
        }

        .listenDetails__trackList li.sc-drop-after {
            box-shadow: inset 0 -3px 0 var(--sc-accent);
        }

        .listenDetails__trackList.sc-reorder-busy {
            pointer-events: none;
            opacity: 0.7;
        }

        #sc-toast {
            position: fixed;
            left: 50%;
            bottom: 124px;
            z-index: 1000002;
            max-width: min(520px, 90vw);
            padding: 10px 18px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 20px;
            background: rgba(24, 24, 24, 0.96);
            color: #ffffff;
            font-size: 13px;
            box-shadow: 0 12px 30px rgba(0,0,0,0.6);
            transform: translate(-50%, 12px);
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.25s ease, transform 0.25s ease;
        }

        #sc-toast.sc-show {
            transform: translate(-50%, 0);
            opacity: 1;
        }

        #sc-toast.sc-error {
            border-color: rgba(255, 110, 110, 0.5);
            color: #ffb4b4;
        }

        /* 31. Appearance settings (Settings > Appearance write these variables on <html>) */
        .l-container:not(.playControls__wrapper),
        #lc-left-bar,
        #sc-lyrics {
            background: rgba(18, 18, 18, var(--sc-panel-alpha, 0.75)) !important;
            backdrop-filter: blur(calc(var(--sc-panel-blur, 30) * 1px)) !important;
            -webkit-backdrop-filter: blur(calc(var(--sc-panel-blur, 30) * 1px)) !important;
        }

        /* nested containers inside the main panel stay clear (same rule as before, restated after the override) */
        .l-container:not(.playControls__wrapper) .l-container:not(.playControls__wrapper) {
            background: transparent !important;
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
        }

        /* 32. Lyrics: words light up as they are sung; glow strength comes from the Lyrics glow slider */
        .sc-ly-line.sc-active {
            color: rgba(255, 255, 255, 0.42);
            text-shadow: none;
        }

        .sc-ly-line.sc-ly-right {
            text-align: right;
        }

        .sc-ly-line .sc-w {
            transition: color 0.2s ease, text-shadow 0.35s ease;
        }

        .sc-ly-line.sc-active .sc-w.sc-sung {
            color: #ffffff;
            text-shadow: 0 0 calc(var(--sc-ly-glow, 50) * 0.16px) rgba(255, 255, 255, calc(var(--sc-ly-glow, 50) / 220));
        }

        .sc-ly-line.sc-active .sc-w.sc-now {
            text-shadow: 0 0 calc(var(--sc-ly-glow, 50) * 0.4px) rgba(255, 255, 255, calc(var(--sc-ly-glow, 50) / 90));
        }

        /* lines with no per-word spans (a lone "♪") still light up as a whole */
        .sc-ly-line.sc-active:not(:has(.sc-w)) {
            color: #ffffff;
            text-shadow: 0 0 calc(var(--sc-ly-glow, 50) * 0.3px) rgba(255, 255, 255, calc(var(--sc-ly-glow, 50) / 120));
        }

        /* 33. Small fixes */
        /* library rows are links; no underline on hover */
        .sc-sidebar-row,
        .sc-sidebar-row:hover,
        .sc-sidebar-row *,
        .sc-sidebar-row:hover *,
        .sc-lib-create,
        .sc-lib-create:hover,
        .sc-lib-create:hover * {
            text-decoration: none !important;
        }

        /* "On hover" player bar: the pointer zone must reveal the controls too, not only the pill.
           (Needs the section in the selector to outrank the rule that hides them.) */
        body.sc-bar-open[data-lyf-bar="hover"] section.playControls__inner .playControls__wrapper {
            opacity: 1;
            transition: opacity 0.3s ease 0.12s;
        }

        /* 34. Settings panel additions */
        #sc-settings {
            width: 440px;
        }

        .sc-set-tabs {
            flex-wrap: wrap;
        }

        .sc-set-note {
            margin: -4px 0 14px 0;
            font-size: 11px;
            color: rgba(255, 255, 255, 0.45);
        }

        .sc-timing-add,
        .sc-timing-remove {
            width: 28px;
            height: 28px;
            padding: 0;
            border: none;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.1);
            color: #ffffff;
            display: flex;
            align-items: center;
            justify-content: center;
            flex: 0 0 auto;
            cursor: pointer;
        }

        .sc-timing-add:hover {
            background: var(--sc-accent);
        }

        .sc-timing-remove {
            width: 24px;
            height: 24px;
            background: transparent;
            color: rgba(255, 255, 255, 0.5);
        }

        .sc-timing-remove:hover {
            background: rgba(255, 255, 255, 0.1);
            color: #ffffff;
        }

        .sc-timing-add svg,
        .sc-timing-remove svg {
            width: 14px;
            height: 14px;
        }

        .sc-timing-songs {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin-bottom: 10px;
        }

        .sc-timing-song {
            display: grid;
            grid-template-columns: 40px minmax(0, 1fr) auto auto;
            align-items: center;
            gap: 10px;
            padding: 8px;
            border: 1px solid transparent;
            border-radius: 10px;
            background: rgba(255, 255, 255, 0.05);
        }

        .sc-timing-song.sc-current {
            border-color: var(--sc-accent);
        }

        .sc-timing-song img {
            width: 40px;
            height: 40px;
            border-radius: 6px;
            object-fit: cover;
            background: rgba(255, 255, 255, 0.08);
        }

        .sc-timing-title {
            font-size: 13px;
            color: #ffffff;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .sc-timing-artist {
            margin-top: 2px;
            font-size: 11px;
            color: #a7a7a7;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .sc-key-input {
            width: 100% !important;
            height: 32px !important;
            margin: 0 !important;
            padding: 0 10px !important;
            box-sizing: border-box !important;
            border: 1px solid rgba(255, 255, 255, 0.15) !important;
            border-radius: 8px !important;
            background: rgba(255, 255, 255, 0.06) !important;
            color: #ffffff !important;
            font-size: 12px !important;
            outline: none !important;
            box-shadow: none !important;
        }

        .sc-lyf-hint a {
            color: #ffffff !important;
            text-decoration: underline !important;
        }

        /* 35. Lyrics typography + sung-word sweep.
               Font: SF Pro Display (when it is installed), set as plain running text so its own
               kerning and spacing apply. Inter is only a fallback for computers without SF Pro.
               Each letter is its own span so it can light up and lift in turn. Letters as boxes would switch
               kerning off, so fitLyricLetters() measures their kerned places as plain text first and gives each
               box a margin that puts it back there. */
        #sc-lyrics .sc-ly-line,
        #sc-lyrics .sc-ly-line *,
        #sc-ly-full .sc-ly-line,
        #sc-ly-full .sc-ly-line *,
        #sc-ly-full .sc-lyf-title,
        #sc-ly-full .sc-lyf-artist {
            font-family: "SF Pro Display", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
            font-feature-settings: normal !important;
            font-kerning: normal;
            font-synthesis: none;
        }

        /* the site-wide "everything is weight 400" rule also hits the word spans */
        .sc-ly-line,
        .sc-ly-line * {
            font-weight: var(--sc-ly-weight, 600) !important;
            letter-spacing: 0 !important;
        }

        /* room for the glow: it was being clipped right at the text's left and right edges, which read as
           a box. The scrolling area now extends 60px past the text on both sides (padding puts the text back). */
        .sc-lyf-lyrics .sc-ly-scroll {
            left: -60px !important;
            right: -60px !important;
            padding-left: 60px !important;
            padding-right: 60px !important;
        }

        #sc-lyrics .sc-ly-scroll {
            padding-left: 34px;
            padding-right: 34px;
        }

        /* --p = how much of the word has been sung, 0 to 100. Registered so it can ease between updates. */
        @property --p {
            syntax: '<number>';
            inherits: false;
            initial-value: 0;
        }

        .sc-ly-line .sc-w {
            display: inline-block;
            white-space: nowrap;
            transform-origin: 50% 85%;
            transition: transform 0.45s cubic-bezier(0.2, 0.9, 0.25, 1), --p 0.12s linear, filter 0.5s ease;
        }

        /* active line: each word is filled by a white-to-dim gradient whose edge sits at --p, with a soft
           18% blend so the light glides through the letters instead of jumping between them */
        .sc-ly-line.sc-active .sc-l {
            color: transparent;
            -webkit-text-fill-color: transparent;
            background-image: linear-gradient(90deg, #ffffff calc(var(--p) * 1.18% - 18%), rgba(255, 255, 255, 0.42) calc(var(--p) * 1.18%));
            -webkit-background-clip: text;
            background-clip: text;
        }

        /* glow follows the bright part of the gradient, because drop-shadow is cast by what is actually drawn */
        .sc-ly-line.sc-active .sc-w.sc-lit {
            filter: drop-shadow(0 0 calc(var(--sc-ly-glow, 50) * 0.12px) rgba(255, 255, 255, calc(var(--sc-ly-glow, 50) / 190)));
        }

        /* the word being sung lifts and grows slightly, with a stronger glow */
        .sc-ly-line.sc-active .sc-w.sc-live {
            transform: translateY(-2px) scale(1.045);
            filter: drop-shadow(0 0 calc(var(--sc-ly-glow, 50) * 0.3px) rgba(255, 255, 255, calc(var(--sc-ly-glow, 50) / 85)));
        }

        .sc-ly-line.sc-active + .sc-ly-line.sc-active {
            opacity: 0.92;
        }

        /* backing vocals: a smaller line under the lead, with its own sweep */
        .sc-ly-bg {
            display: block;
            margin-top: 0.18em;
            font-size: 0.6em;
            line-height: 1.25;
        }

        /* syllables that belong to one word never split across rows */
        .sc-ly-line .sc-word {
            display: inline-block;
            white-space: nowrap;
        }

        /* track rows: the play / pause glyph in the number slot always takes the song's colour */
        .trackItem__play .sc-button-play,
        .trackItem:hover .trackItem__play .sc-button-play,
        .trackItem.active .trackItem__play .sc-button-play {
            color: var(--sc-accent) !important;
        }

        .trackItem__play .sc-button-play svg,
        .trackItem__play .sc-button-play svg path {
            fill: currentColor !important;
        }

        .sc-num-icon,
        .sc-tp-row:hover .sc-num-icon {
            color: var(--sc-accent);
        }

        /* 36. See withBarGeometry(): the player bar in its normal open shape for the instant a seek or
               volume change is sent to SoundCloud's own sliders */
        body.sc-bar-measure.sc-bar-measure[data-lyf-bar] #app div.playControls,
        body.sc-bar-measure div.playControls {
            display: block !important;
        }

        body.sc-bar-measure[data-lyf-bar] section.playControls__inner,
        body.sc-bar-measure section.playControls__inner {
            transform: translateX(-50%) !important;
            transition: none !important;
        }

        body.sc-bar-notrans[data-lyf-bar] section.playControls__inner,
        body.sc-bar-notrans section.playControls__inner {
            transition: none !important;
        }

        /* 37. Settings > Lyrics: Spotify link for the playing song */
        .sc-link-row {
            display: flex;
            gap: 6px;
        }

        .sc-link-row button {
            flex: 0 0 auto;
            height: 32px;
            padding: 0 12px;
            border: none;
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.1);
            color: #ffffff;
            font-size: 12px;
            cursor: pointer;
        }

        .sc-link-row .sc-link-save {
            background: var(--sc-accent);
        }

        /* 38. Lyric motion. Letters are moved every frame by animateLyricWords() through
               --p (gradient fill 0-100), --y (lift in px) and --g (glow 0-1), so there are no CSS
               transitions on them: transitions would lag behind and fight the per-frame values.
               --s (scale) as well. */
        .sc-ly-line .sc-w,
        .sc-ly-line .sc-l {
            transition: none !important;
        }

        .sc-ly-scroll.sc-fitted .sc-ly-line .sc-l {
            display: inline-block;
            transform: translateY(calc(var(--y, 0) * 1px)) scale(var(--s, 1));
            transform-origin: 50% 85%;
        }

        .sc-ly-line.sc-active .sc-l {
            filter: drop-shadow(0 0 calc(var(--g, 0) * var(--sc-ly-glow, 50) * 0.26px) rgba(255, 255, 255, calc(var(--g, 0) * var(--sc-ly-glow, 50) / 95)));
        }

        /* lines: the one being sung is full size and sharp; the rest sit slightly smaller and blur a
           little more the further away they are (--d = how many lines away) */
        .sc-ly-scroll .sc-ly-line {
            transform: scale(0.955);
            transform-origin: 0 50%;
            filter: blur(calc(min(var(--d, 0), 6) * 0.5px));
            transition: transform 0.5s cubic-bezier(0.2, 0.9, 0.25, 1), filter 0.6s ease, color 0.35s ease, opacity 0.35s ease;
        }

        .sc-ly-scroll .sc-ly-line.sc-ly-right {
            transform-origin: 100% 50%;
        }

        #sc-ly-full[data-layout="below"] .sc-ly-scroll .sc-ly-line {
            transform-origin: 50% 50%;
        }

        .sc-ly-scroll .sc-ly-line.sc-active {
            transform: none;
            filter: none;
        }

        /* reading ahead: pointing at the lyrics, or lyrics without timestamps, shows everything sharp */
        .sc-ly-scroll:hover .sc-ly-line,
        .sc-ly-plain .sc-ly-scroll .sc-ly-line {
            filter: none;
        }

        .sc-ly-plain .sc-ly-scroll .sc-ly-line {
            transform: none;
        }

        /* 39. Lyrics alignment (Settings > Appearance): the side lines are set from and grow from.
               Left is the default and needs no rule. A second singer's lines (.sc-ly-right) go opposite. */
        html[data-ly-align="center"] #sc-lyrics .sc-ly-scroll .sc-ly-line,
        html[data-ly-align="center"] #sc-ly-full .sc-ly-scroll .sc-ly-line {
            text-align: center;
            transform-origin: 50% 50%;
        }

        html[data-ly-align="right"] #sc-lyrics .sc-ly-scroll .sc-ly-line,
        html[data-ly-align="right"] #sc-ly-full .sc-ly-scroll .sc-ly-line {
            text-align: right;
            transform-origin: 100% 50%;
        }

        html[data-ly-align="right"] #sc-lyrics .sc-ly-scroll .sc-ly-line.sc-ly-right,
        html[data-ly-align="right"] #sc-ly-full .sc-ly-scroll .sc-ly-line.sc-ly-right {
            text-align: left;
            transform-origin: 0 50%;
        }

        html[data-ly-align="center"] .sc-ly-note,
        html[data-ly-align="right"] .sc-ly-note {
            text-align: inherit;
        }
    `);

    /* ---------- In-app navigation ----------
       SoundCloud's router picks up clicks on any real <a>, so going through one keeps the page
       (and the music) alive. Setting window.location reloads everything and stops playback. */
    const navigate = (path) => {
        const a = document.createElement('a');
        a.href = path;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
    };

    /* ---------- SoundCloud API (public data only) ---------- */
    const oauthToken = () => (document.cookie.match(/(?:^|; )oauth_token=([^;]+)/) || [])[1] || null;

    // path may also be a full next_href from a previous page of results
    const api = async (path) => {
        const hydration = pageHydration();
        const client = Array.isArray(hydration) && hydration.find(item => item && item.hydratable === 'apiClient' && item.data);
        if (!client) throw new Error('no api client id');
        const url = new URL(path, 'https://api-v2.soundcloud.com');
        if (url.origin !== 'https://api-v2.soundcloud.com') throw new Error('unexpected api host');
        if (!url.searchParams.has('client_id')) url.searchParams.set('client_id', client.data.id);
        const token = oauthToken(); // needed for your own library and private playlists
        const res = await fetch(url, token ? { headers: { Authorization: `OAuth ${token}` } } : {});
        if (!res.ok) throw new Error(`api ${res.status}`);
        return res.json();
    };

    const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
    const formatDuration = (ms) => {
        const total = Math.floor(ms / 1000);
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = String(total % 60).padStart(2, '0');
        return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
    };
    const artworkOf = (item, size) => ((item && (item.artwork_url || (item.user && item.user.avatar_url) || item.avatar_url)) || '').replace('-large', `-${size}`);

    /* ---------- Playing a track we rendered ourselves ----------
       Only SoundCloud's own play buttons can start playback. If the track is already on the page as a
       native item its button is clicked in place; otherwise we go to the track's page and press play there. */
    let pendingAutoplay = null;
    const playTrack = (permalinkUrl) => {
        const path = new URL(permalinkUrl, location.origin).pathname;
        const link = [...document.querySelectorAll('.soundList__item a.soundTitle__title')].find(a => a.getAttribute('href') === path);
        const sound = link && link.closest('.sound');
        const btn = sound && sound.querySelector('.sc-button-play');
        if (btn) {
            // already the playing song: leave it alone rather than toggling it to paused
            if (!(isCurrentTrack(path) && document.querySelector('.playControls__play.playing'))) btn.click();
            return;
        }
        pendingAutoplay = { path, until: Date.now() + 10000 };
        navigate(path);
    };

    const runPendingAutoplay = () => {
        if (!pendingAutoplay) return;
        if (Date.now() > pendingAutoplay.until) { pendingAutoplay = null; return; }
        if (location.pathname !== pendingAutoplay.path) return;
        if (document.body.classList.contains('sc-track')) {
            // our own song page: wait until SoundCloud's hidden player page has caught up, then press its play
            const frameBtn = frameButton('Play', 'Pause');
            if (!frameBtn) return;
            pendingAutoplay = null;
            if (frameBtn.getAttribute('aria-label') === 'Play') frameBtn.click();
            return;
        }
        const btn = document.querySelector('.fullHero .sc-button-play');
        if (!btn) return;
        pendingAutoplay = null;
        if (!btn.classList.contains('sc-button-pause')) btn.click();
    };

    /* ---------- Release years on list items (shown under the title on discography tiles) ---------- */
    const markReleaseYears = () => {
        document.querySelectorAll('.soundTitle__uploadTime:not([data-sc-year]) time[datetime]').forEach((time) => {
            time.closest('.soundTitle__uploadTime').dataset.scYear = time.getAttribute('datetime').slice(0, 4);
        });
    };

    /* ---------- Artist page ---------- */
    const artistCache = new Map(); // permalink -> { user, top, related } (or a pending promise)

    const loadArtist = (permalink) => {
        if (!artistCache.has(permalink)) {
            artistCache.set(permalink, (async () => {
                const user = await api(`/resolve?url=${encodeURIComponent(`https://soundcloud.com/${permalink}`)}`);
                const [top, related] = await Promise.all([
                    api(`/users/${user.id}/toptracks?limit=10`).then(r => (r.collection || []).slice(0, 10)).catch(() => []),
                    api(`/users/${user.id}/relatedartists?limit=6`).then(r => (r.collection || []).slice(0, 6)).catch(() => [])
                ]);
                // which tabs actually lead somewhere
                const has = (path) => api(path).then(r => (r.collection || []).length > 0).catch(() => true);
                const [albums, sets, reposts] = await Promise.all([
                    has(`/users/${user.id}/albums?limit=1`),
                    has(`/users/${user.id}/playlists_without_albums?limit=1`),
                    has(`/stream/users/${user.id}/reposts?limit=1`)
                ]);
                const tabs = { 'popular-tracks': (user.track_count || 0) > 0, tracks: (user.track_count || 0) > 0, albums, sets, reposts };
                const data = { user, top, related, tabs };
                artistCache.set(permalink, data);
                return data;
            })().catch(() => { artistCache.delete(permalink); return null; }));
        }
        return artistCache.get(permalink);
    };

    const renderPopular = (section, data) => {
        section.dataset.for = data.user.permalink;
        section.classList.remove('sc-pop-open');
        section.innerHTML = `
            <div class="sc-pop-col">
                <h2>Popular</h2>
                <div class="sc-pop-list"></div>
                <button type="button" class="sc-pop-more">See more</button>
            </div>
            <div class="sc-fan-col">
                <h2>Fans also like</h2>
                <div class="sc-fan-list"></div>
            </div>
        `;

        const list = section.querySelector('.sc-pop-list');
        data.top.forEach((track, i) => {
            const row = document.createElement('div');
            row.className = 'sc-pop-row' + (i >= 5 ? ' sc-pop-extra' : '');
            row.innerHTML = `
                <span class="sc-pop-num">${i + 1}</span>
                <img alt="" />
                <span class="sc-pop-title"></span>
                <span class="sc-pop-plays">${(track.playback_count || 0).toLocaleString()}</span>
                <span class="sc-pop-time">${formatDuration(track.duration || 0)}</span>
            `;
            row.querySelector('img').src = artworkOf(track, 't120x120');
            row.querySelector('.sc-pop-title').textContent = track.title;
            row.title = track.title;
            row.addEventListener('click', () => playTrack(track.permalink_url));
            list.appendChild(row);
        });

        const more = section.querySelector('.sc-pop-more');
        if (data.top.length <= 5) more.remove();
        else more.addEventListener('click', () => {
            more.textContent = section.classList.toggle('sc-pop-open') ? 'Show less' : 'See more';
        });
        if (!data.top.length) section.querySelector('.sc-pop-col').remove();

        const fans = section.querySelector('.sc-fan-list');
        data.related.forEach((user) => {
            const row = document.createElement('a');
            row.className = 'sc-fan-row';
            row.href = `/${user.permalink}`;
            row.innerHTML = `
                <img alt="" />
                <div style="min-width:0">
                    <div class="sc-fan-name"></div>
                    <div class="sc-fan-sub">${compact.format(user.followers_count || 0)} followers</div>
                </div>
            `;
            row.querySelector('img').src = artworkOf(user, 't120x120');
            row.querySelector('.sc-fan-name').textContent = user.username;
            fans.appendChild(row);
        });
        if (!data.related.length) section.querySelector('.sc-fan-col').remove();
    };

    const updateArtistPage = () => {
        if (navFrozen) return;
        const hero = document.querySelector('.l-user-hero .profileHeader');
        const parts = location.pathname.split('/').filter(Boolean);
        const isProfile = !!hero && parts.length >= 1;
        const tab = parts[1] || '';

        document.body.classList.toggle('sc-artist', isProfile);
        document.body.classList.toggle('sc-artist-home', isProfile && !tab);
        document.body.classList.toggle('sc-tiles', isProfile);
        if (!isProfile) return;

        const permalink = parts[0];

        // blurred backdrop comes from the profile picture
        const avatar = hero.querySelector('.profileHeaderInfo__avatar span.sc-artwork');
        const avatarBg = avatar ? window.getComputedStyle(avatar).backgroundImage : 'none';
        if (avatarBg && avatarBg !== 'none') {
            const big = avatarBg.replace(/-t\d+x\d+/, '-t500x500');
            if (document.body.style.getPropertyValue('--sc-artist-img') !== big) document.body.style.setProperty('--sc-artist-img', big);
        }

        // round play button in front of Follow
        const buttons = document.querySelector('.userInfoBar__buttons');
        if (buttons && !buttons.querySelector('.sc-artist-play')) {
            const play = document.createElement('button');
            play.type = 'button';
            play.className = 'sc-artist-play';
            play.title = 'Play';
            play.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M12.322 7.576a.5.5 0 0 1 0 .848l-6.557 4.098A.5.5 0 0 1 5 12.098V3.902a.5.5 0 0 1 .765-.424l6.557 4.098Z" fill="currentColor"></path></svg>';
            play.addEventListener('click', () => {
                const data = artistCache.get(location.pathname.split('/').filter(Boolean)[0]);
                if (data && data.top && data.top.length) { playTrack(data.top[0].permalink_url); return; }
                const first = document.querySelector('.userMain__content .soundList__item .sc-button-play');
                if (first) first.click();
            });
            buttons.prepend(play);
        }

        const data = loadArtist(permalink);
        if (!data || typeof data.then === 'function') {
            if (data) data.then(() => { if (location.pathname.split('/').filter(Boolean)[0] === permalink) updateArtistPage(); });
            return;
        }

        // drop tabs that would open an empty list (never the one you are on)
        document.querySelectorAll('.profileTabs .g-tabs-item').forEach((item) => {
            const tabLink = item.querySelector('.g-tabs-link');
            const key = tabLink ? ((tabLink.getAttribute('href') || '').split('/').filter(Boolean)[1] || '') : '';
            item.classList.toggle('sc-tab-empty', !!tabLink && data.tabs[key] === false && !tabLink.classList.contains('active'));
        });

        // "16.7K followers . 36 tracks" under the name
        const content = hero.querySelector('.profileHeaderInfo__content');
        let stats = document.getElementById('sc-artist-stats');
        const statsText = `${compact.format(data.user.followers_count || 0)} followers • ${(data.user.track_count || 0).toLocaleString()} tracks`;
        if (content && (!stats || !content.contains(stats))) {
            if (stats) stats.remove();
            stats = document.createElement('div');
            stats.id = 'sc-artist-stats';
            content.appendChild(stats);
        }
        if (stats && stats.textContent !== statsText) stats.textContent = statsText;

        // Popular + Fans also like live inside .userInfoBar so they sit between the buttons and the tabs
        const bar = document.querySelector('.userInfoBar');
        if (bar) {
            let section = document.getElementById('sc-artist-popular');
            if (!section || !bar.contains(section)) {
                if (section) section.remove();
                section = document.createElement('section');
                section.id = 'sc-artist-popular';
                bar.appendChild(section);
            }
            if (section.dataset.for !== permalink) renderPopular(section, data);
        }
    };

    /* ---------- Song page ----------
       See CSS section 10. SoundCloud's own track page lives in iframe.webiIframe; we draw #sc-track-page
       over it and press the iframe's real buttons (found by aria-label) for anything that needs SoundCloud. */
    const strokeIcon = (inner, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
    const ICONS = {
        play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M12.322 7.576a.5.5 0 0 1 0 .848l-6.557 4.098A.5.5 0 0 1 5 12.098V3.902a.5.5 0 0 1 .765-.424l6.557 4.098Z" fill="currentColor"></path></svg>',
        pause: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor"></path></svg>',
        shuffle: strokeIcon('<path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/><path d="m18 2 4 4-4 4"/><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/><path d="m18 14 4 4-4 4"/>'),
        heart: strokeIcon('<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>', 'sc-fillable'),
        add: strokeIcon('<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>'),
        repost: strokeIcon('<path d="m2 9 3-3 3 3"/><path d="M13 18H7a2 2 0 0 1-2-2V6"/><path d="m22 15-3 3-3-3"/><path d="M11 6h6a2 2 0 0 1 2 2v10"/>'),
        link: strokeIcon('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
        clock: strokeIcon('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>')
    };

    const currentPath = () => location.pathname.replace(/\/$/, '');
    const webiFrame = () => document.querySelector('iframe.webiIframe');
    const webiDoc = (frame) => { try { return frame ? frame.contentDocument : null; } catch (e) { return null; } };

    // A button inside SoundCloud's iframe, but only once the iframe is showing the same track as the address bar
    const frameButton = (...labels) => {
        const frame = webiFrame();
        const doc = webiDoc(frame);
        if (!doc || !doc.body) return null;
        if (frame.contentWindow.location.pathname.replace(/\/$/, '') !== '/n' + currentPath()) return null;
        for (const label of labels) {
            const btn = doc.querySelector(`main button[aria-label="${label}"]`);
            if (btn) return btn;
        }
        return null;
    };

    // Hide everything in the iframe except its dialogs / menus, and reveal the iframe only while one is open
    const setGhost = (frame, on) => {
        const doc = webiDoc(frame);
        if (!frame || !doc || !doc.documentElement || !doc.head) return;
        if (!doc.getElementById('sc-ghost-style')) {
            const style = doc.createElement('style');
            style.id = 'sc-ghost-style';
            style.textContent = `
                html.sc-ghost, html.sc-ghost body { background: transparent !important; }
                html.sc-ghost body > *:not(.MuiModal-root):not(.MuiPopover-root):not(.MuiDialog-root):not([role="dialog"]):not([role="presentation"]) { visibility: hidden !important; }
            `;
            doc.head.appendChild(style);
        }
        doc.documentElement.classList.toggle('sc-ghost', on);
        let open = false;
        if (on && doc.body) {
            open = [...doc.querySelectorAll('body > .MuiModal-root, body > .MuiPopover-root, body > .MuiDialog-root, body > [role="dialog"], body > [role="presentation"]')]
                .some(el => !el.classList.contains('MuiModal-hidden') && el.getClientRects().length > 0);
        }
        frame.classList.toggle('sc-modal-open', open);
    };

    const trackCache = new Map(); // path -> track | false (not a track) | pending promise
    const loadTrack = (path) => {
        if (!trackCache.has(path)) {
            trackCache.set(path, api(`/resolve?url=${encodeURIComponent('https://soundcloud.com' + path)}`)
                .then((res) => { const track = res && res.kind === 'track' ? res : false; trackCache.set(path, track); return track; })
                .catch(() => { trackCache.delete(path); return false; }));
        }
        return trackCache.get(path);
    };

    const isCurrentTrack = (path) => {
        const badge = document.querySelector('.playbackSoundBadge__titleLink');
        if (!badge) return false;
        const href = (badge.getAttribute('href') || '').split('?')[0];
        // tracks started from SoundCloud's iframe page show up as "/undefined/<track>", so fall back to the track slug
        return href === path || (href.startsWith('/undefined/') && href.split('/').pop() === path.split('/').pop());
    };

    const toggleTrackPlay = (tries = 0) => {
        const path = currentPath();
        if (isCurrentTrack(path)) {
            const main = document.querySelector('.playControls__play');
            if (main) main.click();
            return;
        }
        const btn = frameButton('Play', 'Pause');
        if (btn) btn.click();
        else if (tries < 10) setTimeout(() => { if (currentPath() === path) toggleTrackPlay(tries + 1); }, 400);
    };

    let trackNativeFor = null; // path where the user asked for SoundCloud's own view (comments, description)

    const renderTrackPage = (page, track, path) => {
        page.dataset.for = path;
        page.dataset.state = '';
        const year = (track.release_date || track.display_date || track.created_at || '').slice(0, 4);
        const secs = Math.floor((track.duration || 0) / 1000);
        const length = `${Math.floor(secs / 60)} min ${secs % 60} sec`;
        const released = new Date(track.release_date || track.display_date || track.created_at);
        const dateText = isNaN(released) ? '' : released.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

        page.innerHTML = `
            <div class="sc-tp-hero">
                <img class="sc-tp-art" alt="" />
                <div class="sc-tp-info">
                    <div class="sc-tp-type">Single</div>
                    <h1 class="sc-tp-title"></h1>
                    <div class="sc-tp-meta">
                        <a class="sc-tp-artist"><img alt="" /><span></span></a>
                        <span>• ${year} • 1 song, ${length}</span>
                    </div>
                </div>
            </div>
            <div class="sc-tp-actions">
                <button type="button" class="sc-artist-play sc-track-play" title="Play"></button>
                <button type="button" class="sc-tp-btn" data-act="shuffle" title="Shuffle">${ICONS.shuffle}</button>
                <button type="button" class="sc-tp-btn" data-act="like" title="Like">${ICONS.heart}</button>
                <button type="button" class="sc-tp-btn" data-act="add" title="Add to playlist">${ICONS.add}</button>
                <button type="button" class="sc-tp-btn" data-act="repost" title="Repost">${ICONS.repost}</button>
                <button type="button" class="sc-tp-btn" data-act="copy" title="Copy link">${ICONS.link}</button>
                <button type="button" class="sc-tp-native" data-act="native" title="SoundCloud's own page, for writing a comment">Original page</button>
            </div>
            <div class="sc-tp-headslot"></div>
            <div class="sc-tp-row">
                <span class="sc-tp-num"><span class="sc-num-text">1</span><span class="sc-num-icon">${ICONS.play}</span></span>
                <img alt="" />
                <div style="min-width:0">
                    <div class="sc-tp-row-title"></div>
                    <div class="sc-tp-row-artist"></div>
                </div>
                <div class="sc-row-right">
                    <span class="sc-row-plays">${compact.format(track.playback_count || 0)}</span>
                    <button type="button" class="sc-tp-btn" data-act="like" title="Like">${ICONS.heart}</button>
                    <span class="sc-row-dur">${formatDuration(track.duration || 0)}</span>
                </div>
            </div>
            <div class="sc-tp-foot">
                <div>${dateText}</div>
                <div class="sc-tp-label"></div>
            </div>
            <div class="sc-tp-about">
                <h2>About</h2>
                <div class="sc-tp-about-text"></div>
                <button type="button" class="sc-tp-textbtn">Show more</button>
            </div>
            <div class="sc-tp-more-head">
                <h2></h2>
                <a>See discography</a>
            </div>
            <div class="sc-tp-more"></div>
            <div class="sc-tp-comments">
                <h2>Comments<span>${(track.comment_count || 0).toLocaleString()}</span></h2>
                <div class="sc-comment-list"></div>
                <button type="button" class="sc-tp-textbtn">Show more comments</button>
            </div>
        `;
        page.querySelector('.sc-tp-headslot').replaceWith(makeRowHead());

        const about = page.querySelector('.sc-tp-about');
        const description = (track.description || '').trim();
        if (!description) about.remove();
        else {
            about.querySelector('.sc-tp-about-text').textContent = description;
            const toggle = about.querySelector('.sc-tp-textbtn');
            if (description.split('\n').length <= 5 && description.length < 400) toggle.remove();
            else toggle.addEventListener('click', () => { toggle.textContent = about.classList.toggle('sc-open') ? 'Show less' : 'Show more'; });
        }
        loadComments(page, track, path);

        const user = track.user || {};
        page.querySelector('.sc-tp-art').src = artworkOf(track, 't500x500');
        page.querySelector('.sc-tp-title').textContent = track.title;
        page.querySelector('.sc-tp-artist').href = `/${user.permalink}`;
        page.querySelector('.sc-tp-artist img').src = (user.avatar_url || '').replace('-large', '-t120x120');
        page.querySelector('.sc-tp-artist span').textContent = user.username || '';
        page.querySelector('.sc-tp-row img').src = artworkOf(track, 't120x120');
        page.querySelector('.sc-tp-row-title').textContent = track.title;
        page.querySelector('.sc-tp-row-artist').textContent = user.username || '';
        page.querySelector('.sc-tp-label').textContent = `℗ ${year} ${track.label_name || user.username || ''}` + (track.genre ? ` • ${track.genre}` : '');
        page.querySelector('.sc-tp-more-head h2').textContent = `More by ${user.username || 'this artist'}`;
        page.querySelector('.sc-tp-more-head a').href = `/${user.permalink}`;
        document.body.style.setProperty('--sc-track-img', `url("${artworkOf(track, 't500x500')}")`);

        page.querySelector('.sc-track-play').addEventListener('click', () => toggleTrackPlay());
        // the row starts the song but never pauses it; pausing is for the play button and Space
        page.querySelector('.sc-tp-row').addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            if (isCurrentTrack(path) && document.querySelector('.playControls__play.playing')) return;
            toggleTrackPlay();
        });
        page.querySelectorAll('[data-act]').forEach((el) => el.addEventListener('click', () => {
            const act = el.dataset.act;
            if (act === 'shuffle') { const b = document.querySelector('.shuffleControl'); if (b) b.click(); }
            else if (act === 'like') { const b = frameButton('Like', 'Unlike'); if (b) b.click(); }
            else if (act === 'add') { const b = frameButton('Add to playlist'); if (b) b.click(); }
            else if (act === 'repost') { const b = frameButton('Repost', 'Unpost', 'Remove repost', 'Reposted'); if (b) b.click(); }
            else if (act === 'copy') {
                navigator.clipboard.writeText(location.origin + path).then(() => {
                    el.classList.add('sc-on');
                    setTimeout(() => el.classList.remove('sc-on'), 1200);
                }).catch(() => {});
            }
            else if (act === 'native') { trackNativeFor = path; updateTrackPage(); }
            setTimeout(syncTrackPage, 300);
        }));

        if (user.id) {
            api(`/users/${user.id}/tracks?limit=13`).then((res) => {
                if (page.dataset.for !== path) return;
                const grid = page.querySelector('.sc-tp-more');
                (res.collection || []).filter(t => t.id !== track.id).slice(0, 12).forEach((t) => {
                    const tile = document.createElement('a');
                    tile.className = 'sc-tile';
                    tile.href = new URL(t.permalink_url).pathname;
                    tile.innerHTML = '<img alt="" /><div class="sc-tile-title"></div><div class="sc-tile-sub"></div>';
                    tile.querySelector('img').src = artworkOf(t, 't300x300');
                    tile.querySelector('.sc-tile-title').textContent = t.title;
                    tile.querySelector('.sc-tile-sub').textContent = (t.release_date || t.display_date || t.created_at || '').slice(0, 4);
                    grid.appendChild(tile);
                });
                if (!grid.children.length) page.querySelector('.sc-tp-more-head').remove();
            }).catch(() => {});
        }
    };

    // keep play / like / shuffle in step with SoundCloud's real state
    const syncTrackPage = () => {
        const page = document.getElementById('sc-track-page');
        if (!page || !document.body.classList.contains('sc-track')) return;
        const current = isCurrentTrack(page.dataset.for);
        const state = current && document.querySelector('.playControls__play.playing') ? 'pause' : 'play';
        if (page.dataset.state !== state) {
            page.dataset.state = state;
            const play = page.querySelector('.sc-track-play');
            play.innerHTML = ICONS[state];
            play.title = state === 'pause' ? 'Pause' : 'Play';
            page.querySelector('.sc-num-icon').innerHTML = ICONS[state];
        }
        page.querySelector('.sc-tp-row').classList.toggle('sc-playing', current);
        const liked = !!frameButton('Unlike');
        page.querySelectorAll('[data-act="like"]').forEach(b => b.classList.toggle('sc-on', liked));
        page.querySelector('[data-act="shuffle"]').classList.toggle('sc-on', !!document.querySelector('.shuffleControl.m-shuffling'));
    };

    const updateTrackPage = () => {
        if (navFrozen) return;
        const frame = webiFrame();
        const active = !!frame && !frame.classList.contains('sc-hidden');
        const path = currentPath();
        if (trackNativeFor && trackNativeFor !== path) trackNativeFor = null;

        let track = null;
        if (active && path.split('/').filter(Boolean).length === 2) {
            const loaded = loadTrack(path);
            if (loaded && typeof loaded.then === 'function') loaded.then(() => { if (currentPath() === path) updateTrackPage(); });
            else if (loaded) track = loaded;
        }
        const custom = !!track && trackNativeFor !== path;

        document.body.classList.toggle('sc-webi', active);
        document.body.classList.toggle('sc-track', custom);
        document.body.classList.toggle('sc-track-native', active && !!track && !custom);
        if (frame) setGhost(frame, custom);

        if (!document.getElementById('sc-track-back')) {
            const back = document.createElement('button');
            back.type = 'button';
            back.id = 'sc-track-back';
            back.textContent = '← Back to song view';
            back.addEventListener('click', () => { trackNativeFor = null; updateTrackPage(); });
            document.body.appendChild(back);
        }
        if (!custom) return;

        const panel = document.querySelector('.l-container.l-content');
        if (!panel) return;
        let page = document.getElementById('sc-track-page');
        if (!page || !panel.contains(page)) {
            if (page) page.remove();
            page = document.createElement('div');
            page.id = 'sc-track-page';
            panel.appendChild(page);
        }
        if (page.dataset.for !== path) {
            renderTrackPage(page, track, path);
            const app = scrollArea();
            if (app) app.scrollTop = 0;
        if (PHONE) window.scrollTo(0, 0); // on a phone the page itself scrolls (see PHONE_CSS)
        }
        syncTrackPage();
    };

    /* ---------- Dynamic background ---------- */
    const bg = document.createElement('div');
    bg.id = 'lc-dynamic-bg';
    Object.assign(bg.style, {
        position: 'fixed',
        top: '-10%',
        left: '-10%',
        width: '120vw',
        height: '120vh',
        zIndex: '-2',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        filter: 'blur(calc(var(--sc-bg-blur, 80) * 1px)) brightness(var(--sc-bg-brightness, 0.4))',
        transition: 'background-image 0.8s ease-in-out',
        pointerEvents: 'none'
    });
    document.body.appendChild(bg);

    const updateBackground = () => {
        const artEl = document.querySelector('.playControls__soundBadge .playbackSoundBadge__avatar span.sc-artwork');
        if (artEl) {
            let bgImg = window.getComputedStyle(artEl).backgroundImage;
            if (bgImg && bgImg !== 'none') {
                // badge art is only 50x50, swap to a bigger size so the blur isn't muddy
                bgImg = bgImg.replace('-t50x50', '-t500x500');
                if (bg.style.backgroundImage !== bgImg) bg.style.backgroundImage = bgImg;
                const art = bgImg.match(/url\(["']?(.+?)["']?\)/);
                if (art) updateAccent(art[1].replace('-t500x500', '-t120x120'));
            }
        }
    };

    /* ---------- Profile badge (top bar) ---------- */
    let profileResolved = false;
    const updateProfileBadge = () => {
        if (profileResolved) return;

        const profileImg = document.getElementById('sc-user-profile-img');
        const profileName = document.querySelector('.sc-top-profile-name');
        const profileBtn = document.querySelector('.sc-top-profile-btn');
        if (!profileImg) return;

        // Only trust SoundCloud's own "me" record (the user/profile record is whoever's page you're on)
        const hydration = pageHydration();
        if (Array.isArray(hydration)) {
            const me = hydration.find(item => item && (item.hydratable === 'meUser' || item.hydratable === 'me') && item.data);
            if (me) {
                if (me.data.avatar_url) profileImg.src = me.data.avatar_url.replace('-large', '-t120x120');
                if (profileName && me.data.username) profileName.innerText = me.data.username;
                if (profileBtn && me.data.permalink) profileBtn.href = `/${me.data.permalink}`;
                profileResolved = true;
            }
        }
    };

    /* ---------- Sidebar library ----------
       Filled from SoundCloud's own library API: your playlists, liked playlists / albums, and the artists
       you follow. (The old version scraped the Library page, which also picked up recently played tracks.) */
    const meData = () => {
        const hydration = pageHydration();
        const me = Array.isArray(hydration) && hydration.find(item => item && (item.hydratable === 'meUser' || item.hydratable === 'me') && item.data);
        return me ? me.data : null;
    };

    const collectPages = async (path, max) => {
        let items = [];
        let next = path;
        while (next && items.length < max) {
            const res = await api(next);
            items = items.concat(res.collection || []);
            next = res.next_href || null;
        }
        return items.slice(0, max);
    };

    const loadLibraryData = async (container) => {
        const me = meData();
        if (!me || !oauthToken()) return; // logged out: nothing to list

        const likedSub = document.getElementById('sc-lib-liked-sub');
        if (likedSub) likedSub.textContent = `Playlist • ${me.username}`;

        const [items, follows] = await Promise.all([
            collectPages('/me/library/all?limit=50', 150).catch(() => []),
            collectPages(`/users/${me.id}/followings?limit=50`, 150).catch(() => [])
        ]);

        const addRow = (href, title, imgUrl, type, sub) => {
            const row = document.createElement('a');
            row.className = 'sc-sidebar-row';
            row.href = href;
            row.title = title;
            row.dataset.type = type;
            row.innerHTML = `
                <div class="sc-sidebar-icon-box">
                    <img class="sc-sidebar-thumb ${type === 'artist' ? 'circle' : ''}" alt="" />
                </div>
                <div class="sc-sidebar-text-wrap">
                    <div class="sc-sidebar-title"></div>
                    <div class="sc-sidebar-item-sub"></div>
                </div>
            `;
            // set as properties, not markup, so a title with < or " in it can't break the row
            if (imgUrl) row.querySelector('img').src = imgUrl.replace('-large', '-t200x200');
            row.querySelector('.sc-sidebar-title').textContent = title;
            row.querySelector('.sc-sidebar-item-sub').textContent = sub;
            container.appendChild(row);
        };

        container.textContent = '';
        const seen = new Set();
        items.forEach((item) => {
            const list = item.playlist || item.system_playlist;
            if (!list || !list.permalink_url) return;
            const href = new URL(list.permalink_url).pathname;
            if (seen.has(href)) return;
            seen.add(href);
            const art = list.artwork_url || list.calculated_artwork_url ||
                (list.tracks && list.tracks[0] && list.tracks[0].artwork_url) || (list.user && list.user.avatar_url) || '';
            const kind = list.is_album ? (list.set_type === 'ep' ? 'EP' : list.set_type === 'single' ? 'Single' : 'Album') : 'Playlist';
            addRow(href, list.title, art, 'playlist', `${kind} • ${list.user ? list.user.username : 'SoundCloud'}`);
        });
        follows.forEach((user) => {
            if (user && user.permalink) addRow(`/${user.permalink}`, user.username, user.avatar_url || '', 'artist', 'Artist');
        });
    };

    /* ---------- Floating main panel ----------
       #app is a fixed, rounded box that scrolls on its own (so it can stop short of the bottom like Spotify's
       panels). SoundCloud only loads more items when the *window* scrolls, so every scroll is passed on. */
    const scrollArea = () => document.getElementById('app');

    const setupScrollArea = () => {
        const app = scrollArea();
        if (!app || app.dataset.scScroll) return;
        app.dataset.scScroll = '1';
        let queued = false;
        app.addEventListener('scroll', () => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(() => {
                queued = false;
                W.dispatchEvent(new Event('scroll'));
            });
        }, { passive: true });
    };

    let lastScrollPath = location.pathname;
    let keepScrollPath = null; // set for navigations that should not jump back to the top (profile tabs)
    const resetScrollOnNavigate = () => {
        if (location.pathname === lastScrollPath) return;
        lastScrollPath = location.pathname;
        if (keepScrollPath === location.pathname) { keepScrollPath = null; return; }
        const app = scrollArea();
        if (app) app.scrollTop = 0;
        if (PHONE) window.scrollTo(0, 0); // on a phone the page itself scrolls (see PHONE_CSS)
    };

    /* ---------- Playlist pages: header row, creator avatar, track lengths ---------- */
    const makeRowHead = () => {
        const head = document.createElement('div');
        head.className = 'sc-tp-head';
        head.innerHTML = `
            <span class="sc-tp-num">#</span>
            <span>Title</span>
            <div class="sc-row-right">
                <span class="sc-row-plays">Plays</span>
                <span class="sc-row-like-slot"></span>
                <span class="sc-row-dur">${ICONS.clock}</span>
            </div>
        `;
        return head;
    };

    const playlistCache = new Map(); // path -> { playlist, durations } | false | pending promise
    const loadPlaylist = (path) => {
        if (!playlistCache.has(path)) {
            playlistCache.set(path, (async () => {
                const playlist = await api(`/resolve?url=${encodeURIComponent('https://soundcloud.com' + path)}`);
                if (!playlist || playlist.kind !== 'playlist') { playlistCache.set(path, false); return false; }
                const durations = new Map(); // track path -> ms
                const ids = new Map();       // track path -> id (used when reordering)
                const note = (t) => {
                    if (!t || !t.permalink_url) return;
                    const trackPath = new URL(t.permalink_url).pathname;
                    ids.set(trackPath, t.id);
                    if (t.duration) durations.set(trackPath, t.duration);
                };
                const tracks = playlist.tracks || [];
                tracks.forEach(note);
                // only the first few tracks arrive complete; the rest are bare ids
                const missing = tracks.filter(t => !t.permalink_url).map(t => t.id);
                for (let i = 0; i < missing.length; i += 50) {
                    const batch = await api(`/tracks?ids=${missing.slice(i, i + 50).join(',')}`).catch(() => []);
                    (Array.isArray(batch) ? batch : []).forEach(note);
                }
                const data = { playlist, durations, ids };
                playlistCache.set(path, data);
                return data;
            })().catch(() => { playlistCache.delete(path); return false; }));
        }
        return playlistCache.get(path);
    };

    const updatePlaylistPage = () => {
        if (navFrozen) return;
        if (reorder.on && reorder.path !== currentPath()) setReorderMode(false); // left the playlist mid-reorder
        const list = document.querySelector('.listenDetails__trackList');
        const parts = location.pathname.split('/').filter(Boolean);
        if (!list || parts.length !== 3 || parts[1] !== 'sets') return;
        const path = currentPath();

        if (!list.querySelector('.sc-tp-head')) list.prepend(makeRowHead());

        const data = loadPlaylist(path);
        if (!data) return;
        if (typeof data.then === 'function') { data.then(() => { if (currentPath() === path) updatePlaylistPage(); }); return; }

        const link = document.querySelector('.fullHero .soundTitle__username a');
        const owner = data.playlist.user;
        if (link && owner && owner.avatar_url && !link.querySelector('.sc-hero-avatar')) {
            const img = document.createElement('img');
            img.className = 'sc-hero-avatar';
            img.alt = '';
            img.src = owner.avatar_url.replace('-large', '-t120x120');
            link.prepend(img);
        }

        // your own playlists: rows can be dragged into a new order (setupTrackReorder)
        const me = meData();
        if (me && data.playlist.user_id === me.id) {
            ensureReorderBar(list);
            // rows that load while reorder mode is on become draggable too
            if (reorder.on) list.querySelectorAll('li').forEach((li) => { if (!li.draggable && li.querySelector('.trackItem')) li.draggable = true; });
        }

        // checked on every pass: SoundCloud rebuilds a row's right-hand side when it starts playing
        list.querySelectorAll('.trackItem').forEach((item) => {
            const title = item.querySelector('.trackItem__trackTitle');
            const right = item.querySelector('.trackItem__additional');
            if (!title || !right || right.querySelector('.sc-track-dur')) return;
            const ms = data.durations.get((title.getAttribute('href') || '').split('?')[0]);
            if (!ms) return;
            const span = document.createElement('span');
            span.className = 'sc-track-dur';
            span.textContent = formatDuration(ms);
            right.appendChild(span);
        });
    };

    /* ---------- Song page: comments ---------- */
    const timeAgo = (iso) => {
        const secs = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
        const units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
        for (const [name, size] of units) {
            if (secs >= size) { const n = Math.floor(secs / size); return `${n} ${name}${n === 1 ? '' : 's'} ago`; }
        }
        return 'just now';
    };

    // Seeking and volume work by sending SoundCloud's own sliders the mouse events of a drag. SoundCloud
    // turns the pointer position into a value using the bar's normal size, so while the events are sent the
    // player bar is put (invisibly, within one frame) into its normal open shape. Otherwise, with the bar
    // shrunk to its "On hover" capsule or hidden in fullscreen, every seek landed near 0:00 and every
    // volume change read as maximum.
    const withBarGeometry = (fn) => {
        const body = document.body;
        body.classList.add('sc-bar-measure');
        try { return fn(); }
        finally {
            body.classList.remove('sc-bar-measure');
            body.classList.add('sc-bar-notrans'); // go back without animating from the open shape
            void body.offsetWidth;
            setTimeout(() => body.classList.remove('sc-bar-notrans'), 80);
        }
    };

    const seekTo = (seconds) => withBarGeometry(() => {
        const bar = document.querySelector('.playbackTimeline__progressWrapper');
        if (!bar) return;
        const max = Number(bar.getAttribute('aria-valuemax')) || 0;
        if (!max) return;
        const rect = bar.getBoundingClientRect();
        const x = rect.left + rect.width * Math.min(0.999, Math.max(0, seconds / max));
        const fire = (el, type) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: rect.top + 2, button: 0, buttons: 1 }));
        fire(bar, 'mousedown');
        fire(document, 'mousemove');
        fire(document, 'mouseup');
    });

    const loadComments = async (page, track, path, url) => {
        const box = page.querySelector('.sc-tp-comments');
        if (!box) return;
        const list = box.querySelector('.sc-comment-list');
        const more = box.querySelector('.sc-tp-textbtn');
        more.style.display = 'none';
        let res;
        try { res = await api(url || `/tracks/${track.id}/comments?threaded=0&filter_replies=1&limit=20&offset=0&linked_partitioning=1`); }
        catch (e) { return; }
        if (page.dataset.for !== path) return;
        (res.collection || []).forEach((c) => {
            const user = c.user || {};
            const row = document.createElement('div');
            row.className = 'sc-comment';
            row.innerHTML = `
                <img alt="" />
                <div>
                    <div class="sc-comment-head"><a></a> at <button type="button" class="sc-comment-time"></button> · <span></span></div>
                    <div class="sc-comment-body"></div>
                </div>
            `;
            row.querySelector('img').src = (user.avatar_url || '').replace('-large', '-t120x120');
            const name = row.querySelector('.sc-comment-head a');
            name.textContent = user.username || 'Unknown';
            name.href = `/${user.permalink || ''}`;
            const stamp = row.querySelector('.sc-comment-time');
            stamp.textContent = formatDuration(c.timestamp || 0);
            stamp.title = 'Jump to this moment';
            stamp.addEventListener('click', () => { if (isCurrentTrack(path)) seekTo((c.timestamp || 0) / 1000); });
            row.querySelector('.sc-comment-head span').textContent = timeAgo(c.created_at);
            row.querySelector('.sc-comment-body').textContent = c.body || '';
            list.appendChild(row);
        });
        if (!list.children.length) { box.style.display = 'none'; return; }
        if (res.next_href) {
            more.style.display = '';
            more.onclick = () => loadComments(page, track, path, res.next_href);
        }
    };

    /* ---------- Lyrics (LRCLIB) ----------
       Looks the playing track up on lrclib.net, shows synced lines in the right-hand panel, highlights
       the current one and lets you click a line to jump there. Falls back to plain text when a song has
       no timestamps. */
    const lyrics = { key: null, lines: null, synced: false, active: -1, lastWheel: 0 };
    const lyricsCache = new Map(); // key -> { synced, lines } | null

    const nowPlaying = () => {
        const title = document.querySelector('.playbackSoundBadge__titleLink');
        const artist = document.querySelector('.playbackSoundBadge__lightLink');
        const bar = document.querySelector('.playbackTimeline__progressWrapper');
        if (!title || !bar) return null;
        return {
            title: title.getAttribute('title') || '',
            artist: artist ? (artist.getAttribute('title') || artist.textContent || '') : '',
            duration: Number(bar.getAttribute('aria-valuemax')) || 0,
            position: Number(bar.getAttribute('aria-valuenow')) || 0
        };
    };

    // The one place promo junk is stripped from a title: "(prod. x)", "[OUT NOW]", "*new*", "w/ someone",
    // "OUT EVERYWHERE"... Used for track rows, the fullscreen title and the lyrics search.
    const cleanTitle = (text) => (text || '')
        .replace(/^\d+[\s\.\·]+/, '')
        .replace(/\s*\([^)]*\)/g, '')
        .replace(/\s*\[[^\]]*\]/g, '')
        .replace(/\s*\*[^^*]*\*/g, '')
        .replace(/\s+(OUT\s+EVERYWHERE|MUSIC\s+VID.*|OUT\s+ON\s+YT).*$/i, '')
        .replace(/\s+w\/\s+.*/i, '')
        .trim();

    // Lyrics search starts from cleanTitle and also drops trailing credits and hashtags, which never
    // appear in LRCLIB's song names
    const cleanSongTitle = (text) => cleanTitle(text)
        .replace(/\s+(prod\.?|ft\.?|feat\.?)\s.*$/i, '')
        .replace(/\s*#\S+/g, '')
        .trim();
    const cleanArtistName = (text) => text.replace(/\s*\(@[^)]*\)/g, '').replace(/\s*@\S+/g, '').trim();

    const parseLrc = (lrc) => {
        const lines = [];
        lrc.split('\n').forEach((raw) => {
            const m = raw.match(/^\s*\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
            if (m) lines.push({ t: Number(m[1]) * 60 + Number(m[2]), text: m[3].trim() });
        });
        return lines;
    };

    const pickLyrics = (results, duration) => {
        let best = null;
        let bestScore = 0;
        (Array.isArray(results) ? results : []).forEach((r) => {
            if (r.instrumental || (!r.syncedLyrics && !r.plainLyrics)) return;
            let score = r.syncedLyrics ? 100 : 40;
            if (r.duration && duration) {
                const diff = Math.abs(r.duration - duration);
                if (diff > 8) return;         // a different recording
                score += 50 - diff * 5;
            }
            if (score > bestScore) { bestScore = score; best = r; }
        });
        return best;
    };

    const fetchLyrics = async (np) => {
        const artist = cleanArtistName(np.artist);
        const candidates = [{ track: cleanSongTitle(np.title), artist }];
        // uploads titled "Artist - Song"
        const dash = np.title.split(/\s+[-–—]\s+/);
        if (dash.length === 2) candidates.push({ track: cleanSongTitle(dash[1]), artist: cleanArtistName(dash[0]) });
        for (const c of candidates) {
            if (!c.track) continue;
            const url = new URL('https://lrclib.net/api/search');
            url.searchParams.set('track_name', c.track);
            if (c.artist) url.searchParams.set('artist_name', c.artist);
            let results = [];
            try { const res = await fetch(url); if (res.ok) results = await res.json(); } catch (e) {}
            const hit = pickLyrics(results, np.duration);
            if (hit) {
                if (hit.syncedLyrics) {
                    const lines = parseLrc(hit.syncedLyrics);
                    if (lines.length) return { synced: true, lines };
                }
                if (hit.plainLyrics) return { synced: false, lines: hit.plainLyrics.split('\n').map(text => ({ t: 0, text: text.trim() })) };
            }
        }
        // nothing synced anywhere: plain lyrics from Genius
        return fetchGeniusLyrics(np).catch(() => null);
    };

    /* ---------- Genius (last resort, never time-synced) ----------
       Genius has no lyrics API, so this searches its site and reads the lyrics off the song's page. That
       is a cross-site request the page itself may not make; the userscript manager makes it (gmRequest). */
    const gmGet = (url) => new Promise((resolve, reject) => {
        gmRequest({ method: 'GET', url, timeout: 12000, onload: resolve, onerror: reject, ontimeout: reject });
    });

    const plainKey = (text) => (text || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');

    const fetchGeniusLyrics = async (np) => {
        const pairs = [[cleanSongTitle(np.title), cleanArtistName(np.artist)]];
        const dash = np.title.split(/\s+[-\u2013\u2014]\s+/);
        if (dash.length === 2) pairs.push([cleanSongTitle(dash[1]), cleanArtistName(dash[0])]);
        for (const [title, artist] of pairs) {
            if (!title) continue;
            const search = await gmGet(`https://genius.com/api/search/multi?per_page=5&q=${encodeURIComponent(`${artist} ${title}`)}`);
            let sections = [];
            try { sections = JSON.parse(search.responseText).response.sections || []; } catch (e) {}
            const songs = sections.flatMap(sec => sec.hits || []).filter(hit => hit.type === 'song' && hit.result).map(hit => hit.result);
            // only accept a hit whose title and artist both line up, so a wrong song's lyrics are never shown
            const wantTitle = plainKey(title);
            const wantArtist = plainKey(artist);
            const hit = songs.find((song) => {
                const gotTitle = plainKey(song.title);
                const gotArtist = plainKey(song.primary_artist && song.primary_artist.name);
                const titleOk = gotTitle === wantTitle || (wantTitle.length > 3 && (gotTitle.includes(wantTitle) || wantTitle.includes(gotTitle)));
                const artistOk = !wantArtist || gotArtist.includes(wantArtist) || wantArtist.includes(gotArtist);
                return titleOk && artistOk && gotTitle && gotArtist;
            });
            if (!hit || !hit.url) continue;
            const page = await gmGet(hit.url);
            const doc = new DOMParser().parseFromString(page.responseText, 'text/html');
            const blocks = [...doc.querySelectorAll('[data-lyrics-container="true"]')];
            if (!blocks.length) continue;
            const text = blocks.map((block) => {
                block.querySelectorAll('[data-exclude-from-selection="true"]').forEach(el => el.remove()); // page furniture
                block.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
                return block.textContent;
            }).join('\n');
            const lines = text.split('\n').map(line => ({ t: 0, text: line.trim() }));
            while (lines.length && !lines[0].text) lines.shift();
            if (lines.some(line => line.text)) return { synced: false, lines, credit: 'Lyrics from Genius' };
        }
        return null;
    };

    const lyricsPanel = () => {
        let panel = document.getElementById('sc-lyrics');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'sc-lyrics';
            panel.innerHTML = `
                <div class="sc-ly-body"></div>
                <button type="button" class="sc-ly-fs-btn" title="Full screen lyrics">${strokeIcon('<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>')}</button>
            `;
            panel.addEventListener('wheel', () => { lyrics.lastWheel = Date.now(); }, { passive: true });
            panel.querySelector('.sc-ly-fs-btn').addEventListener('click', () => openLyricsFull());
            document.body.appendChild(panel);
        }
        return panel;
    };

    // Every place lyrics are drawn: the side panel, plus the fullscreen view while it is open
    const lyricsTargets = () => {
        const targets = [{ box: lyricsPanel().querySelector('.sc-ly-body'), plainOn: lyricsPanel() }];
        const full = document.querySelector('#sc-ly-full.sc-open .sc-lyf-lyrics');
        if (full) targets.push({ box: full, plainOn: full });
        return targets;
    };

    /* ---------- Spicy Lyrics (optional, word-by-word timing) ----------
       Spicy Lyrics' public API (developers.spicylyrics.org) looks songs up by Spotify track id and needs an
       API key, typed in under Settings > Lyrics and kept in this browser. SoundCloud tracks have no Spotify
       id, so each song has to be matched to one first (see resolveSpotifyId). Without a key, or when a song
       is not found, lyrics come from LRCLIB as before. */
    const lyricKeys = (() => {
        try { return { spicy: String(JSON.parse(localStorage.getItem('sc-lc-lyrics-keys') || '{}').spicy || '') }; }
        catch (e) { return { spicy: '' }; }
    })();
    const saveLyricKeys = () => { try { localStorage.setItem('sc-lc-lyrics-keys', JSON.stringify(lyricKeys)); } catch (e) {} };
    let lyricSourceStatus = ''; // last thing that happened with the Spicy Lyrics lookup, shown in settings

    const spicyToLyrics = (body) => {
        const who = body.UploadAttribution && body.UploadAttribution.Uploader ? ` • synced by ${body.UploadAttribution.Uploader.username}` : '';
        const provider = { spicy_lyrics: 'Spicy Lyrics', apple_music: 'Apple Music (via Spicy Lyrics)', spotify: 'Spotify (via Spicy Lyrics)' }[body.source] || 'Spicy Lyrics';
        const credit = `Lyrics from ${provider}${body.source === 'spicy_lyrics' ? who : ''}`;
        if (body.Type === 'Syllable') {
            const lines = (body.Content || []).filter(l => l.Lead && l.Lead.Syllables && l.Lead.Syllables.length).map((l) => {
                const toWords = (group, bg) => (group.Syllables || []).map(s => ({ t: s.StartTime, e: s.EndTime, text: s.Text, glue: !!s.IsPartOfWord, bg }));
                // lead vocal first, then each backing-vocal group (bg = which group; drawn smaller underneath)
                let words = toWords(l.Lead, 0);
                let start = l.Lead.StartTime;
                let end = l.Lead.EndTime;
                (l.Background || []).forEach((group, n) => {
                    const extra = toWords(group, n + 1);
                    if (!extra.length) return;
                    words = words.concat(extra);
                    start = Math.min(start, extra[0].t);
                    end = Math.max(end, extra[extra.length - 1].e);
                });
                // the line counts as "being sung" from its first syllable to its last, lead or backing
                return { t: start, end, seek: l.Lead.StartTime, right: !!l.OppositeAligned, words, text: words.filter(w => !w.bg).map(w => w.text + (w.glue ? '' : ' ')).join('').trim() };
            });
            return lines.length ? { synced: true, exactWords: true, lines, credit } : null;
        }
        if (body.Type === 'Line') {
            const lines = (body.Content || []).map(l => ({ t: l.StartTime, end: l.EndTime, right: !!l.OppositeAligned, text: l.Text || '' }));
            return lines.length ? { synced: true, lines, credit } : null;
        }
        if (body.Type === 'Static') {
            const lines = (body.Lines || []).map(l => ({ t: 0, text: l.Text || '' }));
            return lines.length ? { synced: false, lines, credit } : null;
        }
        return null;
    };

    // Spotify track ids we already know, per song: pasted by hand, or found automatically.
    // key "artist|title" -> { id, source: 'manual' | 'musicbrainz' | 'listenbrainz' | 'apple' }
    const spotifyIds = (() => {
        try { return JSON.parse(localStorage.getItem('sc-lc-track-ids') || '{}') || {}; }
        catch (e) { return {}; }
    })();
    const saveSpotifyIds = () => { try { localStorage.setItem('sc-lc-track-ids', JSON.stringify(spotifyIds)); } catch (e) {} };
    const spotifyLookups = new Map(); // songs already looked up this session: key -> { ids, source } | null

    // accepts https://open.spotify.com/track/<id>?..., spotify:track:<id>, or a bare 22-character id
    const parseSpotifyTrackId = (text) => {
        // an album, playlist or artist link is not a track
        if (/spotify/i.test(text || '') && !/track/i.test(text)) return null;
        const m = (text || '').trim().match(/(?:track[\/:])?([A-Za-z0-9]{22})(?:[?#\s]|$)/);
        return m ? m[1] : null;
    };

    // [title, artist] as the uploader wrote them, plus the other reading of uploads titled "Artist - Song"
    const songNamePairs = (np) => {
        const pairs = [[cleanSongTitle(np.title), cleanArtistName(np.artist)]];
        const dash = np.title.split(/\s+[-\u2013\u2014]\s+/);
        if (dash.length === 2) pairs.push([cleanSongTitle(dash[1]), cleanArtistName(dash[0])]);
        return pairs.filter(([title, artist]) => title && artist);
    };

    // MusicBrainz is an open music database. It asks for at most one request a second.
    const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    let mbNextAt = 0;
    const mbGet = async (url) => {
        for (let attempt = 0; ; attempt++) {
            const wait = mbNextAt - Date.now();
            if (wait > 0) await pause(wait);
            mbNextAt = Date.now() + 1100;
            const res = await fetch(url);
            if (res.ok) return res.json();
            // 503 is MusicBrainz saying "slow down": wait and ask again, twice at most
            if (res.status !== 503 || attempt >= 2) throw new Error(`MusicBrainz answered ${res.status}`);
            await pause(2000 * (attempt + 1));
        }
    };

    // recordings with this title and artist that are the same length as what is playing
    const findMusicBrainzRecordings = async (np) => {
        const quote = (text) => `"${text.replace(/["\\]/g, ' ')}"`;
        for (const [title, artist] of songNamePairs(np)) {
            const query = `recording:${quote(title)} AND artist:${quote(artist)}`;
            const found = await mbGet(`https://musicbrainz.org/ws/2/recording?fmt=json&limit=8&query=${encodeURIComponent(query)}`);
            // same recording = close in length (or MusicBrainz has no length for it)
            const ids = (found.recordings || [])
                .filter(r => !np.duration || !r.length || Math.abs(r.length / 1000 - np.duration) <= 4)
                .slice(0, 4).map(r => r.id);
            if (ids.length) return ids;
        }
        return [];
    };

    // a few MusicBrainz recordings carry a link to the same track on Spotify
    const spotifyLinksOnMusicBrainz = async (recordings) => {
        for (const id of recordings) {
            const detail = await mbGet(`https://musicbrainz.org/ws/2/recording/${id}?fmt=json&inc=url-rels`);
            for (const rel of detail.relations || []) {
                const m = rel.url && rel.url.resource && rel.url.resource.match(/open\.spotify\.com\/track\/([A-Za-z0-9]{22})/);
                if (m) return [m[1]];
            }
        }
        return [];
    };

    // ListenBrainz (MusicBrainz's sister project) keeps a table of which Spotify tracks are which songs.
    // kind 'mbid': rows of { recording_mbid }.  kind 'metadata': rows of { artist_name, release_name, track_name }.
    const lbSpotifyIds = async (kind, rows) => {
        if (!rows.length) return [];
        const res = await fetch(`https://labs.api.listenbrainz.org/spotify-id-from-${kind}/json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(rows)
        });
        if (!res.ok) throw new Error(`ListenBrainz answered ${res.status}`);
        const data = await res.json();
        return (Array.isArray(data) ? data : []).flatMap(row => row.spotify_track_ids || []);
    };

    // Apple's public song search forgives spelling and stage names ("Les" by Donald Glover finds "L.E.S."
    // by Childish Gambino). Its hit supplies the official artist / album / track names to ask ListenBrainz with.
    const findOnAppleSearch = async (np) => {
        for (const [title, artist] of songNamePairs(np)) {
            const res = await fetch(`https://itunes.apple.com/search?entity=song&limit=8&term=${encodeURIComponent(`${artist} ${title}`)}`);
            if (!res.ok) throw new Error(`Apple search answered ${res.status}`);
            const want = plainKey(title);
            const hit = ((await res.json()).results || []).find((r) => {
                const got = plainKey(r.trackName);
                if (!got || !(got === want || (want.length > 3 && (got.includes(want) || want.includes(got))))) return false;
                // same recording = close in length; with no length to go on, the artist has to match instead
                if (np.duration && r.trackTimeMillis) return Math.abs(r.trackTimeMillis / 1000 - np.duration) <= 4;
                return plainKey(r.artistName).includes(plainKey(artist));
            });
            if (hit) return [
                { artist_name: hit.artistName, release_name: hit.collectionName || '', track_name: hit.trackName },
                { artist_name: hit.artistName, release_name: '', track_name: hit.trackName }
            ];
        }
        return [];
    };

    // Which Spotify track is this song? A link you pasted wins. Otherwise, in order: MusicBrainz recordings
    // looked up on ListenBrainz, ListenBrainz by name, Apple's search + ListenBrainz, and last (it is slow)
    // the Spotify links stored on MusicBrainz itself. Returns { ids, source }: one song can be on Spotify
    // under several ids, and Spicy Lyrics may only know one of them.
    const resolveSpotifyId = async (np) => {
        const key = `${np.artist}|${np.title}`;
        if (spotifyIds[key] && spotifyIds[key].id) return { ids: [spotifyIds[key].id], source: spotifyIds[key].source, saved: true };
        if (spotifyLookups.has(key)) return spotifyLookups.get(key);
        let recordings = [];
        const steps = [
            ['musicbrainz', async () => { recordings = await findMusicBrainzRecordings(np); return lbSpotifyIds('mbid', recordings.map(id => ({ recording_mbid: id }))); }],
            ['listenbrainz', () => lbSpotifyIds('metadata', songNamePairs(np).map(([title, artist]) => ({ artist_name: artist, release_name: '', track_name: title })))],
            ['apple', async () => lbSpotifyIds('metadata', await findOnAppleSearch(np))],
            ['musicbrainz', () => spotifyLinksOnMusicBrainz(recordings)]
        ];
        let lookupFailed = false; // a failed lookup is retried next time; only a clean "not there" is remembered
        for (const [source, step] of steps) {
            try {
                const ids = [...new Set(await step())].slice(0, 4);
                if (ids.length) { const match = { ids, source }; spotifyLookups.set(key, match); return match; }
            } catch (e) { lookupFailed = true; }
        }
        if (!lookupFailed) spotifyLookups.set(key, null);
        return null;
    };

    const fetchSpicyLyrics = async (np) => {
        if (!lyricKeys.spicy) { lyricSourceStatus = ''; return null; }
        try {
            const match = await resolveSpotifyId(np);
            if (!match) { lyricSourceStatus = 'Last song: no Spotify match found. Paste its Spotify link below to use Spicy Lyrics for it.'; return null; }
            const how = { manual: 'your link', musicbrainz: 'MusicBrainz', listenbrainz: 'ListenBrainz', apple: 'Apple search' }[match.source] || match.source;
            for (const id of match.ids) {
                const res = await fetch(`https://api.spicylyrics.org/v1/lyrics/${id}`, { headers: { Authorization: `Bearer ${lyricKeys.spicy}` } });
                if (res.status === 404) continue;
                if (!res.ok) throw new Error(`Spicy Lyrics answered ${res.status}`);
                const data = await res.json();
                const lyricsData = data && data.Body ? spicyToLyrics(data.Body) : null;
                if (!lyricsData) continue;
                // remember the id that worked, so the lookup is not repeated next time
                if (!match.saved) { spotifyIds[`${np.artist}|${np.title}`] = { id, source: match.source }; saveSpotifyIds(); }
                lyricSourceStatus = lyricsData.synced
                    ? `Last song: loaded from Spicy Lyrics (matched via ${how}).`
                    : `Last song: Spicy Lyrics (matched via ${how}) only has untimed text for it, so timed lyrics from LRCLIB are shown instead when there are any.`;
                return lyricsData;
            }
            lyricSourceStatus = `Last song: matched via ${how}, but Spicy Lyrics has no lyrics for it.`;
            return null;
        } catch (e) {
            // Spicy Lyrics' error replies (a wrong or deleted key, too many requests) lack the header that lets
            // this page read them, so the browser only reports a failed request
            lyricSourceStatus = e instanceof TypeError
                ? 'Last song: Spicy Lyrics refused the request. The key may be wrong or deleted, soundcloud.com may not be an allowed origin for it, or it hit its request limit. Check the key on developers.spicylyrics.org.'
                : `Last song: ${String((e && e.message) || e)}.`;
            return null;
        }
    };

    // Lines without word timings (LRCLIB) get estimated ones: the line's time is shared out by word length
    const addEstimatedWords = (lines) => {
        lines.forEach((line, i) => {
            if (line.words || !line.text) return;
            const parts = line.text.split(/\s+/).filter(Boolean);
            const next = lines[i + 1];
            const span = Math.min(next ? Math.max(0.4, next.t - line.t) : 4, Math.max(1.2, parts.length * 0.55));
            const total = parts.reduce((sum, w) => sum + w.length + 1, 0);
            let at = line.t;
            line.words = parts.map((text) => {
                const len = span * (text.length + 1) / total;
                const word = { t: at, e: at + len, text, glue: false };
                at += len;
                return word;
            });
        });
        return lines;
    };

    const fillLyrics = (target, content) => {
        const { box, plainOn } = target;
        if (typeof content === 'string') {
            plainOn.classList.remove('sc-ly-plain');
            box.innerHTML = '<div class="sc-ly-empty"></div>';
            box.firstChild.textContent = content;
            return;
        }
        plainOn.classList.toggle('sc-ly-plain', !content.synced);
        box.innerHTML = '<div class="sc-ly-scroll"></div>';
        const scroll = box.firstChild;
        scroll.addEventListener('wheel', () => { lyrics.lastWheel = Date.now(); }, { passive: true });
        content.lines.forEach((line) => {
            const el = document.createElement('div');
            el.className = 'sc-ly-line' + (line.right ? ' sc-ly-right' : '');
            if (content.synced && line.words && line.words.length) {
                // one span per word (or syllable) so each can light up as it is sung
                el._words = [];
                let holder = el;      // the lead line itself, or a backing-vocal block inside it
                let group = 0;
                let joined = null;    // wrapper keeping the syllables of one word on the same row
                line.words.forEach((word, n) => {
                    if ((word.bg || 0) !== group) {
                        group = word.bg || 0;
                        holder = document.createElement('div');
                        holder.className = 'sc-ly-bg';
                        el.appendChild(holder);
                        joined = null;
                    }
                    const span = document.createElement('span');
                    span.className = 'sc-w';
                    // one inline span per letter, so each lights up and lifts in turn
                    const letters = Array.from(word.text || '').map((ch) => {
                        const l = document.createElement('span');
                        l.className = 'sc-l';
                        l.textContent = ch;
                        span.appendChild(l);
                        return { el: l, shown: '' };
                    });
                    el._words.push({ span, letters });
                    const prev = line.words[n - 1];
                    const continues = prev && prev.glue && (prev.bg || 0) === group;
                    if (word.glue || continues) {
                        if (!continues) { joined = document.createElement('span'); joined.className = 'sc-word'; holder.appendChild(joined); }
                        joined.appendChild(span);
                    } else {
                        holder.appendChild(span);
                    }
                    if (!word.glue) holder.appendChild(document.createTextNode(' '));
                });
            } else {
                el.textContent = line.text || (content.synced ? '♪' : ' ');
            }
            if (content.synced) el.addEventListener('click', () => { lyrics.lastWheel = 0; seekTo(Math.max(0, (typeof line.seek === 'number' ? line.seek : line.t) + lyricsOffset()) + 0.05); });
            scroll.appendChild(el);
        });
        const note = document.createElement('div');
        note.className = 'sc-ly-note';
        note.textContent = (content.credit || 'Lyrics from LRCLIB') + (content.synced ? (content.exactWords ? '' : ' • word timing estimated') : ' • not time-synced for this song');
        scroll.appendChild(note);
        scroll.scrollTop = 0;
    };

    // what is currently shown: a status message, or { synced, lines }
    let lyricsShown = 'Play something to see its lyrics';
    const showLyrics = (content) => {
        lyricsShown = content;
        lyrics.active = -1;
        lyricsTargets().forEach(target => fillLyrics(target, content));
    };

    /* ---------- Fullscreen lyrics ----------
       LYF_SCHEMA describes every option once: the settings panel is built from it, and applyLyfSettings()
       turns each value into a data-* attribute (switch / seg) or a CSS variable (range) on #sc-ly-full. */
    const VISIBILITY = [['always', 'Always'], ['hover', 'On hover'], ['off', 'Off']];
    const LYF_SCHEMA = [
        // root: true = applies to the whole site (variable on <html>), not only the fullscreen view
        { section: 'Appearance' },
        { key: 'bgBrightness', type: 'range', label: 'Background brightness', def: 40, min: 5, max: 100, cssVar: '--sc-bg-brightness', scale: 0.01, root: true },
        { key: 'bgBlur', type: 'range', label: 'Background blur', def: 80, min: 0, max: 140, cssVar: '--sc-bg-blur', scale: 1, root: true },
        // library, main page and lyrics panel together. Brightness = how see-through their dark tint is.
        { key: 'panelBrightness', type: 'range', label: 'Panel brightness', def: 25, min: 0, max: 100, cssVar: '--sc-panel-alpha', map: v => (100 - v) / 100, root: true },
        { key: 'panelBlur', type: 'range', label: 'Panel blur', def: 30, min: 0, max: 60, cssVar: '--sc-panel-blur', scale: 1, root: true },
        { key: 'lyricGlow', type: 'range', label: 'Lyrics glow', def: 50, min: 0, max: 100, cssVar: '--sc-ly-glow', scale: 1, root: true },
        { key: 'lyricWeight', type: 'range', label: 'Lyrics weight', def: 600, min: 400, max: 800, step: 100, cssVar: '--sc-ly-weight', scale: 1, root: true },
        // which side lyric lines are set from (and grow from), in the panel and in fullscreen
        { key: 'lyricAlign', type: 'seg', label: 'Lyrics alignment', def: 'center', attr: 'lyAlign', root: true, options: [['left', 'Left'], ['center', 'Middle'], ['right', 'Right']] },
        { section: 'Layout' },
        { key: 'art', type: 'switch', label: 'Show cover art', def: true },
        { key: 'lyrics', type: 'switch', label: 'Show lyrics', def: true },
        { key: 'layout', type: 'seg', label: 'Lyrics position', def: 'right', options: [['left', 'Left'], ['right', 'Right'], ['below', 'Below']] },
        { key: 'centerNoLyrics', type: 'switch', label: 'Centre cover when no lyrics are found', def: true },
        { key: 'artSize', type: 'range', label: 'Cover size', def: 121, min: 40, max: 150, cssVar: '--lyf-art', scale: 0.01 },
        // which point of its half of the screen the cover + title block is pinned to ('' = follow the layout)
        { key: 'anchor', type: 'anchor', label: 'Cover anchor point', def: 'mc' },
        { key: 'lyricSize', type: 'range', label: 'Lyrics size', def: 125, min: 50, max: 180, cssVar: '--lyf-lyric', scale: 0.01 },
        { section: 'Title and artist' },
        { key: 'showTitle', type: 'switch', label: 'Show song title', def: true, attr: 'showTitle' },
        { key: 'showArtist', type: 'switch', label: 'Show artist', def: true, attr: 'showArtist' },
        { key: 'textAlign', type: 'seg', label: 'Alignment', def: 'left', attr: 'textAlign', options: [['left', 'Left'], ['center', 'Middle'], ['right', 'Right']] },
        { key: 'textSize', type: 'range', label: 'Text size', def: 146, min: 50, max: 250, cssVar: '--lyf-text', scale: 0.01 },
        { section: 'Background' },
        { key: 'brightness', type: 'range', label: 'Brightness', def: 45, min: 5, max: 100, cssVar: '--lyf-brightness', scale: 0.01 },
        { key: 'blurAmount', type: 'range', label: 'Blur', def: 70, min: 0, max: 140, cssVar: '--lyf-blur', scale: 1 },
        { key: 'rotate', type: 'switch', label: 'Rotate while playing', def: false },
        { key: 'rotateSpeed', type: 'range', label: 'Rotation speed', def: 4, min: 1, max: 10 },
        { section: 'Controls' },
        { key: 'bar', type: 'seg', label: 'Player bar', def: 'hover', stack: true, options: VISIBILITY },
        { key: 'vol', type: 'seg', label: 'Volume bar', def: 'off', stack: true, options: VISIBILITY },
        { key: 'volPos', type: 'seg', label: 'Volume bar position', def: 'screen-right', stack: true,
            options: [['screen-left', 'Screen left'], ['cover-left', 'Cover left'], ['cover-right', 'Cover right'], ['screen-right', 'Screen right']] }
    ];
    const LYF_OPTIONS = LYF_SCHEMA.filter(o => o.key);

    const lyfSettings = (() => {
        const settings = {};
        LYF_OPTIONS.forEach((o) => { settings[o.key] = o.def; });
        try {
            const saved = JSON.parse(localStorage.getItem('sc-lc-settings') || '{}');
            if (typeof saved.brightness === 'number' && saved.brightness <= 1) saved.brightness = Math.round(saved.brightness * 100); // older format
            if (saved.blur === false && saved.blurAmount === undefined) saved.blurAmount = 0; // blur used to be an on/off switch
            LYF_OPTIONS.forEach((o) => { if (typeof saved[o.key] === typeof o.def) settings[o.key] = saved[o.key]; });
        } catch (e) {}
        return settings;
    })();

    /* ---------- Lyrics timing offsets ----------
       Lyric timestamps are for the official release; a SoundCloud upload can start earlier or later.
       Offsets are in seconds: positive shows lyrics later, negative earlier. One applies to every song,
       and songs you add under Settings > Lyrics each keep their own. */
    const lyricTiming = (() => {
        const timing = { all: 0, songs: {} }; // songs: key -> { title, artist, art, offset }
        try {
            Object.assign(timing, JSON.parse(localStorage.getItem('sc-lc-lyrics-timing') || '{}'));
            // older format: one flat map of key -> seconds, with "*" for every song
            const old = JSON.parse(localStorage.getItem('sc-spotify-lyrics-offsets') || 'null');
            if (old && !localStorage.getItem('sc-lc-lyrics-timing')) {
                Object.keys(old).forEach((key) => {
                    if (key === '*') timing.all = Number(old[key]) || 0;
                    else { const [artist, title] = key.split('|'); timing.songs[key] = { title: title || key, artist: artist || '', art: '', offset: Number(old[key]) || 0 }; }
                });
            }
        } catch (e) {}
        if (!timing.songs || typeof timing.songs !== 'object') timing.songs = {};
        return timing;
    })();
    const saveLyricTiming = () => {
        try { localStorage.setItem('sc-lc-lyrics-timing', JSON.stringify(lyricTiming)); } catch (e) {}
        lyrics.active = -2; // re-evaluate the highlighted line straight away
    };

    const songOffsetKey = () => {
        const np = nowPlaying();
        return np && np.title ? `${np.artist}|${np.title}` : null;
    };

    const lyricsOffset = () => {
        const song = lyricTiming.songs[songOffsetKey()];
        return (Number(lyricTiming.all) || 0) + (song ? Number(song.offset) || 0 : 0);
    };

    // "- [ 0.0 ] +" : get / set read and write the number it edits
    const makeOffsetControl = (get, set) => {
        const wrap = document.createElement('div');
        wrap.className = 'sc-lyf-offset';
        wrap.innerHTML = `
            <button type="button" data-step="-0.1" title="Lyrics 0.1s earlier">${strokeIcon('<line x1="5" y1="12" x2="19" y2="12"/>')}</button>
            <input type="number" step="0.1" inputmode="decimal" title="Seconds. Positive = lyrics later" />
            <button type="button" data-step="0.1" title="Lyrics 0.1s later">${strokeIcon('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>')}</button>
        `;
        const input = wrap.querySelector('input');
        const show = () => { if (document.activeElement !== input) input.value = (Number(get()) || 0).toFixed(1); };
        const store = (value) => { set(Math.round((Number(value) || 0) * 10) / 10); saveLyricTiming(); show(); };
        input.addEventListener('change', () => store(input.value));
        input.addEventListener('keydown', (e) => e.stopPropagation()); // keep SoundCloud's keyboard shortcuts out of it
        wrap.querySelectorAll('button').forEach(b => b.addEventListener('click', () => store((Number(get()) || 0) + Number(b.dataset.step))));
        show();
        return wrap;
    };

    // the list of songs that have their own timing (Settings > Lyrics)
    const renderTimingSongs = () => {
        const list = document.querySelector('#sc-settings .sc-timing-songs');
        if (!list) return;
        list.textContent = '';
        const current = songOffsetKey();
        Object.keys(lyricTiming.songs).forEach((key) => {
            const song = lyricTiming.songs[key];
            const card = document.createElement('div');
            card.className = 'sc-timing-song' + (key === current ? ' sc-current' : '');
            card.innerHTML = `
                <img alt="" />
                <div class="sc-timing-text"><div class="sc-timing-title"></div><div class="sc-timing-artist"></div></div>
            `;
            if (song.art) card.querySelector('img').src = song.art;
            card.querySelector('.sc-timing-title').textContent = cleanTitle(song.title) || song.title;
            card.querySelector('.sc-timing-artist').textContent = song.artist;
            card.appendChild(makeOffsetControl(() => song.offset, (v) => { song.offset = v; }));
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'sc-timing-remove';
            remove.title = 'Remove this song\'s timing';
            remove.innerHTML = strokeIcon('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>');
            remove.addEventListener('click', () => { delete lyricTiming.songs[key]; saveLyricTiming(); renderTimingSongs(); });
            card.appendChild(remove);
            list.appendChild(card);
        });
        if (!list.children.length) {
            const empty = document.createElement('div');
            empty.className = 'sc-lyf-hint';
            empty.textContent = 'No songs yet. Press + while a song is playing to give it its own timing.';
            list.appendChild(empty);
        }
    };

    const addCurrentSongTiming = () => {
        const np = nowPlaying();
        const key = songOffsetKey();
        if (!np || !key) { showToast('Play a song first, then press +', true); return; }
        if (!lyricTiming.songs[key]) {
            const artEl = document.querySelector('.playControls__soundBadge .playbackSoundBadge__avatar span.sc-artwork');
            const m = artEl && window.getComputedStyle(artEl).backgroundImage.match(/url\(["']?(.+?)["']?\)/);
            lyricTiming.songs[key] = { title: np.title, artist: np.artist, art: m ? m[1].replace(/-t\d+x\d+/, '-t120x120') : '', offset: 0 };
            saveLyricTiming();
        }
        renderTimingSongs();
    };

    const refreshOffsetRows = () => {
        const status = document.querySelector('#sc-settings .sc-lyric-status');
        if (status) status.textContent = lyricSourceStatus;
        const linkInput = document.querySelector('#sc-settings .sc-spotify-link');
        if (linkInput && document.activeElement !== linkInput) {
            const known = spotifyIds[songOffsetKey()];
            const shown = known && known.id ? `https://open.spotify.com/track/${known.id}` : '';
            if (linkInput.dataset.shown !== shown) { linkInput.dataset.shown = shown; linkInput.value = shown; }
        }
        // keep the "current song" highlight in step without rebuilding inputs someone may be typing in
        const current = songOffsetKey();
        const keys = Object.keys(lyricTiming.songs);
        document.querySelectorAll('#sc-settings .sc-timing-song').forEach((card, i) => card.classList.toggle('sc-current', keys[i] === current));
    };

    /* ---------- Fullscreen view ignores browser zoom ----------
       The overlay is scaled by 1/zoom so its sizes (and the background blur) look the same at any page zoom.
       devicePixelRatio = OS display scaling x browser zoom; the OS part is worked out once from the window. */
    let osScale = 0;
    const browserZoom = () => {
        if (PHONE) return 1; // a phone's screen scale and pinch zoom are not browser zoom
        const dpr = window.devicePixelRatio || 1;
        if (!osScale) {
            const steps = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
            const rough = window.outerWidth && window.innerWidth ? window.outerWidth / window.innerWidth : 1;
            const zoomNow = steps.reduce((a, b) => (Math.abs(b - rough) < Math.abs(a - rough) ? b : a));
            osScale = dpr / zoomNow;
        }
        return dpr / osScale;
    };

    const updateLyfZoom = () => {
        const full = document.getElementById('sc-ly-full');
        if (full) full.style.setProperty('--lyf-zoom', String(Math.round(browserZoom() * 1000) / 1000));
    };

    const noLyricsFound = () => typeof lyricsShown === 'string' && lyricsShown.startsWith('No lyrics');

    // the volume bar sits inside the cover (so it moves with it) or directly on the overlay (screen edges)
    const placeLyfVolume = (full) => {
        const vol = full.querySelector('.sc-lyf-vol');
        if (!vol) return;
        const artVisible = lyfSettings.art;
        let pos = lyfSettings.volPos;
        if (!artVisible && pos.startsWith('cover')) pos = pos.endsWith('left') ? 'screen-left' : 'screen-right';
        const home = pos.startsWith('cover') ? full.querySelector('.sc-lyf-cover') : full;
        if (vol.parentElement !== home) home.appendChild(vol);
        vol.dataset.pos = pos;
    };

    // Settings live in one panel (#sc-settings) opened from the top bar or from the fullscreen view.
    // Values are saved straight away; they are applied to the fullscreen view whenever it exists.
    const applyLyfSettings = () => {
        const full = document.getElementById('sc-ly-full');
        const panel = document.getElementById('sc-settings');
        LYF_OPTIONS.forEach((o) => {
            const value = lyfSettings[o.key];
            if (o.root) {
                if (o.type === 'range') document.documentElement.style.setProperty(o.cssVar, String(o.map ? o.map(value) : value * o.scale));
                else document.documentElement.dataset[o.attr || o.key] = value;
            } else if (full) {
                if (o.type === 'range') {
                    if (o.cssVar) full.style.setProperty(o.cssVar, String(value * o.scale));
                } else {
                    full.dataset[o.attr || o.key] = o.type === 'switch' ? (value ? 'on' : 'off') : value;
                }
            }
            const row = panel && panel.querySelector(`.sc-lyf-set[data-key="${o.key}"]`);
            if (!row) return;
            if (o.type === 'switch') row.querySelector('.sc-lyf-switch').classList.toggle('sc-on', !!value);
            else if (o.type === 'seg') row.querySelectorAll('.sc-lyf-seg button').forEach(b => b.classList.toggle('sc-on', b.dataset.value === value));
            else if (o.type === 'anchor') row.querySelectorAll('.sc-lyf-anchor button').forEach(b => b.classList.toggle('sc-on', b.dataset.value === value));
            else row.querySelector('input').value = String(value);
        });
        document.body.dataset.lyfBar = lyfSettings.bar;
        if (full) {
            full.style.setProperty('--lyf-spin', `${Math.round(240 / lyfSettings.rotateSpeed)}s`); // 1 = 4 min per turn, 10 = 24 s
            full.dataset.nolyrics = lyfSettings.centerNoLyrics && lyfSettings.art && noLyricsFound() ? 'on' : 'off';
            placeLyfVolume(full);
        }
        try { localStorage.setItem('sc-lc-settings', JSON.stringify(lyfSettings)); } catch (e) {}
    };

    const SETTINGS_TAB_NAMES = { 'Appearance': 'Appearance', 'Layout': 'Layout', 'Title and artist': 'Text', 'Background': 'Background', 'Controls': 'Controls' };
    const FULLSCREEN_TABS = ['Layout', 'Text', 'Background']; // these only affect the fullscreen lyrics view

    const buildLyfSettings = (panel) => {
        panel.innerHTML = '<div class="sc-set-caption">Settings</div><div class="sc-set-tabs"></div>';
        const tabs = panel.querySelector('.sc-set-tabs');
        let pane = null;

        const addTab = (name) => {
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.textContent = name;
            pane = document.createElement('div');
            pane.className = 'sc-set-pane';
            const thisPane = pane;
            tab.addEventListener('click', () => {
                tabs.querySelectorAll('button').forEach(b => b.classList.toggle('sc-on', b === tab));
                panel.querySelectorAll('.sc-set-pane').forEach(p => p.classList.toggle('sc-on', p === thisPane));
            });
            tabs.appendChild(tab);
            panel.appendChild(pane);
            if (tabs.children.length === 1) { tab.classList.add('sc-on'); pane.classList.add('sc-on'); }
            if (FULLSCREEN_TABS.includes(name)) {
                const note = document.createElement('div');
                note.className = 'sc-set-note';
                note.textContent = 'For the fullscreen lyrics view.';
                pane.appendChild(note);
            }
        };

        LYF_SCHEMA.forEach((o) => {
            if (o.section) { addTab(SETTINGS_TAB_NAMES[o.section] || o.section); return; }
            const row = document.createElement('div');
            row.className = 'sc-lyf-set' + (o.stack ? ' sc-stack' : '');
            row.dataset.key = o.key;
            const label = document.createElement('span');
            label.textContent = o.label;
            row.appendChild(label);
            if (o.type === 'switch') {
                const sw = document.createElement('button');
                sw.type = 'button';
                sw.className = 'sc-lyf-switch';
                sw.addEventListener('click', () => {
                    lyfSettings[o.key] = !lyfSettings[o.key];
                    // never hide both the cover and the lyrics
                    if (!lyfSettings.art && !lyfSettings.lyrics) lyfSettings[o.key === 'art' ? 'lyrics' : 'art'] = true;
                    applyLyfSettings();
                });
                row.appendChild(sw);
            } else if (o.type === 'seg') {
                const seg = document.createElement('div');
                seg.className = 'sc-lyf-seg';
                o.options.forEach(([value, text]) => {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.dataset.value = value;
                    b.textContent = text;
                    b.addEventListener('click', () => { lyfSettings[o.key] = value; applyLyfSettings(); });
                    seg.appendChild(b);
                });
                row.appendChild(seg);
            } else if (o.type === 'anchor') {
                // 3x3 grid, like the anchor picker in Motion Tools; click the chosen cell again to clear it
                const grid = document.createElement('div');
                grid.className = 'sc-lyf-anchor';
                ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'].forEach((value) => {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.dataset.value = value;
                    b.title = { t: 'Top', m: 'Middle', b: 'Bottom' }[value[0]] + ' ' + { l: 'left', c: 'centre', r: 'right' }[value[1]];
                    b.addEventListener('click', () => { lyfSettings[o.key] = lyfSettings[o.key] === value ? '' : value; applyLyfSettings(); });
                    grid.appendChild(b);
                });
                row.appendChild(grid);
            } else {
                const input = document.createElement('input');
                input.type = 'range';
                input.min = String(o.min);
                input.max = String(o.max);
                input.step = String(o.step || 1);
                input.addEventListener('input', () => { lyfSettings[o.key] = Number(input.value); applyLyfSettings(); });
                row.appendChild(input);
            }
            pane.appendChild(row);
        });

        addTab('Lyrics');
        const lyricPane = pane;

        const timingHead = document.createElement('h3');
        timingHead.textContent = 'Timing';
        lyricPane.appendChild(timingHead);
        const allRow = document.createElement('div');
        allRow.className = 'sc-lyf-set';
        allRow.innerHTML = '<span>Every song</span>';
        allRow.appendChild(makeOffsetControl(() => lyricTiming.all, (v) => { lyricTiming.all = v; }));
        lyricPane.appendChild(allRow);

        const songsHead = document.createElement('div');
        songsHead.className = 'sc-lyf-set';
        songsHead.innerHTML = `<span>Songs with their own timing</span><button type="button" class="sc-timing-add" title="Add the song that is playing">${strokeIcon('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>')}</button>`;
        songsHead.querySelector('button').addEventListener('click', addCurrentSongTiming);
        lyricPane.appendChild(songsHead);
        const songList = document.createElement('div');
        songList.className = 'sc-timing-songs';
        lyricPane.appendChild(songList);
        const hint = document.createElement('div');
        hint.className = 'sc-lyf-hint';
        hint.textContent = 'Seconds. Plus shows lyrics later, minus earlier.';
        lyricPane.appendChild(hint);

        // Spicy Lyrics: needs your own keys (see the comment above fetchSpicyLyrics)
        const sourceHead = document.createElement('h3');
        sourceHead.textContent = 'Spicy Lyrics (word-by-word)';
        lyricPane.appendChild(sourceHead);
        const keyRow = document.createElement('div');
        keyRow.className = 'sc-lyf-set sc-stack';
        keyRow.innerHTML = '<span>Spicy Lyrics key</span><input type="password" class="sc-key-input" autocomplete="off" spellcheck="false" placeholder="sl_pk_\u2026" />';
        const keyInput = keyRow.querySelector('input');
        keyInput.value = lyricKeys.spicy;
        keyInput.addEventListener('keydown', (e) => e.stopPropagation());
        keyInput.addEventListener('change', () => {
            lyricKeys.spicy = keyInput.value.trim();
            saveLyricKeys();
            lyricsCache.clear(); // look songs up again with the new key
            lyrics.key = null;
        });
        lyricPane.appendChild(keyRow);
        const linkRow = document.createElement('div');
        linkRow.className = 'sc-lyf-set sc-stack';
        linkRow.innerHTML = '<span>Spotify link for the song that is playing</span><div class="sc-link-row"><input type="text" class="sc-key-input sc-spotify-link" placeholder="https://open.spotify.com/track/\u2026" autocomplete="off" spellcheck="false" /><button type="button" class="sc-link-search" title="Look this song up on Spotify">Search</button><button type="button" class="sc-link-save">Save</button><button type="button" class="sc-link-clear">Clear</button></div>';
        const linkInput = linkRow.querySelector('input');
        linkInput.addEventListener('keydown', (e) => e.stopPropagation());
        const refetch = () => { lyricsCache.clear(); spotifyLookups.clear(); lyrics.key = null; };
        linkRow.querySelector('.sc-link-search').addEventListener('click', () => {
            const np = nowPlaying();
            if (!np || !np.title) { showToast('Play the song first, then search for it', true); return; }
            const [title, artist] = songNamePairs(np)[0] || [cleanSongTitle(np.title) || np.title, ''];
            window.open(`https://open.spotify.com/search/${encodeURIComponent(`${title} ${artist}`.trim())}`, '_blank', 'noopener');
        });
        linkRow.querySelector('.sc-link-save').addEventListener('click', () => {
            const key = songOffsetKey();
            const id = parseSpotifyTrackId(linkInput.value);
            if (!key) { showToast('Play the song first, then paste its link', true); return; }
            if (!id) { showToast('That does not look like a Spotify track link', true); return; }
            spotifyIds[key] = { id, source: 'manual' };
            saveSpotifyIds();
            refetch();
            showToast('Linked. Looking for Spicy Lyrics\u2026');
        });
        linkRow.querySelector('.sc-link-clear').addEventListener('click', () => {
            const key = songOffsetKey();
            if (key && spotifyIds[key]) { delete spotifyIds[key]; saveSpotifyIds(); }
            linkInput.value = '';
            refetch();
        });
        lyricPane.appendChild(linkRow);

        const status = document.createElement('div');
        status.className = 'sc-lyf-hint sc-lyric-status';
        lyricPane.appendChild(status);
        const help = document.createElement('div');
        help.className = 'sc-lyf-hint';
        help.innerHTML = 'The key is the client key (sl_pk_\u2026) from <a href="https://developers.spicylyrics.org" target="_blank" rel="noopener">developers.spicylyrics.org</a>, with https://soundcloud.com as an allowed origin. Spicy Lyrics looks songs up by their Spotify track, which the script finds on its own when it can. For a song it cannot match, press Search, copy the song\u2019s link on Spotify (Share \u2192 Copy Song Link) and save it above. Everything is stored only in this browser.';
        lyricPane.appendChild(help);

        // Your TTML (see parseTtml)
        const ttmlHead = document.createElement('h3');
        ttmlHead.textContent = 'Your TTML';
        lyricPane.appendChild(ttmlHead);
        const ttmlHint = document.createElement('div');
        ttmlHint.className = 'sc-lyf-hint';
        ttmlHint.textContent = 'Check a TTML file against the song before submitting it to Spicy Lyrics: play the song, then load the file. Temporary lasts until the song changes; Keep uses it every time this song plays.';
        lyricPane.appendChild(ttmlHint);
        const ttmlRow = document.createElement('div');
        ttmlRow.className = 'sc-lyf-set';
        ttmlRow.innerHTML = '<div class="sc-lyf-seg sc-ttml-mode"><button type="button" data-mode="temp" class="sc-on">Temporary</button><button type="button" data-mode="keep">Keep</button></div><button type="button" class="sc-link-save sc-ttml-load">Load TTML\u2026</button><input type="file" accept=".ttml,.xml,application/ttml+xml" hidden />';
        let ttmlMode = 'temp';
        ttmlRow.querySelectorAll('.sc-ttml-mode button').forEach(b => b.addEventListener('click', () => {
            ttmlMode = b.dataset.mode;
            ttmlRow.querySelectorAll('.sc-ttml-mode button').forEach(x => x.classList.toggle('sc-on', x === b));
        }));
        const ttmlInput = ttmlRow.querySelector('input');
        ttmlRow.querySelector('.sc-ttml-load').addEventListener('click', () => {
            const np = nowPlaying();
            if (!np || !np.title) { showToast('Play the song first, then load its TTML', true); return; }
            ttmlInput.value = '';
            ttmlInput.click();
        });
        lyricPane.appendChild(ttmlRow);
        const ttmlStatus = document.createElement('div');
        ttmlStatus.className = 'sc-lyf-hint sc-ttml-status';
        lyricPane.appendChild(ttmlStatus);
        const ttmlKept = document.createElement('div');
        ttmlKept.className = 'sc-timing-songs sc-ttml-kept';
        lyricPane.appendChild(ttmlKept);

        const renderTtmlKept = () => {
            ttmlKept.textContent = '';
            Object.entries(ttmlLibrary).forEach(([key, entry]) => {
                const row = document.createElement('div');
                row.className = 'sc-lyf-set';
                const label = document.createElement('span');
                const [artist, title] = key.split('|');
                label.textContent = `${title} \u2014 ${artist} (${entry.name})`;
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.className = 'sc-link-clear';
                remove.textContent = 'Remove';
                remove.addEventListener('click', () => {
                    delete ttmlLibrary[key];
                    saveTtmlLibrary();
                    lyrics.key = null; // the song's normal lyrics come back
                    renderTtmlKept();
                });
                row.append(label, remove);
                ttmlKept.appendChild(row);
            });
        };
        renderTtmlKept();

        ttmlInput.addEventListener('change', async () => {
            const file = ttmlInput.files && ttmlInput.files[0];
            const np = nowPlaying();
            if (!file || !np || !np.title) return;
            const text = await file.text();
            const result = parseTtml(text, file.name);
            const lines = result.data ? result.data.lines.length : 0;
            ttmlStatus.textContent = result.fatal
                ? `Not loaded: ${result.problems.join(' ')}`
                : `${file.name}: ${lines} lines, ${result.data.exactWords ? 'word' : result.data.synced ? 'line' : 'no'} timing` +
                  (result.problems.length ? `. Check: ${result.problems.slice(0, 6).join(' ')}${result.problems.length > 6 ? ` (+${result.problems.length - 6} more)` : ''}` : '. No problems found.');
            if (result.fatal) return;
            const key = ttmlSongKey(np);
            if (ttmlMode === 'keep') {
                ttmlLibrary[key] = { name: file.name, text, at: Date.now() };
                if (!saveTtmlLibrary()) return;
                ttmlTemporary = null;
                renderTtmlKept();
            } else {
                ttmlTemporary = { key, name: file.name, text };
            }
            lyrics.key = null; // show it straight away
            showToast(`Showing ${file.name} for this song${ttmlMode === 'keep' ? ' (kept)' : ''}`);
        });
        renderTimingSongs();


        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'sc-lyf-reset';
        reset.textContent = 'Reset to defaults';
        reset.addEventListener('click', () => {
            LYF_OPTIONS.forEach((o) => { lyfSettings[o.key] = o.def; });
            applyLyfSettings();
        });
        panel.appendChild(reset);
    };

    const toggleSettings = (force) => {
        let panel = document.getElementById('sc-settings');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'sc-settings';
            panel.className = 'sc-lyf-settings';
            buildLyfSettings(panel);
            document.body.appendChild(panel);
            // click anywhere else closes it
            document.addEventListener('mousedown', (e) => {
                if (!panel.classList.contains('sc-open')) return;
                if (panel.contains(e.target) || (e.target.closest && e.target.closest('[data-act="settings"]'))) return;
                panel.classList.remove('sc-open');
            });
        }
        const open = typeof force === 'boolean' ? force : !panel.classList.contains('sc-open');
        panel.classList.toggle('sc-open', open);
        if (open) { applyLyfSettings(); renderTimingSongs(); refreshOffsetRows(); }
        if (open && document.getElementById('sc-notes')) document.getElementById('sc-notes').classList.remove('sc-open');
    };

    /* ---------- Notifications ----------
       SoundCloud's own bell lives in its header, which this script hides. This replaces it: a bell in the top
       bar with a count of new activity, and a panel listing it, from the same API SoundCloud's notifications
       page uses (api-v2 /activities, /activities/<filter> for one kind). "New" means newer than the last time
       the panel was opened, remembered in this browser. */
    const NOTE_FILTERS = [['all', 'All'], ['likes', 'Likes'], ['reposts', 'Reposts'], ['follows', 'Follows'], ['comments', 'Comments']];
    const notes = { filter: 'all', items: [], next: null, loading: false, unread: 0, seen: 0, seenBefore: 0, request: 0 };
    try { notes.seen = Number(localStorage.getItem('sc-notes-seen')) || 0; } catch (e) {}
    const noteTime = (a) => new Date(a.created_at).getTime() || 0;
    const pathOf = (url) => { try { return new URL(url).pathname; } catch (e) { return null; } };

    // what happened, and what it happened to
    const describeNote = (a) => {
        switch (a.type) {
            case 'track-like': return ['liked your track', a.track];
            case 'playlist-like': return ['liked your playlist', a.playlist];
            case 'track-repost': return ['reposted your track', a.track];
            case 'playlist-repost': return ['reposted your playlist', a.playlist];
            case 'comment': return ['commented on', a.comment && a.comment.track];
            case 'mention': return ['mentioned you on', a.comment && a.comment.track];
            case 'affiliation': return ['started following you', null];
            default: return [String(a.type || 'did something').replace(/-/g, ' '), a.track || a.playlist || null];
        }
    };

    const renderNoteBadge = () => {
        const badge = document.querySelector('.sc-note-badge');
        if (!badge) return;
        badge.textContent = notes.unread > 9 ? '9+' : String(notes.unread);
        badge.classList.toggle('sc-on', notes.unread > 0);
    };

    // count what is new since the panel was last opened (every two minutes, and when the page loads)
    const checkNotes = async () => {
        if (!oauthToken()) return;
        try {
            const data = await api('activities?limit=20&linked_partitioning=1');
            const items = data.collection || [];
            const newest = items.length ? Math.max(...items.map(noteTime)) : 0;
            if (!notes.seen) { notes.seen = newest; try { localStorage.setItem('sc-notes-seen', String(newest)); } catch (e) {} }
            notes.unread = items.filter(a => noteTime(a) > notes.seen).length;
            renderNoteBadge();
        } catch (e) {}
    };

    const noteLink = (text, url, cls) => {
        const a = document.createElement('a');
        a.className = cls;
        a.textContent = text || '';
        const path = url && pathOf(url);
        if (path) {
            a.href = path;
            a.addEventListener('click', (e) => { e.preventDefault(); toggleNotes(false); navigate(path); });
        }
        return a;
    };

    const noteRow = (a) => {
        const [verb, target] = describeNote(a);
        const user = a.user || {};
        const row = document.createElement('div');
        row.className = 'sc-note' + (noteTime(a) > notes.seenBefore ? ' sc-new' : '');
        const avatar = document.createElement('img');
        avatar.className = 'sc-note-avatar';
        avatar.alt = '';
        if (user.avatar_url) avatar.src = user.avatar_url.replace('-large', '-t50x50');
        row.appendChild(avatar);
        const text = document.createElement('div');
        text.className = 'sc-note-body';
        const line = document.createElement('div');
        line.className = 'sc-note-line';
        line.appendChild(noteLink(user.username || 'Someone', user.permalink_url, 'sc-note-user'));
        line.appendChild(document.createTextNode(` ${verb} `));
        if (target) line.appendChild(noteLink(target.title, target.permalink_url, 'sc-note-target'));
        text.appendChild(line);
        if ((a.type === 'comment' || a.type === 'mention') && a.comment && a.comment.body) {
            const quote = document.createElement('div');
            quote.className = 'sc-note-quote';
            quote.textContent = a.comment.body;
            text.appendChild(quote);
        }
        const when = document.createElement('div');
        when.className = 'sc-note-time';
        when.textContent = timeAgo(a.created_at);
        text.appendChild(when);
        row.appendChild(text);
        const art = target && (target.artwork_url || (target.user && target.user.avatar_url));
        if (art) {
            const img = document.createElement('img');
            img.className = 'sc-note-art';
            img.alt = '';
            img.src = art.replace('-large', '-t50x50');
            row.appendChild(img);
        }
        return row;
    };

    const renderNotes = () => {
        const panel = document.getElementById('sc-notes');
        if (!panel) return;
        panel.querySelectorAll('.sc-note-filters button').forEach(b => b.classList.toggle('sc-on', b.dataset.filter === notes.filter));
        const list = panel.querySelector('.sc-note-list');
        list.textContent = '';
        notes.items.forEach(a => list.appendChild(noteRow(a)));
        const foot = document.createElement('div');
        foot.className = 'sc-note-empty';
        foot.textContent = !oauthToken() ? 'Sign in to see your notifications.'
            : notes.loading ? 'Loading\u2026'
            : notes.error ? 'Could not load notifications. Try again in a moment.'
            : !notes.items.length ? 'Nothing here yet.' : '';
        if (foot.textContent) list.appendChild(foot);
    };

    const loadNotes = async (more) => {
        if (!oauthToken()) { renderNotes(); return; }
        if (notes.loading || (more && !notes.next)) return;
        const request = ++notes.request;
        notes.loading = true;
        notes.error = false;
        if (!more) { notes.items = []; notes.next = null; }
        renderNotes();
        try {
            const data = await api(more ? notes.next : `activities${notes.filter === 'all' ? '' : '/' + notes.filter}?limit=25&linked_partitioning=1`);
            if (request !== notes.request) return;
            notes.items = notes.items.concat(data.collection || []);
            notes.next = data.next_href || null;
        } catch (e) {
            if (request === notes.request) notes.error = true;
        }
        if (request !== notes.request) return;
        notes.loading = false;
        renderNotes();
    };

    const toggleNotes = (force) => {
        let panel = document.getElementById('sc-notes');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'sc-notes';
            panel.innerHTML = '<div class="sc-set-caption">Notifications</div><div class="sc-note-filters"></div><div class="sc-note-list"></div><a class="sc-note-all" href="/notifications">Open the notifications page</a>';
            const filters = panel.querySelector('.sc-note-filters');
            NOTE_FILTERS.forEach(([value, text]) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.dataset.filter = value;
                b.textContent = text;
                b.addEventListener('click', () => { if (notes.filter !== value) { notes.filter = value; loadNotes(false); } });
                filters.appendChild(b);
            });
            const list = panel.querySelector('.sc-note-list');
            list.addEventListener('scroll', () => {
                if (list.scrollTop + list.clientHeight > list.scrollHeight - 120) loadNotes(true);
            }, { passive: true });
            panel.querySelector('.sc-note-all').addEventListener('click', (e) => { e.preventDefault(); toggleNotes(false); navigate('/notifications'); });
            document.body.appendChild(panel);
            document.addEventListener('mousedown', (e) => {
                if (!panel.classList.contains('sc-open')) return;
                if (panel.contains(e.target) || (e.target.closest && e.target.closest('[data-act="notes"]'))) return;
                panel.classList.remove('sc-open');
            });
        }
        const open = typeof force === 'boolean' ? force : !panel.classList.contains('sc-open');
        panel.classList.toggle('sc-open', open);
        if (!open) return;
        toggleSettings(false);
        // everything listed now counts as seen; it stays highlighted until the panel is opened again
        notes.seenBefore = notes.seen;
        notes.seen = Date.now();
        try { localStorage.setItem('sc-notes-seen', String(notes.seen)); } catch (e) {}
        notes.unread = 0;
        renderNoteBadge();
        loadNotes(false);
    };

    /* ---------- Small dialogs (import notice, new playlist) ---------- */
    const showDialog = ({ title, text, build, confirmText, onConfirm }) => {
        const backdrop = document.createElement('div');
        backdrop.className = 'sc-dialog-backdrop';
        backdrop.innerHTML = `
            <div class="sc-dialog" role="dialog" aria-modal="true">
                <h2></h2>
                <p></p>
                <div class="sc-dialog-body"></div>
                <div class="sc-dialog-error"></div>
                <div class="sc-dialog-actions">
                    <button type="button" class="sc-dialog-cancel">Cancel</button>
                    <button type="button" class="sc-dialog-ok"></button>
                </div>
            </div>
        `;
        backdrop.querySelector('h2').textContent = title;
        backdrop.querySelector('p').textContent = text || '';
        const ok = backdrop.querySelector('.sc-dialog-ok');
        ok.textContent = confirmText;
        const error = backdrop.querySelector('.sc-dialog-error');
        const close = () => backdrop.remove();
        if (build) build(backdrop.querySelector('.sc-dialog-body'));
        backdrop.querySelector('.sc-dialog-cancel').addEventListener('click', close);
        backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
        backdrop.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); });
        ok.addEventListener('click', async () => {
            ok.disabled = true;
            error.textContent = '';
            try {
                const done = await onConfirm(backdrop);
                if (done !== false) close();
            } catch (e) {
                error.textContent = String((e && e.message) || e);
            }
            ok.disabled = false;
        });
        document.body.appendChild(backdrop);
        const first = backdrop.querySelector('input') || ok;
        first.focus();
    };

    const openImportDialog = () => showDialog({
        title: 'Import your music',
        text: 'You are about to leave SoundCloud for TuneMyMusic, a separate service that copies playlists from other music apps into SoundCloud. It opens in a new tab and will ask you to connect your accounts there.',
        confirmText: 'Continue to TuneMyMusic',
        onConfirm: () => { window.open('https://www.tunemymusic.com/transfer', '_blank', 'noopener'); }
    });

    // SoundCloud has no "new playlist" page; its own site creates playlists with this same API call
    const openCreatePlaylistDialog = () => showDialog({
        title: 'Create playlist',
        text: 'Makes a new, empty playlist on your SoundCloud account.',
        confirmText: 'Create',
        build: (body) => {
            body.innerHTML = `
                <input type="text" class="sc-dialog-input" maxlength="100" placeholder="Playlist name" />
                <label class="sc-dialog-check"><input type="checkbox" checked /> <span>Public</span></label>
            `;
            body.querySelector('.sc-dialog-input').addEventListener('keydown', (e) => {
                if (e.key === 'Enter') body.closest('.sc-dialog').querySelector('.sc-dialog-ok').click();
            });
        },
        onConfirm: async (dialog) => {
            const title = dialog.querySelector('.sc-dialog-input').value.trim();
            if (!title) throw new Error('Give the playlist a name first.');
            const token = oauthToken();
            const hydration = pageHydration();
            const client = Array.isArray(hydration) && hydration.find(item => item && item.hydratable === 'apiClient' && item.data);
            if (!token || !client) throw new Error('You need to be signed in to SoundCloud.');
            const res = await fetch(`https://api-v2.soundcloud.com/playlists?client_id=${client.data.id}`, {
                method: 'POST',
                headers: { Authorization: `OAuth ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ playlist: { title, sharing: dialog.querySelector('.sc-dialog-check input').checked ? 'public' : 'private', tracks: [] } })
            });
            if (!res.ok) throw new Error(`SoundCloud refused the request (${res.status}).`);
            const playlist = await res.json();
            const container = document.getElementById('sc-sidebar-dynamic-container');
            if (container) loadLibraryData(container).catch(() => {});
            if (playlist && playlist.permalink_url) navigate(new URL(playlist.permalink_url).pathname);
        }
    });

    const setupLyfVolume = (vol) => {
        const apply = (e) => {
            const rect = vol.getBoundingClientRect();
            const level = Math.min(1, Math.max(0, 1 - (e.clientY - rect.top) / rect.height));
            vol.querySelector('.sc-lyf-vol-fill').style.height = `${level * 100}%`;
            vol.querySelector('.sc-lyf-vol-knob').style.bottom = `${level * 100}%`;
            setVolume(level);
        };
        vol.addEventListener('pointerdown', (e) => { vol.classList.add('sc-dragging'); vol.setPointerCapture(e.pointerId); apply(e); });
        vol.addEventListener('pointermove', (e) => { if (vol.classList.contains('sc-dragging')) apply(e); });
        const end = () => { vol.classList.remove('sc-dragging'); setTimeout(syncVolume, 300); };
        vol.addEventListener('pointerup', end);
        vol.addEventListener('pointercancel', end);
    };

    const closeLyricsFull = () => {
        const full = document.getElementById('sc-ly-full');
        if (full) full.classList.remove('sc-open');
        document.body.classList.remove('sc-lyf-open');
        toggleSettings(false);
    };

    const openLyricsFull = () => {
        let full = document.getElementById('sc-ly-full');
        if (!full) {
            full = document.createElement('div');
            full.id = 'sc-ly-full';
            full.innerHTML = `
                <div class="sc-lyf-bg"></div>
                <div class="sc-lyf-stage">
                    <div class="sc-lyf-art">
                        <div class="sc-lyf-cover"><img alt="" /></div>
                        <div class="sc-lyf-title"></div>
                        <div class="sc-lyf-artist"></div>
                    </div>
                    <div class="sc-lyf-lyrics"></div>
                </div>
                <div class="sc-lyf-vol" title="Volume"><div class="sc-lyf-vol-track"><div class="sc-lyf-vol-fill"></div><div class="sc-lyf-vol-knob"></div></div></div>
                <div class="sc-lyf-top">
                    <button type="button" data-act="settings" title="Settings">${strokeIcon('<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>')}</button>
                    <button type="button" data-act="close" title="Close (Esc)">${strokeIcon('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>')}</button>
                </div>
            `;
            setupLyfVolume(full.querySelector('.sc-lyf-vol'));
            full.querySelector('[data-act="close"]').addEventListener('click', closeLyricsFull);
            full.querySelector('[data-act="settings"]').addEventListener('click', () => toggleSettings());
            document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLyricsFull(); });
            window.addEventListener('resize', updateLyfZoom); // zooming the page fires resize
            document.body.appendChild(full);
        }
        full.classList.add('sc-open');
        document.body.classList.add('sc-lyf-open');
        full.dataset.track = '';
        updateLyfZoom();
        applyLyfSettings();
        refreshOffsetRows();
        fillLyrics({ box: full.querySelector('.sc-lyf-lyrics'), plainOn: full.querySelector('.sc-lyf-lyrics') }, lyricsShown);
        lyrics.active = -1; // force the highlight + scroll to be re-applied in the new view
        updateLyricsFullMeta();
        syncVolume();
    };

    const updateLyricsFullMeta = () => {
        const full = document.querySelector('#sc-ly-full.sc-open');
        if (!full) return;
        full.classList.toggle('sc-playing', !!document.querySelector('.playControls__play.playing'));
        const noLyrics = lyfSettings.centerNoLyrics && lyfSettings.art && noLyricsFound() ? 'on' : 'off';
        if (full.dataset.nolyrics !== noLyrics) full.dataset.nolyrics = noLyrics;
        const np = nowPlaying();
        const key = np ? `${np.artist}|${np.title}` : '';
        if (full.dataset.track === key) return;
        full.dataset.track = key;
        const art = document.querySelector('.playControls__soundBadge .playbackSoundBadge__avatar span.sc-artwork');
        const m = art && window.getComputedStyle(art).backgroundImage.match(/url\(["']?(.+?)["']?\)/);
        const url = m ? m[1].replace(/-t\d+x\d+/, '-t500x500') : '';
        full.querySelector('.sc-lyf-cover img').src = url;
        full.querySelector('.sc-lyf-bg').style.backgroundImage = url ? `url("${url}")` : 'none';
        full.querySelector('.sc-lyf-title').textContent = np ? (cleanTitle(np.title) || np.title) : '';
        refreshOffsetRows();
        full.querySelector('.sc-lyf-artist').textContent = np ? np.artist : '';
    };

    // aria-valuenow only ticks once a second, so estimate the time in between
    let lyricsClock = { value: -1, at: 0 };
    const estimatePosition = (np) => {
        if (np.position !== lyricsClock.value) lyricsClock = { value: np.position, at: performance.now() };
        const playing = !!document.querySelector('.playControls__play.playing');
        return np.position + (playing ? Math.min((performance.now() - lyricsClock.at) / 1000, 1) : 0);
    };

    // Every line needs an end time. Sources with real end times (Spicy Lyrics) can have lines that overlap,
    // e.g. a lead and a backing vocal; LRCLIB lines simply last until the next one starts.
    const finishLineTimes = (lines) => {
        lines.forEach((line, i) => {
            if (typeof line.end !== 'number' || line.end <= line.t) {
                const next = lines[i + 1];
                line.end = next ? Math.max(next.t, line.t + 0.2) : line.t + 8;
            }
        });
        return lines;
    };

    /* ---------- Your own TTML (Settings > Lyrics > Your TTML) ----------
       Like Spicy Lyrics' Lyrics Manager: load a .ttml file to check it against the song before submitting it.
       Temporary lasts until the song changes; Keep stores it in this browser for that song and uses it every time
       the song plays, until it is removed. Either way it beats Spicy Lyrics and LRCLIB for that song.
       TTML as Spicy Lyrics / Apple Music write it: <p begin end ttm:agent> lines of <span begin end> words or
       syllables (spans with no space between them are one word), backing vocals in <span ttm:role="x-bg">, a
       second singer as another ttm:agent, songwriters in the head's metadata. Line-timed and untimed files work too. */
    const ttmlSongKey = (np) => `${np.artist}|${np.title}`;
    const ttmlLibrary = (() => {
        try { return JSON.parse(localStorage.getItem('sc-ttml-library') || '{}') || {}; }
        catch (e) { return {}; }
    })();
    const saveTtmlLibrary = () => {
        try { localStorage.setItem('sc-ttml-library', JSON.stringify(ttmlLibrary)); return true; }
        catch (e) { showToast('Could not keep the TTML: the browser\u2019s storage is full', true); return false; }
    };
    let ttmlTemporary = null; // { key, name, text }

    // "1:02.345", "01:02:03.4", "62.345s", "62.345" -> seconds
    const ttmlTime = (value) => {
        if (value == null || value === '') return null;
        const v = String(value).trim();
        if (/^[\d.]+s$/.test(v)) return parseFloat(v);
        const parts = v.split(':').map(Number);
        if (parts.some(n => Number.isNaN(n))) return null;
        return parts.reduce((total, n) => total * 60 + n, 0);
    };

    // -> { data, problems: [text], fatal: bool }
    const parseTtml = (text, fileName) => {
        const doc = new DOMParser().parseFromString(text, 'application/xml');
        if (doc.getElementsByTagName('parsererror').length) return { data: null, problems: ['The file is not valid XML (TTML), so it could not be read.'], fatal: true };
        const all = (root, name) => Array.from(root.getElementsByTagNameNS('*', name));
        const attr = (el, name) => el.getAttribute(name) ?? el.getAttribute(name.split(':').pop());
        const problems = [];
        let fatal = false;

        // the first person among the voices sings on the normal side; any other voice goes opposite
        const agents = all(doc, 'agent').map(a => a.getAttribute('xml:id') || a.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'id')).filter(Boolean);
        const writers = all(doc, 'songwriter').map(w => w.textContent.trim()).filter(Boolean);
        let lead = agents[0] || null;

        let wordTimed = false, lineTimed = false;
        const lines = [];
        all(doc, 'p').forEach((pEl, i) => {
            const n = i + 1;
            const agent = attr(pEl, 'ttm:agent');
            if (!lead && agent) lead = agent;
            const words = [];
            let group = 0;
            const walk = (node, bg) => {
                node.childNodes.forEach((child) => {
                    if (child.nodeType === 3) {
                        // a space between two words; no space between spans = syllables of one word
                        if (/\S/.test(child.textContent) && !words.length && bg === 0) return; // line text, handled below
                        if (/\s/.test(child.textContent) && words.length) words[words.length - 1].glue = false;
                        return;
                    }
                    if (child.nodeType !== 1 || child.localName !== 'span') return;
                    if (attr(child, 'ttm:role') === 'x-bg') { group += 1; walk(child, group); return; }
                    const begin = ttmlTime(attr(child, 'begin'));
                    const end = ttmlTime(attr(child, 'end'));
                    const wordText = child.textContent;
                    if (begin == null || end == null) {
                        if (/\S/.test(wordText)) problems.push(`Line ${n}: \u201c${wordText.trim()}\u201d has no timing.`);
                        return;
                    }
                    // a space inside the span ("Word ") also ends the word
                    words.push({ t: begin, e: end, text: wordText.trim(), glue: !/\s$/.test(wordText), bg });
                });
            };
            walk(pEl, 0);
            // the last syllable of a group never joins the next group's first
            words.forEach((w, k) => { if (k === words.length - 1 || words[k + 1].bg !== w.bg) w.glue = false; });

            const lineText = pEl.textContent.replace(/\s+/g, ' ').trim();
            if (!lineText) { problems.push(`Line ${n} is empty (Spicy Lyrics will not load a file with empty lines).`); fatal = true; return; }
            const begin = ttmlTime(attr(pEl, 'begin'));
            const end = ttmlTime(attr(pEl, 'end'));
            const right = !!(agent && lead && agent !== lead);
            if (words.length) {
                wordTimed = true;
                const leadWords = words.filter(w => !w.bg);
                const first = leadWords.length ? leadWords[0].t : words[0].t;
                lines.push({
                    t: Math.min(...words.map(w => w.t)),
                    end: Math.max(...words.map(w => w.e)),
                    seek: first,
                    right,
                    words,
                    text: leadWords.map(w => w.text + (w.glue ? '' : ' ')).join('').trim()
                });
            } else if (begin != null) {
                lineTimed = true;
                lines.push({ t: begin, end: end ?? undefined, right, text: lineText });
            } else {
                lines.push({ t: 0, text: lineText });
            }
        });

        if (!lines.length && !fatal) { problems.push('The file has no lyric lines (<p> elements).'); fatal = true; }
        const credit = `Your TTML (${fileName || 'file'})` + (writers.length ? ` \u2022 written by ${writers.join(', ')}` : '');
        const timed = wordTimed || lineTimed;
        if (timed) lines.sort((a, b) => a.t - b.t);
        const data = fatal ? null : { synced: timed, exactWords: wordTimed && !lineTimed, lines, credit, own: true };
        return { data, problems, fatal };
    };

    // the TTML to use for this song, if any (parsed fresh each time: the lyrics code adds to what it gets)
    const ownTtml = (np) => {
        const key = ttmlSongKey(np);
        const entry = ttmlTemporary && ttmlTemporary.key === key ? ttmlTemporary : ttmlLibrary[key];
        if (!entry) return null;
        const result = parseTtml(entry.text, entry.name);
        return result.data;
    };

    const updateLyrics = () => {
        lyricsPanel();
        updateLyricsFullMeta();
        const np = nowPlaying();
        if (!np || !np.title) {
            if (lyrics.key !== '') { lyrics.key = ''; lyrics.lines = null; showLyrics('Play something to see its lyrics'); }
            return;
        }
        const key = `${np.artist}|${np.title}|${np.duration}`;
        if (key !== lyrics.key) {
            lyrics.key = key;
            lyrics.lines = null;
            const apply = (data) => {
                if (lyrics.key !== key) return;
                if (!data) { showLyrics('No lyrics found for this song'); return; }
                lyrics.lines = data.lines;
                lyrics.synced = data.synced;
                showLyrics(data);
            };
            // your own TTML for this song comes first
            const own = ownTtml(np);
            if (own) {
                if (own.synced) { addEstimatedWords(own.lines); finishLineTimes(own.lines); }
                apply(own);
                return;
            }
            if (ttmlTemporary && ttmlTemporary.key !== ttmlSongKey(np)) ttmlTemporary = null; // temporary: until the song changes
            if (lyricsCache.has(key)) apply(lyricsCache.get(key));
            else {
                showLyrics('Looking for lyrics…');
                // Two sources answer in their own time; whichever is better stays on screen. Timed words beat
                // timed lines, timed lines beat plain text, and on a tie Spicy Lyrics wins (bonus).
                let shown = -1;
                const offer = (data, bonus) => {
                    const rank = (!data ? 0 : !data.synced ? 1 : data.exactWords ? 3 : 2) + (data ? bonus : 0);
                    if (rank <= shown) return;
                    shown = rank;
                    if (data && data.synced) { addEstimatedWords(data.lines); finishLineTimes(data.lines); }
                    lyricsCache.set(key, data);
                    apply(data);
                };
                fetchLyrics(np).then(data => offer(data, 0));
                fetchSpicyLyrics(np).then((data) => { if (data) offer(data, 0.5); });
            }
            return;
        }
        if (!lyrics.lines || !lyrics.synced) return;

        const time = estimatePosition(np) + 0.2 - lyricsOffset();
        // all lines being sung right now (more than one when they overlap), plus the latest one started
        const activeNow = [];
        let latest = -1;
        for (let i = 0; i < lyrics.lines.length; i++) {
            const line = lyrics.lines[i];
            if (line.t > time) continue;
            latest = i;
            if (time < line.end) activeNow.push(i);
        }
        lyrics.activeNow = activeNow; // read by animateLyricWords()
        const signature = activeNow.join(',') + '|' + latest;
        const linesChanged = signature !== lyrics.active;
        lyrics.active = signature;
        // follow playback unless the user scrolled the lyrics themselves a moment ago
        const follow = Date.now() - lyrics.lastWheel > 3000;

        lyricsTargets().forEach(({ box }) => {
            const scroll = box.querySelector('.sc-ly-scroll');
            if (!scroll) return;
            const els = scroll.querySelectorAll('.sc-ly-line');
            if (linesChanged) {
                const focus = activeNow.length ? activeNow : [Math.max(0, latest)];
                els.forEach((el, i) => {
                    const line = lyrics.lines[i];
                    el.classList.toggle('sc-active', activeNow.includes(i));
                    el.classList.toggle('sc-past', !!line && time >= line.end);
                    el.style.setProperty('--d', String(Math.min(...focus.map(a => Math.abs(a - i)))));
                });
                const target = els[activeNow.length ? activeNow[0] : Math.max(0, latest)];
                if (follow && target) scroll.scrollTo({ top: target.offsetTop - scroll.clientHeight * 0.38, behavior: 'smooth' });
            }
        });
    };

    /* ---------- Desktop lyrics ----------
       Sends the playing song's lyrics and position to Pretzel's Lyrics Overlay on this computer
       (127.0.0.1:8766), which floats them on the desktop; all of its settings are in the overlay itself. The
       lyrics go once per song (the app answers with the version it holds); the position goes about five times
       a second. When the app is not running this only checks back every few seconds. */
    const desktopLyrics = { session: Math.random().toString(36).slice(2), count: 0, sent: undefined, ver: '', appVer: null, busy: false, next: 0 };
    const syncDesktopLyrics = () => {
        if (desktopLyrics.busy || Date.now() < desktopLyrics.next ) return;
        const np = nowPlaying();
        const content = np && np.title ? lyricsShown : 'Play something to see its lyrics';
        if (content !== desktopLyrics.sent) {
            desktopLyrics.sent = content;
            desktopLyrics.ver = `${desktopLyrics.session}:${++desktopLyrics.count}`;
        }
        const state = { ver: desktopLyrics.ver, at: Date.now() };
        if (np && np.title) {
            Object.assign(state, {
                title: cleanTitle(np.title),
                artist: np.artist,
                pos: estimatePosition(np) - lyricsOffset(), // with the timing offsets from settings applied
                playing: !!document.querySelector('.playControls__play.playing'),
                palette: artPalette,
                cover: playingCover(),
                // for the SoundCloud app's Discord status
                duration: np.duration,
                url: (document.querySelector('.playbackSoundBadge__titleLink') || {}).href || ''
            });
        }
        if (desktopLyrics.appVer !== desktopLyrics.ver) {
            state.lyrics = content && typeof content === 'object'
                ? { synced: !!content.synced, lines: content.lines, credit: content.credit || 'Lyrics from LRCLIB' }
                : { message: String(content || '') };
        }
        desktopLyrics.busy = true;
        gmRequest({
            method: 'POST',
            url: 'http://127.0.0.1:8766/state',
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify(state),
            timeout: 2000,
            onload: (res) => {
                desktopLyrics.busy = false;
                let ok = res.status === 200;
                try { desktopLyrics.appVer = JSON.parse(res.responseText).ver; } catch (e) { ok = false; }
                desktopLyrics.next = Date.now() + (ok ? 200 : 5000);
            },
            onerror: () => { desktopLyrics.busy = false; desktopLyrics.appVer = null; desktopLyrics.next = Date.now() + 5000; },
            ontimeout: () => { desktopLyrics.busy = false; desktopLyrics.appVer = null; desktopLyrics.next = Date.now() + 5000; }
        });
    };

    // the playing song's cover, from the player bar's badge, at a size the overlay can show sharply
    const playingCover = () => {
        const el = document.querySelector('.playControls__soundBadge .playbackSoundBadge__avatar span.sc-artwork');
        const m = el && getComputedStyle(el).backgroundImage.match(/url\(["']?(.+?)["']?\)/);
        return m ? m[1].replace(/-t\d+x\d+/, '-t200x200') : '';
    };

    /* ---------- Word animation (every frame) ----------
       updateLyrics() decides which lines are active a few times a second. This runs on every screen frame
       and moves the words of those lines: while a word is sung its gradient fills, it grows and lifts and
       its glow rises; when it ends it eases back down, keeping a little glow that fades out.
       Values go into CSS variables on each word (--p fill, --s scale, --y lift, --g glow); see CSS 38. */
    let lyricSmoothTime = 0;
    let lyricFrameAt = 0;
    const easeOut = (x) => 1 - (1 - x) * (1 - x);

    // Letters as boxes move smoothly but lose the font's kerning, so their kerned places are measured as
    // plain inline text and each box gets a margin (in em, right at any size) that puts it back there.
    // Done when the lyrics are visible and again whenever the font or weight changes.
    const fitLyricLetters = (scroll) => {
        const first = scroll.querySelector('.sc-w');
        if (!first || !first.getBoundingClientRect().width) return;
        const cs = getComputedStyle(first);
        const key = `${cs.fontFamily}|${cs.fontWeight}|${document.fonts ? document.fonts.status : ''}`;
        if (scroll._fitKey === key) return;
        scroll._fitKey = key;
        scroll.classList.remove('sc-fitted');
        const words = [...scroll.querySelectorAll('.sc-w')];
        const inline = words.map(w => [...w.children].map(l => l.getBoundingClientRect().width));
        const sizes = words.map(w => parseFloat(getComputedStyle(w).fontSize) || 1);
        scroll.classList.add('sc-fitted');
        const boxed = words.map(w => [...w.children].map(l => l.getBoundingClientRect().width));
        words.forEach((w, i) => [...w.children].forEach((l, k) => {
            const gap = (inline[i][k] - boxed[i][k]) / sizes[i];
            l.style.marginRight = Math.abs(gap) > 0.0005 ? `${gap.toFixed(4)}em` : '';
        }));
    };

    const animateLyricWords = (now) => {
        requestAnimationFrame(animateLyricWords);
        const dt = Math.min(0.1, (now - lyricFrameAt) / 1000) || 0;
        lyricFrameAt = now;
        const active = lyrics.activeNow;
        if (!lyrics.lines || !lyrics.synced || !active || !active.length) return;
        const np = nowPlaying();
        if (!np) return;

        // The player only reports whole seconds, so keep a clock of our own that runs between reports and
        // is gently pulled toward the reported time (snapping only after a seek).
        const target = estimatePosition(np) + 0.2 - lyricsOffset();
        const playing = !!document.querySelector('.playControls__play.playing');
        if (Math.abs(target - lyricSmoothTime) > 0.6) lyricSmoothTime = target;
        else lyricSmoothTime += (playing ? dt : 0) + (target - lyricSmoothTime) * 0.06;
        const time = lyricSmoothTime;

        lyricsTargets().forEach(({ box }) => {
            const scroll = box.querySelector('.sc-ly-scroll');
            if (!scroll) return;
            fitLyricLetters(scroll);
            const els = scroll.querySelectorAll('.sc-ly-line');
            active.forEach((i) => {
                const el = els[i];
                const words = lyrics.lines[i] && lyrics.lines[i].words;
                if (!el || !el._words || !words) return;
                el._words.forEach((entry, w) => {
                    const word = words[w];
                    if (!word || !entry.letters.length) return;
                    // Each letter rises as the sweep reaches it and settles as the sweep leaves: a smooth bump
                    // centred on the moment the sweep is in the middle of the letter, as wide as the time the
                    // sweep takes to cross about two letters (never under ~0.12 s, so fast words don't flicker).
                    const share = Math.max(0.01, (word.e - word.t) / entry.letters.length);
                    const half = Math.max(1.1 * share, 0.12);
                    entry.letters.forEach((letter, n) => {
                        const start = word.t + share * n;
                        const progress = Math.min(1, Math.max(0, (time - start) / share));
                        const u = (time - (start + share / 2)) / half;
                        const bump = Math.abs(u) >= 1 ? 0 : (1 + Math.cos(Math.PI * u)) / 2;
                        const scale = 1 + 0.06 * bump;
                        const lift = -3.4 * bump;
                        // sung letters keep a soft glow; the one under the sweep glows brightest
                        const glow = Math.max(bump, progress >= 1 ? 0.3 : progress * 0.3);
                        const key = `${Math.round(progress * 100)}|${Math.round(scale * 1000)}|${Math.round(lift * 50)}|${Math.round(glow * 100)}`;
                        if (letter.shown === key) return;
                        letter.shown = key;
                        const style = letter.el.style;
                        style.setProperty('--p', (progress * 100).toFixed(1));
                        style.setProperty('--s', scale.toFixed(4));
                        style.setProperty('--y', lift.toFixed(2));
                        style.setProperty('--g', glow.toFixed(3));
                    });
                });
            });
        });
    };

    /* ---------- Accent colour from the playing song's artwork ---------- */
    const rgbToHsl = (r, g, b) => {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const l = (max + min) / 2;
        if (max === min) return [0, 0, l];
        const d = max - min;
        const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        let h;
        if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        return [h * 60, s, l];
    };

    let accentFor = '';
    let artPalette = []; // up to three '#rrggbb' colours from the artwork, for Pretzel's Lyrics Overlay's aura

    const hslToHex = (h, s, l) => {
        const f = (n) => {
            const k = (n + h / 30) % 12;
            const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
            return Math.round(c * 255).toString(16).padStart(2, '0');
        };
        return `#${f(0)}${f(8)}${f(4)}`;
    };

    // The artwork's main colours, as they look: its pixels are grouped into five colour clusters (k-means),
    // ranked by how much of the cover they fill (near-black counts for little, it cannot glow). Each keeps
    // its hue and saturation; very dark ones are lifted just enough to show as light.
    const paletteFrom = (px) => {
        const pts = [];
        for (let i = 0; i < px.length; i += 4) {
            const [, , l] = rgbToHsl(px[i], px[i + 1], px[i + 2]);
            if (l > 0.06 && l < 0.97) pts.push([px[i], px[i + 1], px[i + 2]]);
        }
        if (pts.length < 12) return ['#e6e6e6', '#9a9a9a', '#ffffff'];
        const dist = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
        const sorted = pts.slice().sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
        let groups = [0, 1, 2, 3, 4].map(k => ({ c: sorted[Math.floor((k + 0.5) * sorted.length / 5)].slice(), n: 0 }));
        for (let round = 0; round < 10; round++) {
            const sums = groups.map(() => [0, 0, 0, 0]);
            pts.forEach((p) => {
                let best = 0;
                groups.forEach((g, k) => { if (dist(p, g.c) < dist(p, groups[best].c)) best = k; });
                sums[best][0] += p[0]; sums[best][1] += p[1]; sums[best][2] += p[2]; sums[best][3]++;
            });
            groups = groups.map((g, k) => (sums[k][3] ? { c: sums[k].slice(0, 3).map(v => v / sums[k][3]), n: sums[k][3] } : { c: g.c, n: 0 }));
        }
        const ranked = groups.filter(g => g.n).map((g) => {
            const [h, s, l] = rgbToHsl(...g.c);
            return { h, s, l, c: g.c, score: g.n * (0.5 + s) * Math.min(1, l / 0.3) };
        }).sort((a, b) => b.score - a.score);
        const picked = [];
        for (const g of ranked) {
            if (picked.length === 3) break;
            if (g.score < ranked[0].score * 0.08) break;
            if (picked.some(p => dist(p.c, g.c) < 45 * 45)) continue;
            picked.push(g);
        }
        const cols = picked.map(g => [g.h, Math.min(0.9, g.s * 1.1), Math.min(0.74, Math.max(0.4, g.l * 1.15))]);
        while (cols.length < 3) { const [h, s, l] = cols[cols.length - 1]; cols.push([(h + 12) % 360, s, Math.min(0.8, l + 0.14)]); }
        return cols.map(([h, s, l]) => hslToHex(h, s, l));
    };
    const updateAccent = (artUrl) => {
        if (!artUrl || artUrl === accentFor) return;
        accentFor = artUrl;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            if (accentFor !== artUrl) return;
            try {
                const size = 24;
                const canvas = document.createElement('canvas');
                canvas.width = canvas.height = size;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, size, size);
                const px = ctx.getImageData(0, 0, size, size).data;
                // 12 hue buckets, each pixel weighted by how colourful it is
                const buckets = Array.from({ length: 12 }, () => ({ w: 0, h: 0, s: 0, l: 0 }));
                let total = 0;
                for (let i = 0; i < px.length; i += 4) {
                    const [h, s, l] = rgbToHsl(px[i], px[i + 1], px[i + 2]);
                    if (l < 0.12 || l > 0.92) continue;
                    const weight = s * (1 - Math.abs(l - 0.5));
                    const bucket = buckets[Math.floor(h / 30) % 12];
                    bucket.w += weight; bucket.h += h * weight; bucket.s += s * weight; bucket.l += l * weight;
                    total += weight;
                }
                const best = buckets.reduce((a, b) => (b.w > a.w ? b : a));
                artPalette = paletteFrom(px);
                let color;
                if (total / (size * size) < 0.04 || best.w === 0) {
                    color = 'hsl(0, 0%, 60%)'; // black-and-white artwork: neutral accent
                } else {
                    const h = best.h / best.w;
                    const s = Math.min(0.85, Math.max(0.5, best.s / best.w));
                    const l = Math.min(0.6, Math.max(0.46, best.l / best.w)); // bright enough to see, dark enough for white icons
                    color = `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
                }
                document.documentElement.style.setProperty('--sc-accent', color);
            } catch (e) {}
        };
        img.src = artUrl;
    };

    /* ---------- Inline volume slider ----------
       SoundCloud's own slider is a vertical pop-up. Ours is always visible and horizontal; it sets the level
       by sending the hidden original the same mouse events a drag would. */
    const nativeVolume = () => document.querySelector('.playControls .volume__sliderWrapper');

    // in the LiquidCloud app, a line in its playback.log (for tracking down problems); elsewhere nothing
    const appLog = (text) => { if (W.__liquid && W.__liquid.log) W.__liquid.log(text); };

    const setVolume = (level) => withBarGeometry(() => {
        const native = nativeVolume();
        if (!native) return;
        const rect = native.getBoundingClientRect();
        const before = native.getAttribute('aria-valuenow');
        setTimeout(() => appLog(`volume: set ${level.toFixed(2)}, control at ${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)}, was ${before}, now ${native.getAttribute('aria-valuenow')}`), 50);
        // measured: SoundCloud reads level = (distance from the wrapper's bottom - 9px) / 120px
        const y = rect.bottom - (9 + 120 * Math.min(1, Math.max(0, level)));
        const x = rect.left + rect.width / 2;
        const fire = (el, type) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1 }));
        fire(native, 'mousedown');
        fire(document, 'mousemove');
        fire(document, 'mouseup');
    });

    const syncVolume = () => {
        const slider = document.querySelector('.sc-vol');
        const native = nativeVolume();
        if (!native) return;
        const muted = !!document.querySelector('.playControls .volume.muted');
        const level = muted ? 0 : Number(native.getAttribute('aria-valuenow')) || 0;
        if (level !== syncVolume.last) { appLog(`volume: SoundCloud reports ${level}${muted ? ' (muted)' : ''}`); syncVolume.last = level; }
        const big = document.querySelector('#sc-ly-full.sc-open .sc-lyf-vol');
        if (big && !big.classList.contains('sc-dragging')) {
            big.querySelector('.sc-lyf-vol-fill').style.height = `${level * 100}%`;
            big.querySelector('.sc-lyf-vol-knob').style.bottom = `${level * 100}%`;
        }
        if (!slider || slider.classList.contains('sc-dragging')) return;
        slider.querySelector('.sc-vol-fill').style.width = `${level * 100}%`;
        slider.querySelector('.sc-vol-knob').style.left = `${level * 100}%`;
    };

    const setupVolume = () => {
        const host = document.querySelector('.playControls__volume');
        if (!host || host.querySelector('.sc-vol')) return;
        const slider = document.createElement('div');
        slider.className = 'sc-vol';
        slider.title = 'Volume';
        slider.innerHTML = '<div class="sc-vol-track"><div class="sc-vol-fill"></div><div class="sc-vol-knob"></div></div>';
        const levelAt = (e) => {
            const rect = slider.getBoundingClientRect();
            return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        };
        const apply = (e) => {
            const level = levelAt(e);
            slider.querySelector('.sc-vol-fill').style.width = `${level * 100}%`;
            slider.querySelector('.sc-vol-knob').style.left = `${level * 100}%`;
            setVolume(level);
        };
        slider.addEventListener('pointerdown', (e) => {
            slider.classList.add('sc-dragging');
            slider.setPointerCapture(e.pointerId);
            apply(e);
        });
        slider.addEventListener('pointermove', (e) => { if (slider.classList.contains('sc-dragging')) apply(e); });
        const end = () => { slider.classList.remove('sc-dragging'); setTimeout(syncVolume, 300); };
        slider.addEventListener('pointerup', end);
        slider.addEventListener('pointercancel', end);
        host.appendChild(slider);
        syncVolume();
    };

    /* ---------- Tile shelves: arrows scroll the row ---------- */
    let shelfPreloading = false;
    const setupShelfArrows = () => {
        if (document.body.dataset.scShelves) return;
        document.body.dataset.scShelves = '1';
        // SoundCloud's own handler still runs: its transforms are disabled in CSS, but it is what loads
        // the tiles further along the row
        document.addEventListener('click', (e) => {
            const btn = e.target.closest && e.target.closest('.tileGallery__sliderButton');
            if (!btn || shelfPreloading) return;
            // SoundCloud loads 4 tiles per press but more than that fit on screen: press once more for it
            shelfPreloading = true;
            try { btn.click(); } finally { shelfPreloading = false; }
            const slider = btn.closest('.tileGallery').querySelector('.tileGallery__slider');
            if (!slider) return;
            const dir = btn.classList.contains('tileGallery__slideBackwardButton') ? -1 : 1;
            slider.scrollBy({ left: dir * 800, behavior: 'smooth' }); // 4 tiles of 180px + 20px gap
        }, true);
    };

    /* ---------- Search: legal links go under the results ---------- */
    const moveSearchFooter = () => {
        const page = document.querySelector('.l-search');
        if (!page) return;
        const source = page.querySelector('.searchOptions__footer .l-footer');
        let footer = page.querySelector('.sc-search-footer');
        if (!source || footer) return;
        footer = document.createElement('div');
        footer.className = 'sc-search-footer';
        // copy the links only; the language picker is left behind
        source.querySelectorAll('a').forEach((a) => {
            if (/language/i.test(a.textContent) || /locale|language/i.test(a.className)) return;
            if (footer.childNodes.length) footer.appendChild(document.createTextNode(' · '));
            const link = a.cloneNode(true);
            link.removeAttribute('class');
            footer.appendChild(link);
        });
        page.appendChild(footer);
    };

    /* ---------- Page transitions ----------
       SoundCloud empties the page the instant you click a link. To keep the old page on screen while the
       next one loads:
         1. on a link click, a frozen copy of the current page (#sc-page-ghost) is laid over the panel;
         2. the real panel is parked off to the side, invisible, while SoundCloud loads the new page into it;
         3. once the new page has something to show, the copy slides out and the real panel slides in.
       While the copy is up, the per-page passes (artist / playlist / song) are paused (navFrozen), because
       they flip classes on <body> that would restyle the copy mid-flight. */
    const PAGE = '#app > .l-container.l-content'; // the real panel; the ghost's copy is nested deeper
    let pageNav = null; // { ghost, from, changedAt, startedAt }
    let navFrozen = false;

    const pagePanel = () => document.querySelector(PAGE);

    const dropGhost = () => {
        if (pageNav && pageNav.ghost) pageNav.ghost.remove();
        const app = scrollArea();
        if (app) app.classList.remove('sc-page-pending', 'sc-list-pending');
        pageNav = null;
        navFrozen = false;
    };

    // Switching between a profile's tabs only swaps the list under the header, so only that part animates
    const PROFILE_TABS = ['', 'popular-tracks', 'tracks', 'albums', 'sets', 'reposts'];
    const isProfileTabSwitch = (url) => {
        if (!document.body.classList.contains('sc-artist')) return false;
        const from = location.pathname.split('/').filter(Boolean);
        const to = url.pathname.split('/').filter(Boolean);
        return from.length >= 1 && from.length <= 2 && to.length >= 1 && to.length <= 2 &&
            from[0] === to[0] && PROFILE_TABS.includes(from[1] || '') && PROFILE_TABS.includes(to[1] || '');
    };

    const startPageNav = (listOnly) => {
        const app = scrollArea();
        const panel = pagePanel();
        if (!app || !panel || pageNav) return;
        const source = listOnly ? panel.querySelector('.userMain__content') : panel;
        if (!source) return;
        const ghost = document.createElement('div');
        ghost.id = 'sc-page-ghost';
        const copy = source.cloneNode(true);
        copy.style.transition = 'none';
        copy.querySelectorAll('iframe, script').forEach(el => el.remove());
        if (listOnly) {
            // laid exactly over the list, scrolling with the page
            const appRect = app.getBoundingClientRect();
            const rect = source.getBoundingClientRect();
            ghost.classList.add('sc-list');
            ghost.style.top = `${rect.top - appRect.top + app.scrollTop}px`;
            ghost.style.left = `${rect.left - appRect.left}px`;
            ghost.style.width = `${rect.width}px`;
            ghost.style.height = `${Math.min(rect.height, app.clientHeight * 2)}px`;
        } else {
            // covers the visible part of the panel
            ghost.style.top = `${app.scrollTop}px`;
            ghost.style.height = `${app.clientHeight}px`;
            copy.style.transform = `translateY(${-app.scrollTop}px)`;
        }
        ghost.appendChild(copy);
        app.appendChild(ghost);
        pageNav = { ghost, listOnly: !!listOnly, from: location.pathname + location.search, startedAt: Date.now(), changedAt: 0 };
    };

    // Has SoundCloud put real content into the new page yet?
    const pageLooksReady = () => {
        const panel = pagePanel();
        if (!panel) return true;
        if (pageNav && pageNav.listOnly) {
            return !!panel.querySelector('.userMain__content .soundList__item, .userMain__content .paging-eof, .userMain__content .emptyNetworkPage, .userMain__content [class*="empty" i]');
        }
        if (panel.querySelector('.fullHero, .profileHeader, .searchList__item, .mixedSelectionModule, .soundList__item, .trackItem, .l-listen-wrapper, .tileGallery, .badgeList__item, .userBadgeListItem')) return true;
        const frame = webiFrame();
        return !!frame && !frame.classList.contains('sc-hidden') && frame.contentWindow.location.pathname.replace(/\/$/, '') === '/n' + currentPath();
    };

    const finishPageNav = () => {
        const nav = pageNav;
        if (!nav || nav.leaving) return;
        nav.leaving = true;
        nav.ghost.classList.add('sc-leave');
        setTimeout(() => {
            nav.ghost.remove();
            navFrozen = false;
            cleanDOM(); // page classes for the new page are applied while nothing is visible
            // song pages are drawn by us after an API call: give that a moment so the panel slides in complete
            const waitUntil = Date.now() + 1200;
            const reveal = () => {
                const frame = webiFrame();
                const songPending = frame && !frame.classList.contains('sc-hidden') && currentPath().split('/').filter(Boolean).length === 2 &&
                    !document.body.classList.contains('sc-track') && !document.body.classList.contains('sc-track-native');
                if (songPending && Date.now() < waitUntil) { setTimeout(reveal, 80); return; }
                const app = scrollArea();
                if (app) app.classList.remove('sc-page-pending', 'sc-list-pending');
                if (pageNav === nav) pageNav = null;
            };
            setTimeout(reveal, 30); // a timer, not requestAnimationFrame: that never fires in a background tab
        }, 190);
    };

    const tickPageNav = () => {
        const nav = pageNav;
        if (!nav || nav.leaving) return;
        const now = Date.now();
        const here = location.pathname + location.search;
        if (!nav.changedAt) {
            if (here !== nav.from) {
                nav.changedAt = now;
                navFrozen = true;
                const app = scrollArea();
                if (app && nav.listOnly) app.classList.add('sc-list-pending');
                else if (app) { app.classList.add('sc-page-pending'); app.scrollTop = 0; if (PHONE) window.scrollTo(0, 0); nav.ghost.style.top = '0px'; }
            } else if (now - nav.startedAt > 900) {
                dropGhost(); // the click did not lead anywhere
            }
            return;
        }
        const waited = now - nav.changedAt;
        if ((waited > 200 && pageLooksReady()) || waited > 3000) finishPageNav();
    };

    const setupPageTransitions = () => {
        if (document.body.dataset.scPageNav) return;
        document.body.dataset.scPageNav = '1';
        // capture phase: runs before SoundCloud's router reacts to the click
        document.addEventListener('click', (e) => {
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            const link = e.target.closest && e.target.closest('a[href]');
            if (!link || link.target === '_blank' || link.hasAttribute('download') || link.getAttribute('role') === 'button') return;
            const raw = link.getAttribute('href');
            if (!raw || raw.startsWith('#')) return;
            let url;
            try { url = new URL(raw, location.href); } catch (err) { return; }
            if (url.origin !== location.origin) return;
            if (url.pathname + url.search === location.pathname + location.search) return;
            if (document.body.classList.contains('sc-lyf-open')) return;
            const listOnly = isProfileTabSwitch(url);
            if (listOnly) keepScrollPath = url.pathname;
            startPageNav(listOnly);
        }, true);
        setInterval(tickPageNav, 60);
    };

    /* ---------- Player bar "On hover": pointer zone ----------
       The bar opens when the pointer is anywhere near the bottom centre of the window, not only when it
       touches the small capsule, and closes a moment after the pointer leaves. */
    const setupBarZone = () => {
        if (document.body.dataset.scBarZone) return;
        document.body.dataset.scBarZone = '1';
        let closeTimer = null;
        const open = (on) => {
            if (on) {
                if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
                document.body.classList.add('sc-bar-open');
            } else if (!closeTimer && document.body.classList.contains('sc-bar-open')) {
                closeTimer = setTimeout(() => { closeTimer = null; document.body.classList.remove('sc-bar-open'); }, 450);
            }
        };
        document.addEventListener('mousemove', (e) => {
            if (!e.isTrusted) return; // our own seek / volume events are not the user's pointer
            if (document.body.dataset.lyfBar !== 'hover') return;
            const halfWidth = Math.min(520, window.innerWidth * 0.48); // a bit wider than the bar itself
            const nearBottom = e.clientY > window.innerHeight - 100; // about the height of the open bar
            const nearCentre = Math.abs(e.clientX - window.innerWidth / 2) < halfWidth;
            open(nearBottom && nearCentre);
        }, { passive: true });
        document.addEventListener('mouseleave', () => open(false));
    };

    /* ---------- Small notice at the bottom of the screen ---------- */
    const showToast = (text, isError) => {
        let toast = document.getElementById('sc-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'sc-toast';
            document.body.appendChild(toast);
        }
        toast.textContent = text;
        toast.classList.toggle('sc-error', !!isError);
        toast.classList.add('sc-show');
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => toast.classList.remove('sc-show'), isError ? 6000 : 2500);
    };

    /* ---------- Drag tracks into a new order (your own playlists) ----------
       In reorder mode, dragging rows only rearranges the page. "Save order" then sends the new order with the
       same request SoundCloud's "Edit playlist > Tracks" screen sends: the playlist's full list of track ids.
       Safety: the current list is re-read from SoundCloud just before saving, the new list must contain exactly
       the same tracks, and if SoundCloud's answer has a different number of tracks the old order is put back. */
    const apiWrite = async (method, path, body) => {
        const hydration = pageHydration();
        const client = Array.isArray(hydration) && hydration.find(item => item && item.hydratable === 'apiClient' && item.data);
        const token = oauthToken();
        if (!client || !token) throw new Error('You need to be signed in to SoundCloud.');
        const res = await fetch(`https://api-v2.soundcloud.com${path}?client_id=${client.data.id}`, {
            method,
            headers: { Authorization: `OAuth ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            const error = new Error(`SoundCloud refused the request (${res.status}).`);
            error.status = res.status;
            error.captcha = /captcha|datadome/i.test(text); // its anti-bot layer wants a human check
            throw error;
        }
        return res.json().catch(() => ({}));
    };

    const rowTrackPath = (li) => {
        const title = li && li.querySelector('.trackItem__trackTitle');
        return title ? (title.getAttribute('href') || '').split('?')[0] : null;
    };

    const renumberRows = (list) => {
        list.querySelectorAll('li').forEach((li, i) => {
            const number = li.querySelector('.trackItem__number');
            if (!number) return;
            const leaf = number.querySelector('.trackItem__separator') || number;
            if (leaf.textContent.trim() !== String(i + 1)) leaf.textContent = String(i + 1);
        });
    };

    // Reorder mode: "Reorder" makes the rows draggable; drags only rearrange the page. Nothing is sent to
    // SoundCloud until "Save order", which sends the whole new order in a single request.
    const reorder = { on: false, path: null, snapshot: [], dirty: false, saving: false };

    const reorderList = () => document.querySelector(`${PAGE} .listenDetails__trackList`);

    const setReorderMode = (on) => {
        const list = reorderList();
        reorder.on = on;
        reorder.dirty = false;
        reorder.path = on ? currentPath() : null;
        reorder.snapshot = on && list ? [...list.querySelectorAll('li')] : [];
        document.body.classList.toggle('sc-reordering', on);
        if (list) list.querySelectorAll('li').forEach((li) => { li.draggable = on && !!li.querySelector('.trackItem'); });
        refreshReorderBar();
    };

    const refreshReorderBar = () => {
        const bar = document.getElementById('sc-reorder-bar');
        if (!bar) return;
        bar.classList.toggle('sc-on', reorder.on);
        bar.querySelector('.sc-reorder-save').disabled = !reorder.dirty || reorder.saving;
        bar.querySelector('.sc-reorder-save').textContent = reorder.saving ? 'Saving…' : 'Save order';
    };

    const cancelReorder = () => {
        const list = reorderList();
        const parent = list && list.querySelector('li') && list.querySelector('li').parentNode;
        // put every row back where it was when Reorder was pressed
        if (parent) reorder.snapshot.forEach((li) => { if (li.isConnected) parent.appendChild(li); });
        if (list) renumberRows(list);
        setReorderMode(false);
    };

    const putWithRetry = async (path, body) => {
        for (let attempt = 0; ; attempt++) {
            try { return await apiWrite('PUT', path, body); }
            catch (e) {
                // SoundCloud sometimes refuses a write (403) and accepts the same one a few seconds later
                if (e.status !== 403 || attempt >= 2) throw e;
                showToast('SoundCloud is busy, trying again…');
                await new Promise(resolve => setTimeout(resolve, 3500 * (attempt + 1)));
            }
        }
    };

    const saveReorder = async () => {
        const list = reorderList();
        const data = playlistCache.get(currentPath());
        if (!list || !data || typeof data.then === 'function' || reorder.saving) return;
        reorder.saving = true;
        refreshReorderBar();
        try {
            // rows on the page are the first N tracks of the playlist, in their new order
            const pageIds = [...list.querySelectorAll('li')].filter(li => li.querySelector('.trackItem')).map(li => data.ids.get(rowTrackPath(li)));
            if (pageIds.some(id => !id)) throw new Error('Some rows could not be matched to tracks, so nothing was changed. Reload and try again.');

            const fresh = await api(`/playlists/${data.playlist.id}`);
            const before = (fresh.tracks || []).map(t => t.id);
            // only proceed with the complete list, otherwise saving would drop tracks
            if (!before.length || before.length !== fresh.track_count) throw new Error('Could not read the full track list, so nothing was changed.');
            const head = before.slice(0, pageIds.length);
            const sameSet = head.length === pageIds.length && new Set(pageIds).size === pageIds.length && head.every(id => pageIds.includes(id));
            if (!sameSet) throw new Error('This playlist changed somewhere else. Reload the page and try again.');

            const order = pageIds.concat(before.slice(pageIds.length));
            if (order.join(',') === before.join(',')) { showToast('Order unchanged'); setReorderMode(false); reorder.saving = false; refreshReorderBar(); return; }

            await putWithRetry(`/playlists/${data.playlist.id}`, { playlist: { tracks: order } });
            // SoundCloud's reply does not include the tracks, so read the playlist back to confirm
            await new Promise(resolve => setTimeout(resolve, 800));
            const check = await api(`/playlists/${data.playlist.id}`);
            const savedIds = (check.tracks || []).map(t => t.id);
            if (savedIds.length !== before.length) {
                await new Promise(resolve => setTimeout(resolve, 3500));
                await putWithRetry(`/playlists/${data.playlist.id}`, { playlist: { tracks: before } });
                throw new Error('SoundCloud came back with a different number of tracks, so the old order was restored.');
            }
            if (savedIds.join(',') !== order.join(',')) throw new Error('SoundCloud did not apply the new order. Nothing was lost; try Save again in a moment.');
            showToast('Playlist order saved');
            reorder.saving = false;
            setReorderMode(false);
            return;
        } catch (e) {
            const text = e.captcha
                ? 'SoundCloud wants to check you are human before it accepts changes. Like or add a track once using its own buttons, then press Save order again.'
                : String((e && e.message) || e);
            showToast(text, true);
        }
        reorder.saving = false;
        refreshReorderBar();
    };

    // toolbar above the track list on playlists you own
    const ensureReorderBar = (list) => {
        if (list.querySelector('#sc-reorder-bar')) return;
        const bar = document.createElement('div');
        bar.id = 'sc-reorder-bar';
        bar.innerHTML = `
            <span class="sc-reorder-hint">Drag tracks into the order you want, then save.</span>
            <button type="button" class="sc-reorder-start">${strokeIcon('<path d="M7 4v16"/><path d="m3 8 4-4 4 4"/><path d="M17 20V4"/><path d="m21 16-4 4-4-4"/>')}<span>Reorder</span></button>
            <button type="button" class="sc-reorder-cancel">Cancel</button>
            <button type="button" class="sc-reorder-save">Save order</button>
        `;
        bar.querySelector('.sc-reorder-start').addEventListener('click', () => setReorderMode(true));
        bar.querySelector('.sc-reorder-cancel').addEventListener('click', cancelReorder);
        bar.querySelector('.sc-reorder-save').addEventListener('click', saveReorder);
        list.prepend(bar);
        refreshReorderBar();
    };

    // A click on a track row plays that track. On the row that is already playing, SoundCloud treats a
    // click anywhere on it as "pause"; only the actual play / pause button (or Space) should do that.
    const setupPauseGuard = () => {
        if (document.body.dataset.scPauseGuard) return;
        document.body.dataset.scPauseGuard = '1';
        document.addEventListener('click', (e) => {
            if (!e.target.closest) return;
            const row = e.target.closest('.trackItem.active');
            if (!row || !document.querySelector('.playControls__play.playing')) return;
            if (e.target.closest('.trackItem__play, .sc-button, button, a[href]')) return; // real controls and links still work
            e.preventDefault();
            e.stopPropagation();
        }, true);
    };

    const setupTrackReorder = () => {
        if (document.body.dataset.scReorder) return;
        document.body.dataset.scReorder = '1';
        let dragging = null;
        const rowOf = (target) => {
            if (!reorder.on || reorder.saving) return null;
            const li = target && target.closest && target.closest('.listenDetails__trackList li');
            return li && li.draggable ? li : null;
        };
        const clearMarks = () => document.querySelectorAll('.sc-drop-before, .sc-drop-after').forEach(el => el.classList.remove('sc-drop-before', 'sc-drop-after'));

        document.addEventListener('dragstart', (e) => {
            const li = rowOf(e.target);
            if (!li) return;
            dragging = li;
            li.classList.add('sc-dragging');
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', rowTrackPath(li) || ''); } catch (err) {}
        }, true);

        document.addEventListener('dragover', (e) => {
            if (!dragging) return;
            const li = rowOf(e.target);
            if (!li || li === dragging) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const rect = li.getBoundingClientRect();
            clearMarks();
            li.classList.add(e.clientY > rect.top + rect.height / 2 ? 'sc-drop-after' : 'sc-drop-before');
        }, true);

        document.addEventListener('drop', (e) => {
            if (!dragging) return;
            const li = rowOf(e.target);
            if (!li || li === dragging) return;
            e.preventDefault();
            e.stopPropagation();
            const rect = li.getBoundingClientRect();
            const after = e.clientY > rect.top + rect.height / 2;
            li.parentNode.insertBefore(dragging, after ? li.nextSibling : li); // page only; saved later
            renumberRows(li.closest('.listenDetails__trackList'));
            reorder.dirty = true;
            refreshReorderBar();
        }, true);

        document.addEventListener('dragend', () => {
            if (dragging) dragging.classList.remove('sc-dragging');
            dragging = null;
            clearMarks();
        }, true);

        // in reorder mode a click on a row should not start playback or open a link
        document.addEventListener('click', (e) => {
            if (!reorder.on) return;
            const row = e.target.closest && e.target.closest('.listenDetails__trackList li');
            if (row) { e.preventDefault(); e.stopPropagation(); }
        }, true);
    };

    /* ---------- Track title cleanup ---------- */
    const sanitizeTrackTitles = () => {
        document.querySelectorAll('.trackItem__trackTitle, a.soundTitle__title').forEach((el) => {
            if (el.dataset.scSanitized === 'true') return;

            let text = el.innerText || '';
            const cleaned = cleanTitle(text);

            if (cleaned && cleaned !== text) {
                el.innerText = cleaned;
            }
            el.dataset.scSanitized = 'true';
        });

        // player bar: SoundCloud rewrites this on every track change, so compare instead of flagging
        const badge = document.querySelector('.playbackSoundBadge__titleLink span[aria-hidden="true"]');
        if (badge) {
            const raw = badge.closest('a').getAttribute('title') || badge.textContent;
            const shown = cleanTitle(raw) || raw;
            if (badge.textContent !== shown) badge.textContent = shown;
        }

        document.querySelectorAll('.trackItem__numberWrapper, .trackItem__number').forEach((numEl) => {
            numEl.childNodes.forEach((node) => {
                if (node.nodeType === Node.TEXT_NODE && node.nodeValue.includes('·')) {
                    node.nodeValue = node.nodeValue.replace(/·/g, '').trim();
                }
            });
        });
    };

    /* ---------- Phone layout (see PHONE) ---------- */
    const PHONE_CSS = `
        html.sc-phone {
            --sc-bar-h: calc(52px + env(safe-area-inset-top));
            --sc-tabs-h: calc(56px + env(safe-area-inset-bottom));
            --sc-mini-h: 56px;
            -webkit-text-size-adjust: 100%;
        }

        html.sc-phone body {
            min-width: 0 !important;
        }

        /* top bar: your picture on the left, notifications and settings on the right */
        html.sc-phone #lc-top-bar {
            padding: env(safe-area-inset-top) 12px 0 12px !important;
            background: #121212 !important;
            border-bottom: none !important;
            box-shadow: none !important;
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
        }

        html.sc-phone #lc-top-bar .sc-top-logo,
        html.sc-phone #lc-top-bar .sc-top-profile-name,
        html.sc-phone #lc-top-bar [data-act="import"],
        html.sc-phone #lc-top-bar a[href="/upload"],
        html.sc-phone #lc-top-bar a[href="/you/library"],
        html.sc-phone .sc-win-controls,
        html.sc-phone #sc-lyrics,
        html.sc-phone .tileGallery__sliderButton {
            display: none !important;
        }

        html.sc-phone #sc-user-profile-img {
            width: 34px !important;
            height: 34px !important;
        }

        /* the search box sits in the top bar, between your picture and the icons */
        html.sc-phone #lc-top-bar .sc-top-search-wrap {
            display: flex !important;
            position: static !important;
            transform: none !important;
            flex: 1 1 auto !important;
            width: auto !important;
            min-width: 0 !important;
            max-width: none !important;
            height: 38px !important;
            margin: 0 4px 0 10px !important;
        }

        html.sc-phone #lc-top-bar .sc-top-search-wrap input {
            min-width: 0 !important;
        }

        html.sc-phone #lc-top-bar .sc-top-nav-right {
            flex: 0 0 auto !important;
            gap: 0 !important;
        }

        html.sc-phone #sc-custom-search-input {
            font-size: 16px !important; /* under 16px Safari zooms the page in on focus */
        }

        /* the page: Safari scrolls the page itself (not a box inside it), which is what lets Safari shrink its
           address bar out of the way while you scroll down */
        html.sc-phone,
        html.sc-phone body {
            overflow: visible !important;
            overflow-x: clip !important;
            height: auto !important;
        }

        html.sc-phone #app {
            position: relative !important;
            top: auto !important;
            left: auto !important;
            right: auto !important;
            bottom: auto !important;
            min-height: 100vh !important;
            overflow: visible !important;
            overflow-x: clip !important;
            border-radius: 0 !important;
            border: none !important;
            box-shadow: none !important;
            padding-top: var(--sc-bar-h) !important;
            padding-bottom: calc(var(--sc-tabs-h) + var(--sc-mini-h) + 24px) !important;
            box-sizing: border-box !important;
        }

        /* (the player's wrapper is also an .l-container: left alone, or the mini player shrinks to its contents) */
        html.sc-phone .l-container:not(.playControls__wrapper),
        html.sc-phone .l-content:not(.playControls__wrapper),
        html.sc-phone .l-main,
        html.sc-phone .l-fluid-fixed .l-main,
        html.sc-phone .l-fixed-fluid .l-main {
            width: auto !important;
            max-width: 100% !important;
            min-width: 0 !important;
            float: none !important;
        }

        /* only the outer panel is padded; the containers inside it add nothing, so rows line up with the title */
        html.sc-phone .l-container:not(.playControls__wrapper):not(.l-container .l-container) {
            padding-left: 16px !important;
            padding-right: 16px !important;
        }

        html.sc-phone body .playControls__wrapper {
            flex: 1 1 auto !important;
            width: 100% !important;
            min-width: 0 !important;
            padding: 0 !important;
        }

        /* rows of tiles scroll sideways with a finger */
        html.sc-phone .tileGallery__slider {
            overflow-x: auto !important;
            scroll-snap-type: x proximity;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;
        }

        /* song and playlist pages: the cover centred on top, then the title, the creator, the details and the
           play row, all stacked (the desktop hero puts the text beside the cover, which runs off the screen) */
        html.sc-phone .fullHero {
            --sc-hero-art: min(64vw, 270px);
        }

        html.sc-phone .fullHero__foreground {
            grid-template-columns: auto auto minmax(0, 1fr) !important;
            grid-template-rows: auto auto auto auto 72px !important;
            align-content: start !important;
            min-height: 0 !important;
            padding-top: 4px !important;
        }

        html.sc-phone .fullHero__foreground::before {
            display: none !important;
        }

        html.sc-phone .fullHero__artwork {
            grid-column: 1 / -1 !important;
            grid-row: 1 !important;
            justify-self: center !important;
            width: var(--sc-hero-art) !important;
            height: var(--sc-hero-art) !important;
            margin-bottom: 24px !important;
        }

        html.sc-phone .fullHero .soundTitle__title {
            grid-column: 1 / -1 !important;
            grid-row: 2 !important;
            margin: 0 0 10px 0 !important;
        }

        html.sc-phone .fullHero .soundTitle__title,
        html.sc-phone .fullHero .soundTitle__title span {
            font-size: 26px !important;
            letter-spacing: -0.02em !important;
            line-height: 1.15 !important;
        }

        /* creator: picture and name in white, like Spotify */
        html.sc-phone .fullHero .soundTitle__username {
            grid-column: 1 / -1 !important;
            grid-row: 3 !important;
            margin-bottom: 6px !important;
        }

        html.sc-phone .fullHero .soundTitle__username,
        html.sc-phone .fullHero .soundTitle__username * {
            font-size: 14px !important;
            font-weight: 700 !important;
            color: #ffffff !important;
        }

        html.sc-phone .fullHero__tracksSummary {
            grid-column: 1 !important;
            grid-row: 4 !important;
        }

        html.sc-phone .fullHero__tracksSummary .genericTrackCount::before {
            display: none !important;
        }

        html.sc-phone .fullHero__info {
            grid-column: 2 / -1 !important;
            grid-row: 4 !important;
            justify-self: start !important;
            min-width: 0 !important;
            max-width: 100% !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
        }

        /* playlists: just the song count and length under the creator (no "Updated ...") */
        html.sc-phone .fullHero__foreground:has(.fullHero__tracksSummary .genericTrackCount) .fullHero__info {
            display: none !important;
        }

        html.sc-phone .fullHero__foreground:not(:has(.fullHero__tracksSummary .genericTrackCount)) .fullHero__info {
            grid-column: 1 / -1 !important;
        }

        html.sc-phone .fullHero__foreground:not(:has(.fullHero__tracksSummary .genericTrackCount)) .fullHero__info::before {
            display: none !important;
        }

        /* action row: icons on the left, the big play button on the right */
        html.sc-phone .fullHero .soundTitle__playButton {
            grid-column: 3 !important;
            grid-row: 5 !important;
            justify-self: end !important;
            align-self: center !important;
        }

        html.sc-phone .listenEngagement__footer {
            margin: -72px 68px 4px -8px !important;
            height: 72px !important;
            justify-content: flex-start !important;
        }

        html.sc-phone .listenEngagement__footer .soundStats {
            display: none !important;
        }

        html.sc-phone .listenEngagement__footer .soundActions .sc-button-group {
            gap: 0 !important;
        }

        /* playlists: nothing between the action row and the songs */
        html.sc-phone body:has(.fullHero__tracksSummary .genericTrackCount) .listenEngagement > *:not(.listenEngagement__footer) {
            display: none !important;
        }

        html.sc-phone .listenEngagement,
        html.sc-phone .l-listen-wrapper,
        html.sc-phone .l-about-row,
        html.sc-phone .l-about-main {
            margin-top: 0 !important;
            margin-bottom: 0 !important;
            padding-top: 0 !important;
        }

        html.sc-phone .listenDetails ul,
        html.sc-phone .trackList,
        html.sc-phone .trackList__list,
        html.sc-phone .trackList__item {
            margin-left: 0 !important;
            padding-left: 0 !important;
        }

        /* song rows: cover, title over artist, length (no number, plays or header row; dragging to reorder
           needs a mouse) */
        html.sc-phone .trackItem {
            grid-template-columns: 48px minmax(0, 1fr) auto !important;
            column-gap: 12px !important;
            padding: 6px 0 !important;
            border-bottom: none !important;
            border-radius: 4px !important;
        }

        html.sc-phone .trackItem__image      { grid-column: 1 !important; }
        html.sc-phone .trackItem__content    { grid-column: 2 !important; }
        html.sc-phone .trackItem__additional { grid-column: 3 !important; }

        html.sc-phone .sc-tp-row {
            grid-template-columns: 0 48px minmax(0, 1fr) auto !important;
            column-gap: 12px !important;
            padding: 6px 0 !important;
            border-bottom: none !important;
        }

        html.sc-phone .trackItem__numberWrapper,
        html.sc-phone .trackItem__number,
        html.sc-phone .sc-tp-row .sc-tp-num,
        html.sc-phone .trackItem__play,
        html.sc-phone .sc-tp-head,
        html.sc-phone #sc-reorder-bar {
            display: none !important;
        }

        html.sc-phone .trackItem__image,
        html.sc-phone .trackItem__image img,
        html.sc-phone .trackItem__image .image,
        html.sc-phone .trackItem__image span.sc-artwork,
        html.sc-phone .sc-tp-row > img {
            width: 48px !important;
            height: 48px !important;
        }

        html.sc-phone .trackItem__trackTitle,
        html.sc-phone .sc-tp-row-title {
            font-size: 16px !important;
            color: #ffffff !important;
        }

        html.sc-phone .trackItem.active .trackItem__trackTitle {
            color: var(--sc-accent) !important;
        }

        html.sc-phone .trackItem:hover:not(.active) {
            background: transparent !important; /* a tap leaves :hover stuck on iPhone */
        }

        html.sc-phone .trackItem__additional,
        html.sc-phone .sc-row-right {
            grid-template-columns: 0 0 0 0 0 0 44px !important;
        }

        html.sc-phone .trackItem__additional > *:not(.sc-track-dur),
        html.sc-phone .sc-row-right > *:not(.sc-row-dur) {
            display: none !important;
        }

        /* settings and notifications: a sheet across the width of the screen */
        html.sc-phone #sc-settings,
        html.sc-phone #sc-notes {
            position: fixed !important;
            top: calc(var(--sc-bar-h) + 6px) !important;
            left: 8px !important;
            right: 8px !important;
            width: auto !important;
            max-width: none !important;
            max-height: calc(100dvh - var(--sc-bar-h) - var(--sc-tabs-h) - 20px) !important;
            transform: none !important;
        }

        html.sc-phone #sc-ly-full .sc-lyf-settings {
            top: calc(env(safe-area-inset-top) + 64px) !important;
            left: 8px !important;
            right: 8px !important;
            width: auto !important;
        }

        html.sc-phone .sc-set-tabs {
            flex-wrap: nowrap !important;
            overflow-x: auto !important;
            scrollbar-width: none;
        }

        html.sc-phone .sc-set-tabs button {
            flex: 0 0 auto !important;
        }

        /* artist pages: picture centred, the name under it */
        html.sc-phone body.sc-artist .l-user-hero {
            padding: 24px 14px 12px 14px !important;
        }

        html.sc-phone body.sc-artist .profileHeaderInfo {
            flex-direction: column !important;
            align-items: center !important;
            gap: 14px !important;
            text-align: center !important;
        }

        html.sc-phone body.sc-artist .profileHeaderInfo__avatar,
        html.sc-phone body.sc-artist .profileHeaderInfo__avatar .image,
        html.sc-phone body.sc-artist .profileHeaderInfo__avatar span.sc-artwork {
            width: 160px !important;
            height: 160px !important;
        }

        html.sc-phone body.sc-artist .profileHeaderInfo__content {
            width: 100% !important;
            padding: 0 !important;
        }

        html.sc-phone body.sc-artist .profileHeaderInfo__userName {
            font-size: 34px !important;
            justify-content: center !important;
            overflow-wrap: anywhere !important;
        }

        html.sc-phone body.sc-artist .l-user-main {
            padding: 0 14px !important;
        }

        html.sc-phone #sc-artist-popular {
            grid-template-columns: minmax(0, 1fr) !important;
            gap: 28px !important;
        }

        html.sc-phone .sc-pop-row {
            grid-template-columns: 18px 48px minmax(0, 1fr) 40px !important;
            gap: 12px !important;
            padding: 6px 4px !important;
            border-bottom: none !important;
        }

        html.sc-phone .sc-pop-row img {
            width: 48px !important;
            height: 48px !important;
        }

        html.sc-phone .sc-pop-plays {
            display: none !important;
        }

        html.sc-phone .sc-pop-title {
            font-size: 15px !important;
            color: #ffffff;
        }

        /* tiles two to a row */
        html.sc-phone body.sc-tiles .userMain__content ul.soundList,
        html.sc-phone body.sc-tiles .userMain__content .soundList > ul,
        html.sc-phone .sc-tp-more {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
            gap: 20px 14px !important;
        }

        /* Your Library tab: the library panel as a screen of its own (under the page layer, which is emptied
           while it shows, so the mini player stays on top) */
        html.sc-phone #lc-left-bar {
            display: none !important;
        }

        html.sc-phone.sc-phone-library #lc-left-bar {
            display: flex !important;
            top: var(--sc-bar-h) !important;
            left: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
            width: auto !important;
            border: none !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            background: #121212 !important;
            padding: 4px 6px calc(var(--sc-tabs-h) + var(--sc-mini-h) + 24px) 6px !important;
            box-sizing: border-box !important;
        }

        html.sc-phone.sc-phone-library #app {
            background: transparent !important;
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
            pointer-events: none !important;
        }

        html.sc-phone.sc-phone-library #app > *:not(.playControls) {
            visibility: hidden !important; /* not display: none, so the page keeps its scroll position */
        }

        html.sc-phone #lc-left-bar .sc-sidebar-row {
            padding: 6px 8px !important;
            gap: 12px !important;
        }

        html.sc-phone #lc-left-bar .sc-sidebar-icon-box,
        html.sc-phone #lc-left-bar .sc-sidebar-thumb,
        html.sc-phone #lc-left-bar .sc-sidebar-liked-box {
            width: 64px !important;
            height: 64px !important;
            min-width: 64px !important;
            border-radius: 6px;
        }

        html.sc-phone #lc-left-bar .sc-sidebar-thumb.circle {
            border-radius: 50% !important;
        }

        html.sc-phone #lc-left-bar .sc-sidebar-title {
            font-size: 16px !important;
        }

        html.sc-phone #lc-left-bar .sc-sidebar-item-sub {
            font-size: 13px !important;
        }

        /* the mini player: cover, title and artist, like, play; a thin progress line along the bottom */
        html.sc-phone body div.playControls,
        html.sc-phone body div.playControls.g-z-index-control-bar {
            bottom: calc(var(--sc-tabs-h) + 4px) !important;
            height: var(--sc-mini-h) !important;
            display: block !important;
        }

        html.sc-phone body section.playControls__inner {
            left: 8px !important;
            right: 8px !important;
            width: auto !important;
            max-width: none !important;
            height: var(--sc-mini-h) !important;
            transform: none !important;
            opacity: 1 !important;
            visibility: visible !important;
            padding: 0 6px !important;
            border: none !important;
            border-radius: 10px !important;
            background: color-mix(in srgb, var(--sc-accent) 38%, #181818) !important;
            box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5) !important;
            overflow: hidden !important;
        }

        html.sc-phone body .playControls__elements {
            grid-template-columns: auto minmax(0, 1fr) auto auto !important;
            grid-template-rows: var(--sc-mini-h) !important;
            column-gap: 10px !important;
        }

        html.sc-phone body .playControls__elements::before {
            display: none !important;
        }

        html.sc-phone body .playControls__shuffle,
        html.sc-phone body .playControls__prev,
        html.sc-phone body .playControls__next,
        html.sc-phone body .playControls__repeat,
        html.sc-phone body .playbackSoundBadge__showQueue,
        html.sc-phone body .playControls__volume,
        html.sc-phone body .playControls__queue {
            display: none !important;
        }

        /* the badge also holds follow and queue buttons, which took extra columns and pushed play inwards */
        html.sc-phone body .playbackSoundBadge > *:not(.playbackSoundBadge__avatar):not(.playbackSoundBadge__titleContextContainer):not(.playbackSoundBadge__actions),
        html.sc-phone body .playbackSoundBadge__actions > *:not(.playbackSoundBadge__like) {
            display: none !important;
        }

        /* anything else SoundCloud puts in the bar lands in extra columns: those get no width, so play stays at
           the right edge (spacing comes from margins, since column gaps would also be added for them) */
        html.sc-phone body .playControls__elements {
            width: 100% !important;
            grid-auto-columns: 0 !important;
            column-gap: 0 !important;
        }

        html.sc-phone body:not(.sc-lyf-open) .playbackSoundBadge__avatar {
            margin-right: 10px !important;
        }

        html.sc-phone body:not(.sc-lyf-open) .playbackSoundBadge__like {
            margin: 0 6px 0 8px !important;
        }

        html.sc-phone body:not(.sc-lyf-open) .playControls__play {
            margin-right: 4px !important;
        }

        html.sc-phone body .playbackSoundBadge__titleContextContainer,
        html.sc-phone body .playbackSoundBadge__titleContextContainer * {
            align-items: flex-start !important;
            justify-content: flex-start !important;
            text-align: left !important;
        }

        html.sc-phone body .playbackSoundBadge__avatar                { grid-column: 1 !important; grid-row: 1 !important; }
        html.sc-phone body .playbackSoundBadge__titleContextContainer { grid-column: 2 !important; grid-row: 1 !important; }
        html.sc-phone body .playbackSoundBadge__like                  { grid-column: 3 !important; grid-row: 1 !important; }
        html.sc-phone body .playControls__play                        { grid-column: 4 !important; grid-row: 1 !important; }

        html.sc-phone body .playControls .playControls__play.playControl {
            width: 36px !important;
            height: 36px !important;
            min-width: 36px !important;
        }

        html.sc-phone body .playControls__timeline {
            position: absolute !important;
            left: 8px !important;
            right: 8px !important;
            bottom: 0 !important;
            height: 2px !important;
            margin: 0 !important;
            pointer-events: none !important;
        }

        html.sc-phone body .playbackTimeline__timePassed,
        html.sc-phone body .playbackTimeline__duration {
            display: none !important;
        }

        html.sc-phone body .playbackTimeline__progressWrapper {
            height: 2px !important;
            padding: 0 !important;
            margin: 0 !important;
        }

        /* the tab bar */
        #sc-phone-tabs {
            display: none;
        }

        html.sc-phone #sc-phone-tabs {
            display: flex;
            position: fixed;
            left: 0;
            right: 0;
            bottom: 0;
            height: var(--sc-tabs-h);
            padding: 6px 4px env(safe-area-inset-bottom) 4px;
            box-sizing: border-box;
            background: #000000;
            z-index: 1002;
        }

        #sc-phone-tabs button {
            flex: 1 1 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 3px;
            padding: 0;
            border: none;
            background: none;
            color: #a7a7a7;
            font: 600 10.5px "SF Pro Display", "Inter", -apple-system, sans-serif;
            -webkit-tap-highlight-color: transparent;
        }

        #sc-phone-tabs button.sc-on {
            color: #ffffff;
        }

        #sc-phone-tabs svg {
            width: 25px;
            height: 25px;
        }

        /* Now Playing (the fullscreen lyrics, opened from the mini player or the Lyrics tab): cover, title and
           artist on top, the lyrics, then the full controls */
        html.sc-phone body.sc-lyf-open #sc-phone-tabs {
            display: none !important;
        }

        html.sc-phone body.sc-lyf-open div.playControls,
        html.sc-phone body.sc-lyf-open div.playControls.g-z-index-control-bar {
            bottom: calc(env(safe-area-inset-bottom) + 10px) !important;
            height: 92px !important;
        }

        html.sc-phone body.sc-lyf-open section.playControls__inner {
            height: 92px !important;
            background: rgba(0, 0, 0, 0.3) !important;
            box-shadow: none !important;
            border-radius: 16px !important;
            padding: 0 14px !important;
        }

        html.sc-phone body.sc-lyf-open .playControls__elements {
            grid-template-columns: minmax(0, 1fr) auto auto auto auto auto minmax(0, 1fr) !important;
            grid-template-rows: 24px 60px !important;
            column-gap: 18px !important;
        }

        html.sc-phone body.sc-lyf-open .playbackSoundBadge__avatar,
        html.sc-phone body.sc-lyf-open .playbackSoundBadge__titleContextContainer,
        html.sc-phone body.sc-lyf-open .playbackSoundBadge__like {
            display: none !important;
        }

        html.sc-phone body.sc-lyf-open .playControls__shuffle,
        html.sc-phone body.sc-lyf-open .playControls__prev,
        html.sc-phone body.sc-lyf-open .playControls__next,
        html.sc-phone body.sc-lyf-open .playControls__repeat {
            display: flex !important;
        }

        html.sc-phone body.sc-lyf-open .playControls__shuffle { grid-column: 2 !important; grid-row: 2 !important; }
        html.sc-phone body.sc-lyf-open .playControls__prev    { grid-column: 3 !important; grid-row: 2 !important; }
        html.sc-phone body.sc-lyf-open .playControls__play    { grid-column: 4 !important; grid-row: 2 !important; }
        html.sc-phone body.sc-lyf-open .playControls__next    { grid-column: 5 !important; grid-row: 2 !important; }
        html.sc-phone body.sc-lyf-open .playControls__repeat  { grid-column: 6 !important; grid-row: 2 !important; }

        html.sc-phone body.sc-lyf-open .playControls .playControls__play.playControl {
            width: 54px !important;
            height: 54px !important;
            min-width: 54px !important;
        }

        html.sc-phone body.sc-lyf-open .playControls__timeline {
            position: relative !important;
            left: auto !important;
            right: auto !important;
            bottom: auto !important;
            grid-column: 1 / -1 !important;
            grid-row: 1 !important;
            height: auto !important;
            pointer-events: auto !important;
        }

        html.sc-phone body.sc-lyf-open .playbackTimeline__progressWrapper {
            height: 4px !important;
        }

        html.sc-phone .sc-lyf-vol {
            display: none !important;
        }

        html.sc-phone .sc-lyf-top {
            top: calc(env(safe-area-inset-top) + 6px) !important;
        }

        html.sc-phone body .sc-lyf-stage {
            inset: 0 0 calc(env(safe-area-inset-bottom) + 116px) 0 !important;
            display: flex !important;
            flex-direction: column !important;
            align-items: stretch !important;
            gap: 14px !important;
            padding: calc(env(safe-area-inset-top) + 58px) 22px 0 22px !important;
        }

        html.sc-phone .sc-lyf-art {
            justify-self: auto !important;
            width: auto !important;
            max-width: none !important;
            display: grid !important;
            grid-template-columns: 64px minmax(0, 1fr) !important;
            column-gap: 14px !important;
            align-items: center !important;
            flex: none !important;
        }

        html.sc-phone .sc-lyf-cover {
            grid-row: 1 / 3;
        }

        html.sc-phone .sc-lyf-cover img {
            border-radius: 6px !important;
            box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5) !important;
        }

        html.sc-phone .sc-lyf-title {
            margin-top: 0 !important;
            font-size: 19px !important;
            align-self: end;
            text-align: left !important;
        }

        html.sc-phone .sc-lyf-artist {
            margin-top: 2px !important;
            font-size: 14px !important;
            align-self: start;
            text-align: left !important;
        }

        html.sc-phone .sc-lyf-lyrics {
            flex: 1 1 auto !important;
            height: auto !important;
        }

        html.sc-phone .sc-lyf-lyrics .sc-ly-scroll {
            padding: 30% 60px 50% 60px !important; /* the sides stay 60px: the scroll area reaches 60px past the text (glow room) */
        }

        html.sc-phone .sc-lyf-lyrics .sc-ly-line {
            font-size: calc(27px * var(--lyf-lyric)) !important;
            margin-bottom: 16px !important;
        }
    `;

    const phoneIcon = (d, filled) => `<svg viewBox="0 0 24 24" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="${filled ? 0 : 2}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
    let phoneView = null;          // null (the page), 'search' or 'library'
    let phonePath = location.pathname;

    const applyPhoneView = () => {
        const html = document.documentElement;
        html.classList.toggle('sc-phone-search', phoneView === 'search');
        html.classList.toggle('sc-phone-library', phoneView === 'library');
        const tabs = document.getElementById('sc-phone-tabs');
        if (!tabs) return;
        const path = location.pathname;
        const on = phoneView || (path === '/' || path === '/discover' ? 'home' : '');
        tabs.querySelectorAll('button').forEach(b => b.classList.toggle('sc-on', b.dataset.tab === on));
    };

    const setupPhone = () => {
        if (!PHONE) return;
        const leftBar = document.getElementById('lc-left-bar');
        if (leftBar) leftBar.classList.add('expanded'); // the library screen always shows names and filters
        // a new page closes the library screen, and the search box unless it is the search results
        if (location.pathname !== phonePath) {
            phonePath = location.pathname;
            if (phoneView === 'library' || (phoneView === 'search' && !phonePath.startsWith('/search'))) phoneView = null;
            if (phonePath.startsWith('/search')) phoneView = 'search';
            applyPhoneView();
        }
        if (document.getElementById('sc-phone-tabs')) return;

        addStyle(PHONE_CSS);
        const tabs = document.createElement('nav');
        tabs.id = 'sc-phone-tabs';
        tabs.innerHTML = `
            <button type="button" data-tab="home">${phoneIcon('<path d="M12.5 3.25a1 1 0 0 0-1 0l-7.5 4.5a1 1 0 0 0-.5.86V20a1 1 0 0 0 1 1h5v-6h5v6h5a1 1 0 0 0 1-1V8.61a1 1 0 0 0-.5-.86z"/>', true)}<span>Home</span></button>
            <button type="button" data-tab="library">${phoneIcon('<path d="M4 4v16"/><path d="M8.5 6v14"/><path d="M13 6v14"/><path d="m16.5 6 4 14"/>')}<span>Your Library</span></button>
            <button type="button" data-tab="lyrics">${phoneIcon('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>')}<span>Lyrics</span></button>
        `;
        document.body.appendChild(tabs);
        tabs.addEventListener('click', (e) => {
            const tab = e.target.closest('button');
            if (!tab) return;
            if (tab.dataset.tab === 'home') {
                phoneView = null;
                if (location.pathname === '/discover') window.scrollTo({ top: 0, behavior: 'smooth' });
                else navigate('/discover');
            } else if (tab.dataset.tab === 'search') {
                phoneView = phoneView === 'search' && !location.pathname.startsWith('/search') ? null : 'search';
                if (phoneView) setTimeout(() => { const input = document.getElementById('sc-custom-search-input'); if (input) input.focus(); }, 50);
            } else if (tab.dataset.tab === 'library') {
                phoneView = phoneView === 'library' ? null : 'library';
            } else if (tab.dataset.tab === 'lyrics') {
                openLyricsFull();
                return;
            }
            applyPhoneView();
        });
        // a library row opens its page (the screen closes when the page changes, see above)
        if (leftBar) leftBar.addEventListener('click', (e) => {
            if (e.target.closest('a[href]') && phoneView === 'library') { phoneView = null; applyPhoneView(); }
        });
        // tapping the mini player's cover or title opens Now Playing instead of the song's page
        document.addEventListener('click', (e) => {
            if (document.body.classList.contains('sc-lyf-open')) return;
            const badge = e.target.closest && e.target.closest('.playControls .playbackSoundBadge__avatar, .playControls .playbackSoundBadge__titleContextContainer');
            if (!badge) return;
            e.preventDefault();
            e.stopPropagation();
            openLyricsFull();
        }, true);
        applyPhoneView();
    };

    /* ---------- Main DOM pass ---------- */
    const HIDE_SELECTOR = 'header[role="banner"], .banner.m-promotion, .l-product-banners, .announcements, .profileHeaderWrapper__stickyHeader, .dropbar, .l-sidebar-right, .userMain__header, .profileHeaderWrapper, .profileHeaderBackground, .backgroundGradient, .profileHeader__chooserWrapper, .headerImageEditChooser, .bannerLinksButton, .l-about-left, .listen__sidebar, .sidebarHeader, .playControls__bg, .playControls_bg, .playControls__bgWrapper, .playControls__panel, .playControlsPanel, .playControls__castControl';

    const cleanDOM = () => {
        // Hide instead of .remove(): SoundCloud is React-managed and breaks when its nodes vanish
        document.querySelectorAll(HIDE_SELECTOR).forEach(el => {
            el.style.setProperty('display', 'none', 'important');
        });

        if (!document.getElementById('lc-top-bar')) {
            const topBar = document.createElement('div');
            topBar.id = 'lc-top-bar';
            topBar.innerHTML = `
                <div class="sc-top-left">
                    <a href="/discover" class="sc-top-logo" title="Home">
                        <svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><rect x="1" y="17" width="1.6" height="6" rx="0.8"/><rect x="4" y="15" width="1.6" height="8" rx="0.8"/><rect x="7" y="13" width="1.6" height="10" rx="0.8"/><rect x="10" y="14" width="1.6" height="9" rx="0.8"/><rect x="13" y="11" width="1.6" height="12" rx="0.8"/><path d="M16.2 10.4c1-.5 2.1-.8 3.3-.8 3.8 0 6.9 2.9 7.2 6.6.4-.1.8-.2 1.3-.2 2.200 0 4 1.800 4 4s-1.800 4-4 4H16.200z"/></svg>
                    </a>
                    <a href="/signin" class="sc-top-profile-btn" title="Profile">
                        <img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" alt="" id="sc-user-profile-img" />
                        <span class="sc-top-profile-name">Sign in</span>
                    </a>
                </div>
                <div class="sc-top-search-wrap">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#b3b3b3" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                    <input type="text" id="sc-custom-search-input" placeholder="What do you want to play?" />
                </div>
                <div class="sc-top-nav-right">
                    <button type="button" class="sc-top-icon" data-act="import" title="Import music from another app">${strokeIcon('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>')}</button>
                    <a class="sc-top-icon" href="/upload" title="Upload a track">${strokeIcon('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>')}</a>
                    <button type="button" class="sc-top-icon sc-note-bell" data-act="notes" title="Notifications">${strokeIcon('<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>')}<span class="sc-note-badge"></span></button>
                    <a class="sc-top-icon" href="/you/library" title="Library">${strokeIcon('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>')}</a>
                    <button type="button" class="sc-top-icon" data-act="settings" title="Settings">${strokeIcon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>')}</button>
                </div>
            `;
            document.body.appendChild(topBar);
            topBar.querySelector('[data-act="import"]').addEventListener('click', openImportDialog);
            topBar.querySelector('[data-act="settings"]').addEventListener('click', () => toggleSettings());
            topBar.querySelector('[data-act="notes"]').addEventListener('click', () => toggleNotes());
            renderNoteBadge();

            // in the LiquidCloud app the bar is the window's title bar: minimise / maximise / close
            if (W.__liquidApp && W.__liquid && W.__liquid.window) {
                const line = (d) => `<svg viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1" vector-effect="non-scaling-stroke">${d}</svg>`;
                const controls = document.createElement('div');
                controls.className = 'sc-win-controls';
                controls.innerHTML = `
                    <button type="button" class="sc-win-btn" data-win="minimize" title="Minimise">${line('<line x1="0" y1="5.5" x2="11" y2="5.5"/>')}</button>
                    <button type="button" class="sc-win-btn" data-win="maximize" title="Maximise">
                        <span class="sc-win-maximize">${line('<rect x="0.5" y="0.5" width="10" height="10"/>')}</span>
                        <span class="sc-win-restore">${line('<rect x="0.5" y="2.5" width="8" height="8"/><polyline points="2.5,2.5 2.5,0.5 10.5,0.5 10.5,8.5 8.5,8.5"/>')}</span>
                    </button>
                    <button type="button" class="sc-win-btn sc-win-close" data-win="close" title="Close"><svg viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.1"><line x1="0.5" y1="0.5" x2="10.5" y2="10.5"/><line x1="10.5" y1="0.5" x2="0.5" y2="10.5"/></svg></button>`;
                controls.querySelectorAll('[data-win]').forEach(b => b.addEventListener('click', () => W.__liquid.window(b.dataset.win)));
                topBar.appendChild(controls);
            }

            const searchInput = document.getElementById('sc-custom-search-input');
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && searchInput.value.trim() !== '') {
                    navigate(`/search?q=${encodeURIComponent(searchInput.value.trim())}`);
                }
            });
        }

        if (!document.getElementById('lc-left-bar')) {
            const leftBar = document.createElement('div');
            leftBar.id = 'lc-left-bar';
            leftBar.innerHTML = `
                <div class="sc-lib-head">
                    <button type="button" class="sc-lib-toggle" id="sc-lib-toggle-row" title="Your Library">
                        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 6 4 14"></path><path d="M12 6v14"></path><path d="M8 8v12"></path><path d="M4 4v16"></path></svg>
                        <span>Your Library</span>
                    </button>
                    <a class="sc-lib-create" href="/you/sets" title="Create playlist">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        <span>Create</span>
                    </a>
                </div>
                <div class="sc-lib-chips">
                    <button type="button" data-filter="playlist">Playlists</button>
                    <button type="button" data-filter="artist">Artists</button>
                </div>
                <a class="sc-sidebar-row" href="/you/likes" data-type="playlist">
                    <div class="sc-sidebar-icon-box">
                        <div class="sc-sidebar-liked-box">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                        </div>
                    </div>
                    <div class="sc-sidebar-text-wrap">
                        <div class="sc-sidebar-title">Liked Songs</div>
                        <div class="sc-sidebar-item-sub" id="sc-lib-liked-sub">Playlist</div>
                    </div>
                </a>
                <div id="sc-sidebar-dynamic-container"></div>
            `;

            document.body.appendChild(leftBar);

            const toggleRow = document.getElementById('sc-lib-toggle-row');
            const setExpanded = (on) => {
                leftBar.classList.toggle('expanded', on);
                document.body.classList.toggle('sc-sidebar-is-expanded', on);
            };
            // remember whether the library was left open
            let wasExpanded = false;
            try { wasExpanded = localStorage.getItem('sc-lib-expanded') === '1'; } catch (e) {}
            setExpanded(wasExpanded);
            toggleRow.addEventListener('click', () => {
                const on = !leftBar.classList.contains('expanded');
                setExpanded(on);
                try { localStorage.setItem('sc-lib-expanded', on ? '1' : '0'); } catch (e) {}
            });

            leftBar.querySelector('.sc-lib-create').addEventListener('click', (e) => {
                e.preventDefault();
                openCreatePlaylistDialog();
            });

            // filter chips: click to show only that kind, click again to clear
            leftBar.querySelectorAll('.sc-lib-chips button').forEach((chip) => chip.addEventListener('click', () => {
                if (leftBar.dataset.filter === chip.dataset.filter) delete leftBar.dataset.filter;
                else leftBar.dataset.filter = chip.dataset.filter;
            }));

            loadLibraryData(document.getElementById('sc-sidebar-dynamic-container')).catch(() => {});
        }

        setupPhone();
        updateProfileBadge();
        updateBackground();
        sanitizeTrackTitles();
        markReleaseYears();
        setupScrollArea();
        setupPageTransitions();
        setupBarZone();
        setupPauseGuard();
        setupTrackReorder();
        resetScrollOnNavigate();
        setupVolume();
        setupShelfArrows();
        moveSearchFooter();
        updateArtistPage();
        updatePlaylistPage();
        updateTrackPage();
        runPendingAutoplay();
    };

    cleanDOM();
    applyLyfSettings();

    let timeout = null;
    const observer = new MutationObserver(() => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(cleanDOM, 100);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // The song page depends on state the observer cannot see (the iframe's own document, playback state)
    setInterval(() => {
        updateTrackPage();
        runPendingAutoplay();
        syncVolume();
    }, 400);

    setInterval(updateLyrics, 80);
    setTimeout(checkNotes, 4000);
    setInterval(checkNotes, 120000);
    setInterval(syncDesktopLyrics, 100);
    requestAnimationFrame(animateLyricWords);
    }
})();
