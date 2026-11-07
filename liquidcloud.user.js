// ==UserScript==
// @name         SoundCloud Spotify Layout & Dynamic Background
// @namespace    http://tampermonkey.net/
// @version      7.0
// @description  LiquidCloud: a Spotify-style look for SoundCloud. Loads the newest version from GitHub every time SoundCloud opens, so it never needs updating by hand.
// @homepageURL  https://github.com/Cagiest/LiquidCloud
// @supportURL   https://github.com/Cagiest/LiquidCloud/issues
// @updateURL    https://raw.githubusercontent.com/Cagiest/LiquidCloud/main/liquidcloud.user.js
// @downloadURL  https://raw.githubusercontent.com/Cagiest/LiquidCloud/main/liquidcloud.user.js
// @match        https://soundcloud.com/*
// @grant        GM_addStyle
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM.addStyle
// @grant        GM.xmlHttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      raw.githubusercontent.com
// @connect      genius.com
// @connect      127.0.0.1
// @noframes
// @run-at       document-start
// ==/UserScript==

// The theme itself is soundcloud-spotify.user.js in the same repository. Each time SoundCloud opens, this asks
// GitHub for it (about a fifth of a second) and runs it; if GitHub doesn't answer within a few seconds, or you're
// offline, the last copy it got runs instead. GitHub may serve a copy up to five minutes old after a new version
// is pushed.
(function () {
    'use strict';

    const SOURCE = 'https://raw.githubusercontent.com/Cagiest/LiquidCloud/main/soundcloud-spotify.user.js';
    const WAIT = 3000;

    let ran = false;
    const run = (code) => {
        if (ran || !code) return;
        ran = true;
        try {
            new Function('GM_addStyle', 'GM_xmlhttpRequest', 'GM', 'unsafeWindow', code)(
                GM_addStyle, GM_xmlhttpRequest, typeof GM !== 'undefined' ? GM : undefined, unsafeWindow);
        } catch (e) {
            console.error('[LiquidCloud] the theme failed to start', e);
        }
    };

    // only keep something that really is the theme (not an error page)
    const looksRight = (text) => typeof text === 'string' && text.length > 50000 && text.includes('==UserScript==');

    const cached = GM_getValue('theme', '');
    const fallback = setTimeout(() => run(cached), WAIT);

    GM_xmlhttpRequest({
        method: 'GET',
        url: SOURCE,
        timeout: 15000,
        onload: (r) => {
            if (r.status === 200 && looksRight(r.responseText)) {
                if (r.responseText !== cached) GM_setValue('theme', r.responseText);
                clearTimeout(fallback);
                run(r.responseText); // (if the old copy already ran, the new one is used from the next page load)
            } else {
                clearTimeout(fallback);
                run(cached);
            }
        },
        onerror: () => { clearTimeout(fallback); run(cached); },
        ontimeout: () => { clearTimeout(fallback); run(cached); }
    });
})();
