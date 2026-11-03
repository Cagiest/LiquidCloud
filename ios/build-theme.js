// Builds ios/Resources/theme.js: what the iPhone app (LiquidCloud/WebViewController.swift) runs in every
// SoundCloud page. It is the same theme the PC app runs (../app/inject.js: the userscript with its Tampermonkey
// stand-ins), plus the iPhone's side of the bridge:
//   window.__liquid.request   requests the theme can't make itself (lyrics sites), made by the app
//   now playing               the song, artist, cover and position, sent to the app for the lock screen
//   window.__liquidControl    play / pause / next / previous from the lock screen and headphones
// Next to it goes connect.json: the userscript's @connect sites, the only places the app will send requests.
//
//   node ios/build-theme.js   (the GitHub build runs it before building the app)

const fs = require('fs');
const path = require('path');
const { buildInjection, connectHosts } = require('../app/inject');

const BRIDGE = `
    try { if (localStorage.getItem('sc-phone') === null) localStorage.setItem('sc-phone', '1'); } catch (e) {}
    window.__liquid = {
        request: (options) => window.webkit.messageHandlers.liquid.postMessage(options).catch((e) => ({ error: String(e) }))
    };

    const q = (selector) => document.querySelector(selector);
    window.__liquidControl = (action) => {
        if (action === 'next' || action === 'prev') {
            const button = q(action === 'next' ? '.playControls .skipControl__next' : '.playControls .skipControl__previous');
            if (button) button.click();
            return;
        }
        const play = q('.playControls .playControls__play');
        if (!play) return;
        const playing = play.classList.contains('playing');
        if (action === 'toggle' || (action === 'play' && !playing) || (action === 'pause' && playing)) play.click();
    };

    const seconds = (el) => {
        const m = el && el.textContent.match(/(\\d+):(\\d+)(?::(\\d+))?/);
        if (!m) return 0;
        return m[3] ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : (+m[1]) * 60 + (+m[2]);
    };
    let lastSent = '';
    let lastSentAt = 0;
    setInterval(() => {
        const link = q('.playControls .playbackSoundBadge__titleLink');
        const artist = q('.playControls .playbackSoundBadge__lightLink');
        const cover = q('.playControls .playbackSoundBadge__avatar .sc-artwork');
        const play = q('.playControls .playControls__play');
        const art = cover ? (getComputedStyle(cover).backgroundImage.match(/url\\("?([^")]+)"?\\)/) || [])[1] || '' : '';
        const info = {
            title: link ? (link.getAttribute('title') || link.textContent).trim() : '',
            artist: artist ? (artist.getAttribute('title') || artist.textContent).trim() : '',
            artwork: art.replace(/-t\\d+x\\d+\\./, '-t500x500.'),
            playing: !!(play && play.classList.contains('playing')),
            position: seconds(q('.playControls .playbackTimeline__timePassed span[aria-hidden]') || q('.playControls .playbackTimeline__timePassed')),
            duration: seconds(q('.playControls .playbackTimeline__duration span[aria-hidden]') || q('.playControls .playbackTimeline__duration'))
        };
        // the lock screen moves the position along by itself, so only changes (or a resync every 5 s) are sent
        const key = [info.title, info.artist, info.artwork, info.playing, info.duration].join('|');
        if (key === lastSent && Date.now() - lastSentAt < 5000) return;
        lastSent = key;
        lastSentAt = Date.now();
        window.webkit.messageHandlers.nowPlaying.postMessage(info);
    }, 1000);
`;

const out = path.join(__dirname, 'Resources');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'theme.js'), `(() => {
    if (location.hostname !== 'soundcloud.com' || window.top !== window) return; // not the sign-in pages
    ${BRIDGE}
    ${buildInjection({ tap: false })}
})();
`);
fs.writeFileSync(path.join(out, 'connect.json'), JSON.stringify(connectHosts()));
console.log(`Built ${out}`);
