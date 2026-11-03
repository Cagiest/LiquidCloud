// LiquidCloud: SoundCloud as its own app, with the LiquidCloud theme, ad blocking, the lyrics overlay and
// Discord status. Two programs in one file:
//   LiquidCloud.Browser.exe (browser/)  the SoundCloud window: WebView2, Microsoft Edge's engine built into
//                                       Windows, so encrypted tracks get their keys and play; it runs the theme
//                                       (browser-assets/theme.js, built by build-theme.js) and blocks ads
//   this companion                      opens that window and stays in the tray with the lyrics overlay and
//                                       its aura (overlay/, copied from C:\presl\Lyrics\lyrics-overlay), Discord
//                                       status (discord.js) and the switches
// The window passes the theme's requests to the companion at http://127.0.0.1:8766, the same address the
// standalone overlay uses, so the theme talks to it exactly as it does in Opera with Tampermonkey.
//
// Settings: %APPDATA%\LiquidCloud\liquidcloud.json (app) and overlay.json (the lyrics overlay).
// The SoundCloud window's profile (sign-in, cookies) is %APPDATA%\LiquidCloud\webview2.

const { app, Tray, Menu, shell, nativeImage, dialog, globalShortcut } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const createOverlay = require('./overlay/core');
const createPresence = require('./discord');

const PORT = 8766;
const SOUNDCLOUD = 'https://soundcloud.com/';

app.setName('LiquidCloud');
// one LiquidCloud at a time: a second one hands over to the first (see 'second-instance') and is gone
// at once, before it can open a window or try for the port
const firstInstance = app.requestSingleInstanceLock();
if (!firstInstance) app.exit(0);

/* ---------- Settings ---------- */
const DEFAULTS = {
    blockAds: true,
    blockSoundCloudAds: false, // also SoundCloud's own audio ads; encrypted tracks may then be refused (see README)
    discordStatus: true,
    discordClientId: '',     // your Discord application's ID (discord.com/developers/applications)
    startWithWindows: false,
    profile: 'profile'       // the SoundCloud window's browser data folder in LiquidCloud's settings folder (sign-in, DRM identity)
};
const settingsFile = () => path.join(app.getPath('userData'), 'liquidcloud.json');
let settings = { ...DEFAULTS };
const loadSettings = () => {
    // (Notepad and PowerShell may start the file with a byte-order mark, which JSON.parse refuses)
    try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8').replace(/^\uFEFF/, '')) }; } catch (e) {}
};
const saveSettings = () => {
    try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch (e) {}
};

let tray = null;
let overlay = null;
const presence = createPresence();
let commands = [];       // play / next / previous for the SoundCloud page, picked up with its next update
let lastSeen = 0;        // when the theme last checked in
let lastSong = null;     // { title, pos, playing } from the last check-in, for troubleshooting

/* ---------- The SoundCloud window ---------- */
// From source: the published window program and the built theme. Packaged: resources/browser, copied first
// into the runtime folder in LiquidCloud's settings folder. The portable exe unpacks into the same temporary folder on every start
// and deletes it on exit, so opening LiquidCloud a second time (which hands over to the first and exits)
// deleted the theme from under the running one: the window then showed plain SoundCloud.
let runtimeReady = false;
const prepareRuntime = () => {
    const from = path.join(process.resourcesPath, 'browser');
    const to = path.join(app.getPath('userData'), 'runtime');
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) {
        const src = path.join(from, name);
        const dst = path.join(to, name);
        const a = fs.statSync(src);
        let b = null;
        try { b = fs.statSync(dst); } catch (e) {}
        // copied when new or different (size or content); the window program only when it is not running
        if (b && b.size === a.size && fs.readFileSync(src).equals(fs.readFileSync(dst))) continue;
        try { fs.copyFileSync(src, dst); } catch (e) { console.error(`could not update ${name}:`, e.message); }
    }
    runtimeReady = true;
};
const windowFiles = () => {
    if (!app.isPackaged) return { exe: path.join(__dirname, 'browser-publish', 'LiquidCloud.Browser.exe'), assets: path.join(__dirname, 'browser-assets') };
    if (!runtimeReady) prepareRuntime();
    const dir = path.join(app.getPath('userData'), 'runtime');
    return { exe: path.join(dir, 'LiquidCloud.Browser.exe'), assets: dir };
};

