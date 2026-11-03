// The LiquidCloud theme (the userscript in ..) as the extension runs it in SoundCloud (build-extension.js
// puts this into extension/theme.js). The userscript was written for Tampermonkey, so it gets the three
// things it asks for under the same names:
//   GM_addStyle         adds a <style>
//   unsafeWindow        the page's window (the script already runs in the page here)
//   GM_xmlhttpRequest   a request through the extension (window.__liquid.request, checked in background.js)
// audio-tap.js (hearing the song for the overlay's aura) goes in alongside.

const fs = require('fs');
const path = require('path');

// the packaged app carries its own copy; running from source reads the one in .. (edited live)
const USERSCRIPT = [path.join(__dirname, 'soundcloud-spotify.user.js'), path.join(__dirname, '..', 'soundcloud-spotify.user.js')].find(f => fs.existsSync(f));
const AUDIO_TAP = path.join(__dirname, 'audio-tap.js');

const SHIMS = `
    const GM_addStyle = (css) => {
        const style = document.createElement('style');
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
        return style;
    };
    const unsafeWindow = window;
    const GM_xmlhttpRequest = (o) => {
        const call = (fn, arg) => { try { if (typeof fn === 'function') fn(arg); } catch (e) { console.error(e); } };
        window.__liquid.request({
            method: o.method || 'GET',
            url: String(o.url),
            headers: o.headers || {},
            data: typeof o.data === 'string' ? o.data : undefined,
            timeout: o.timeout
        }).then((r) => {
            if (!r || r.error) call(r && r.error === 'timeout' ? o.ontimeout : o.onerror, r || {});
            else call(o.onload, { status: r.status, responseText: r.responseText, response: r.responseText, finalUrl: r.finalUrl || o.url, readyState: 4 });
        }, (e) => call(o.onerror, e));
        return { abort() {} };
    };
`;

// the userscript's @connect sites: the only places its requests may go (besides the overlay)
const connectHosts = () => {
    const header = fs.readFileSync(USERSCRIPT, 'utf8').split('==/UserScript==')[0];
    return [...header.matchAll(/^\/\/\s*@connect\s+(\S+)/gm)].map(m => m[1]).filter(h => h !== '127.0.0.1' && h !== 'localhost');
};

// options (for testing features one at a time): tap = include audio-tap.js, muteAds = let it mute ads
const buildInjection = ({ tap: withTap = true, muteAds = true } = {}) => {
    const userscript = fs.readFileSync(USERSCRIPT, 'utf8');
    let tap = withTap ? fs.readFileSync(AUDIO_TAP, 'utf8') : '';
    if (!muteAds) tap = tap.replace('const MUTE_ADS = true;', 'const MUTE_ADS = false;');
    return `(() => {
        if (window.__liquidTheme) return;
        window.__liquidTheme = true;
        ${tap}
        ${SHIMS}
        ${userscript}
    })();`;
};

module.exports = { buildInjection, connectHosts };
