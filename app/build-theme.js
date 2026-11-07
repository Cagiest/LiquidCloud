// Builds browser-assets/theme.js: what LiquidCloud's SoundCloud window (browser/Program.cs) runs in every
// SoundCloud page. It is the theme (../liquidcloud.user.js) with its Tampermonkey stand-ins and
// audio-tap.js (inject.js), plus the bridge they use: window.__liquid over WebView2's messages. Next to it go
// adblock.json (the ad-blocking list) and connect.json (the sites the theme may reach).
//
//   npm run build-theme   (main.js also runs it on start when running from source)

const fs = require('fs');
const path = require('path');
const { buildInjection, connectHosts } = require('./inject');

// window.__liquid as the theme and audio-tap.js expect it: requests are answered by the window program.
// It also marks the page as the app (<html class="sc-app">, window.__liquidApp: the theme's top bar becomes
// the window's title bar), carries the window buttons, and keeps sc-maximized on <html> in step.
const PAGE_BRIDGE = `
    if (!window.__liquid && window.chrome && window.chrome.webview) {
        let next = 0;
        const pending = new Map();
        window.__liquidApp = true;
        document.documentElement.classList.add('sc-app');
        window.chrome.webview.addEventListener('message', (e) => {
            const msg = e.data;
            if (msg && msg.type === 'response' && pending.has(msg.id)) {
                pending.get(msg.id)(msg.result);
                pending.delete(msg.id);
            } else if (msg && msg.type === 'window-state') {
                document.documentElement.classList.toggle('sc-maximized', !!msg.maximized);
            }
        });
        window.__liquid = {
            request: (options) => new Promise((resolve) => {
                const id = ++next;
                pending.set(id, resolve);
                window.chrome.webview.postMessage({ type: 'request', id, options });
            }),
            audio: (levels) => window.chrome.webview.postMessage({ type: 'audio', levels }),
            window: (action) => window.chrome.webview.postMessage({ type: 'window', action }),
            log: (text) => window.chrome.webview.postMessage({ type: 'log', text: String(text).slice(0, 300) })
        };
        window.chrome.webview.postMessage({ type: 'window', action: 'state' }); // ask whether it starts maximised
    }
`;

const build = (out = path.join(__dirname, 'browser-assets')) => {
    fs.mkdirSync(out, { recursive: true });
    const file = path.join(out, 'theme.js');
    fs.writeFileSync(file, `(() => {\n${PAGE_BRIDGE}\n${buildInjection()}\n})();\n`);
    // variants for testing features one at a time: without the audio listener, and without ad muting
    fs.writeFileSync(path.join(out, 'theme-notap.js'), `(() => {\n${PAGE_BRIDGE}\n${buildInjection({ tap: false })}\n})();\n`);
    fs.writeFileSync(path.join(out, 'theme-nomute.js'), `(() => {\n${PAGE_BRIDGE}\n${buildInjection({ muteAds: false })}\n})();\n`);
    fs.copyFileSync(path.join(__dirname, 'adblock.json'), path.join(out, 'adblock.json'));
    fs.writeFileSync(path.join(out, 'connect.json'), JSON.stringify(connectHosts())); // the userscript's @connect sites
    return out;
};

module.exports = { build };
if (require.main === module) console.log(`Built ${build()}`);