const openSoundCloud = () => {
    const { exe, assets } = windowFiles();
    if (!fs.existsSync(exe)) {
        dialog.showErrorBox('LiquidCloud', `The SoundCloud window program is missing:\n${exe}`);
        return;
    }
    // an incomplete unpack (LiquidCloud.exe started while it was being replaced) would show plain SoundCloud
    if (!fs.existsSync(path.join(assets, 'theme.js'))) {
        dialog.showErrorBox('LiquidCloud', 'LiquidCloud did not unpack completely, so the theme is missing. Quit LiquidCloud from the tray and open it again.');
        return;
    }
    let connect = [];
    try { connect = JSON.parse(fs.readFileSync(path.join(assets, 'connect.json'), 'utf8')); } catch (e) {}
    spawn(exe, [
        '--theme', path.join(assets, 'theme.js'),
        '--adblock', path.join(assets, 'adblock.json'),
        '--connect', connect.join(','),
        '--port', String(PORT),
        '--data', app.getPath('userData'),
        '--profile', /^[\w.-]+$/.test(String(settings.profile)) ? String(settings.profile) : 'profile'
    ], { detached: true, stdio: 'ignore' }).unref();
};

/* ---------- Receiving the song from the SoundCloud page ---------- */
const reply = (res, data) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
};
const server = http.createServer((req, res) => {
    // only the SoundCloud window's JSON posts: a web page cannot send this content type here without a CORS
    // preflight, which is never answered
    if (req.method !== 'POST' || !['/state', '/settings', '/audio'].includes(req.url) || !/application\/json/.test(req.headers['content-type'] || '')) {
        res.writeHead(404);
        res.end();
        return;
    }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 4e6) req.destroy();
    });
    req.on('end', () => {
        let data;
        try { data = JSON.parse(body); } catch (e) { res.writeHead(400); res.end(); return; }
        if (req.url === '/audio') { overlay.handleAudio(data); res.writeHead(204); res.end(); return; }
        // (connected / song: whether the theme has checked in lately and what it last reported, for troubleshooting)
        if (req.url === '/settings') { reply(res, { ...overlay.handleSettings(data), connected: Date.now() - lastSeen < 5000, song: lastSong }); return; }
        // SoundCloud in a browser with the userscript (Opera) posts here too: it drives the overlay, but only the
        // LiquidCloud window (which marks its posts; a web page cannot send this header here) counts as the
        // window being open, and only it gets the switches and commands
        const fromWindow = req.headers['x-liquidcloud-window'] === '1';
        if (fromWindow) lastSeen = Date.now();
        lastSong = { title: data.title || '', pos: Number(data.pos) || 0, playing: !!data.playing };
        presence.update(data);
        // the window picks up the ad-blocking switch and any waiting commands from this reply
        const state = overlay.handleState(data);
        reply(res, fromWindow ? { ...state, app: { blockAds: settings.blockAds, blockSoundCloudAds: settings.blockSoundCloudAds, commands: commands.splice(0) } } : state);
    });
});
server.on('error', (e) => {
    dialog.showErrorBox('LiquidCloud', e.code === 'EADDRINUSE'
        ? `Port ${PORT} is already in use, so SoundCloud cannot reach LiquidCloud. Quit the standalone Lyrics Overlay (tray icon) and start LiquidCloud again.`
        : String(e.message || e));
});

/* ---------- Tray ---------- */
// 32x32 icon drawn here: SoundCloud orange, with three white "lyric" lines
const makeIcon = () => {
    const size = 32;
    const buf = Buffer.alloc(size * size * 4);
    const bars = [[10, 9, 23], [15, 9, 21], [20, 9, 17]];
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = (y * size + x) * 4;
            const d = Math.hypot(x + 0.5 - 16, y + 0.5 - 16);
            const a = Math.max(0, Math.min(1, 15.5 - d));
            const bar = bars.some(([top, left, right]) => y >= top && y < top + 3 && x >= left && x < right);
            const [r, g, b] = bar ? [255, 255, 255] : [255, 85, 0];
            buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = Math.round(a * 255);
        }
    }
    return nativeImage.createFromBitmap(buf, { width: size, height: size });
};

