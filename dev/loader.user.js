// ==UserScript==
// @name         LiquidCloud (dev loader)
// @namespace    http://tampermonkey.net/
// @version      6.29.1
// @description  DEV LOADER - loads the script being developed from 127.0.0.1:8765 and lets the dev session inspect the page. Replace with the final script when development is done.
// @match        https://soundcloud.com/*
// @grant        GM_addStyle
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      127.0.0.1
// @connect      genius.com
// @noframes
// ==/UserScript==

(function() {
    'use strict';

    const DEV = 'http://127.0.0.1:8765';

    const request = (method, url, data) => new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method, url, data, timeout: 8000,
            onload: (r) => resolve(r.responseText),
            onerror: reject,
            ontimeout: reject
        });
    });

    const run = (src) => {
        try {
            new Function('GM_addStyle', 'unsafeWindow', 'GM_xmlhttpRequest', src)(GM_addStyle, unsafeWindow, GM_xmlhttpRequest);
        } catch (e) {
            console.error('[sc-dev] script failed', e);
        }
    };

    // Load the script from the dev server; fall back to the last copy that loaded, so the
    // theme still works when the dev server is not running.
    request('GET', DEV + '/payload.js')
        .then((src) => { GM_setValue('payload', src); run(src); })
        .catch(() => { const cached = GM_getValue('payload', ''); if (cached) run(cached); });

    // Command bridge: the dev session can ask the visible tab to run a snippet and report back.
    let delay = 1500;
    const poll = async () => {
        try {
            const vis = document.visibilityState === 'visible' ? '1' : '0';
            const reply = JSON.parse(await request('GET', DEV + '/poll?vis=' + vis));
            delay = 1500;
            for (const cmd of reply.cmds) {
                let out;
                try {
                    const fn = new Function('unsafeWindow', 'GM_addStyle', 'return (async () => {' + cmd.js + '\n})()');
                    out = await fn(unsafeWindow, GM_addStyle);
                } catch (e) {
                    out = { error: String(e && e.stack || e) };
                }
                let text;
                try { text = JSON.stringify(out === undefined ? null : out); } catch (e) { text = JSON.stringify({ error: 'unserialisable result' }); }
                request('POST', DEV + '/result?id=' + cmd.id, text).catch(() => {});
            }
        } catch (e) {
            delay = 10000;
        }
        setTimeout(poll, delay);
    };
    poll();
})();