const toggle = (key, after) => () => { settings[key] = !settings[key]; saveSettings(); if (after) after(); buildMenu(); };
const applyLogin = () => app.setLoginItemSettings({
    openAtLogin: settings.startWithWindows,
    path: process.execPath,
    args: app.isPackaged ? [] : [app.getAppPath()]
});
const applyDiscord = () => presence.configure({ id: String(settings.discordClientId || '').trim(), on: settings.discordStatus });
const command = (name) => () => commands.push(name);
// a SoundCloud window that is open checks in about five times a second
const soundCloudOpen = () => Date.now() - lastSeen < 3000;
const showSoundCloud = () => { if (soundCloudOpen()) commands.push('show'); else openSoundCloud(); };

const buildMenu = () => {
    if (!tray || !overlay) return;
    const playing = overlay.nowPlaying();
    const hasDiscordId = !!String(settings.discordClientId || '').trim();
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: playing ? `Now playing: ${playing.slice(0, 60)}` : playing === null ? 'SoundCloud is not open' : 'LiquidCloud', enabled: false },
        { type: 'separator' },
        { label: 'Open SoundCloud', click: showSoundCloud },
        { label: 'Play / pause', enabled: playing !== null, click: command('play') },
        { label: 'Next', enabled: playing !== null, click: command('next') },
        { label: 'Previous', enabled: playing !== null, click: command('previous') },
        { type: 'separator' },
        { label: 'Desktop lyrics', submenu: overlay.menuItems() },
        { label: 'Block ads', type: 'checkbox', checked: settings.blockAds, click: toggle('blockAds') },
        { label: "Also block SoundCloud's audio ads (encrypted songs may stop playing)", type: 'checkbox', checked: settings.blockSoundCloudAds, enabled: settings.blockAds, click: toggle('blockSoundCloudAds') },
        { label: hasDiscordId ? 'Discord status' : 'Discord status (add your application ID in settings)', type: 'checkbox', checked: settings.discordStatus && hasDiscordId, enabled: hasDiscordId, click: toggle('discordStatus', applyDiscord) },
        { label: 'Open settings file', click: () => { saveSettings(); shell.openPath(settingsFile()); } },
        { type: 'separator' },
        { label: 'Start with Windows', type: 'checkbox', checked: settings.startWithWindows, click: toggle('startWithWindows', applyLogin) },
        { label: 'Quit LiquidCloud', click: quitAll }
    ]));
    tray.setToolTip(playing ? `LiquidCloud — ${playing.slice(0, 100)}` : 'LiquidCloud');
};

// quitting closes the SoundCloud window too, the normal way, so SoundCloud's playback session ends properly
// (the window picks the command up with its next update, a fifth of a second later)
const quitAll = () => {
    if (!soundCloudOpen()) { app.quit(); return; }
    commands.push('quit');
    setTimeout(() => app.quit(), 2500);
};

/* ---------- Start ---------- */
// opening LiquidCloud again brings the SoundCloud window back (or opens it if it was closed)
app.on('second-instance', showSoundCloud);

app.whenReady().then(() => {
    if (!firstInstance) return;
    loadSettings();

    // the overlay keeps its settings in overlay.json; the first time, take the standalone overlay's
    const overlayFile = path.join(app.getPath('userData'), 'overlay.json');
    if (!fs.existsSync(overlayFile)) {
        try { fs.copyFileSync(path.join(app.getPath('appData'), 'Lyrics Overlay', 'settings.json'), overlayFile); } catch (e) {}
    }
    overlay = createOverlay({ settingsFile: overlayFile, onChange: buildMenu });

    tray = new Tray(makeIcon());
    tray.on('click', () => tray.popUpContextMenu());
    overlay.start();
    applyDiscord();
    buildMenu();
    server.listen(PORT, '127.0.0.1');

    if (!app.isPackaged) require('./build-theme').build(); // from source: always the current theme
    else prepareRuntime(); // straight away, before anything can delete the unpacked copy
    // a SoundCloud window left open from before checks in within a moment: then no second one
    setTimeout(() => { if (!soundCloudOpen()) openSoundCloud(); }, 1500);

    // the settings file can be edited while the app runs (to add the Discord application ID)
    fs.watchFile(settingsFile(), { interval: 2000 }, () => { loadSettings(); applyDiscord(); buildMenu(); });

    globalShortcut.register('Ctrl+Alt+L', overlay.toggleLock);
    globalShortcut.register('Ctrl+Alt+H', overlay.toggleHidden);
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    fs.unwatchFile(settingsFile());
    presence.stop();
    if (overlay) overlay.flush();
    saveSettings();
});
app.on('window-all-closed', (e) => e.preventDefault()); // the overlay window may close; the tray stays
