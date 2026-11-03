// The overlays: transparent windows, always on top, for whatever is playing on SoundCloud. Shared by the
// standalone Lyrics Overlay (main.js, fed by the userscript over http://127.0.0.1:8766) and the SoundCloud app
// (fed directly). Two of them, each placed, sized and hidden on its own:
//   lyrics        the lyrics with the aura behind them
//   now playing   the song's cover, title and artist
// Both are the same page (overlay.html?part=lyrics / ?part=info).
//
// Unlocked: each has a dashed outline, can be dragged anywhere and resized from its corner.
// Locked:   clicks go straight through them to whatever is underneath (both lock together).
//
// createOverlay({ settingsFile, onChange }) returns the controls; onChange() is called whenever something
// a menu shows has changed (a setting, the song, the connection), so the caller can rebuild its tray menu.

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
    bounds: null,           // the lyrics overlay's position and size
    infoBounds: null,       // the now-playing overlay's
    locked: false,          // click-through (both)
    hidden: false,          // the lyrics overlay
    infoHidden: false,      // the now-playing overlay
    fontSize: 34,
    weight: 600,
    align: 'center',
    lines: 0,               // lines visible at once: 1, 3, 5, or 0 = as many as fit the window
    backdrop: 'shadow',     // none | shadow | panel
    glow: 50,
    aura: 1,                // the aura behind the lyrics: 0 off, 0.6 subtle, 1 normal, 1.5 strong
    fadeOnHover: true,      // when locked, fade out while the mouse is over it
    showCover: true,        // now playing: the song's cover, title and artist
    showTitle: true,
    showArtist: true,
    coverSize: 44,          // px
    startWithWindows: false // used by the standalone app only
};

// Settings SoundCloud's settings panel (Settings > Desktop lyrics) may change. Only these keys, with these
// values, are taken; after = what has to happen when one changes.
const range = (min, max) => (v) => typeof v === 'number' && v >= min && v <= max;
const oneOf = (...list) => (v) => list.includes(v);
const flag = (v) => typeof v === 'boolean';

// the two overlays: which settings hold each one's position and hidden switch, and its window title
const PARTS = {
    lyrics: { bounds: 'bounds', hidden: 'hidden', title: 'Lyrics Overlay' },
    info: { bounds: 'infoBounds', hidden: 'infoHidden', title: 'Now Playing Overlay' }
};

module.exports = function createOverlay({ settingsFile, onChange = () => {} }) {
    let settings = { ...DEFAULTS };
    let refit = false; // the now-playing block used to take a strip of its own: give that height back once
    try {
        const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
        refit = 'infoPos' in saved;
        delete saved.showSong;
        delete saved.infoPos;
        delete saved.infoAnchor; // the cover used to float inside the lyrics overlay; it has its own now
        settings = { ...DEFAULTS, ...saved };
    } catch (e) {}
    let saveTimer = null;
    const saveSettings = () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            try { fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2)); } catch (e) {}
        }, 300);
    };

    const wins = { lyrics: null, info: null };
    const partOf = (contents) => Object.keys(wins).find(p => wins[p] && !wins[p].isDestroyed() && wins[p].webContents === contents);
    let quitting = false;
    app.on('before-quit', () => { quitting = true; });

    // a height that fits the chosen number of lines at the chosen size (backing vocals get a little slack);
    // "fill the window" starts at three lines and shows more as the window is made taller
    const fittedHeight = () => {
        const lines = settings.lines || 3;
        return Math.round(settings.fontSize * (1.2 * lines + 0.35 * (lines - 1) + 0.9) + 40);
    };

    // lyrics: bottom centre of the main screen; now playing: just above the lyrics, at their left edge
    const defaultBounds = (part) => {
        const area = screen.getPrimaryDisplay().workArea;
        const width = Math.min(900, area.width - 80);
        const height = fittedHeight();
        const lyrics = { x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + area.height - height - 90), width, height };
        if (part === 'lyrics') return lyrics;
        const infoHeight = settings.coverSize + 28;
        return { x: lyrics.x, y: lyrics.y - infoHeight - 12, width: Math.max(260, settings.coverSize + 300), height: infoHeight };
    };

    // saved bounds, unless that spot is no longer on any screen (a monitor was unplugged)
    const startBounds = (part) => {
        const b = settings[PARTS[part].bounds];
        if (!b) return defaultBounds(part);
        const visible = screen.getAllDisplays().some(({ workArea: a }) =>
            b.x + 60 < a.x + a.width && b.x + b.width - 60 > a.x && b.y + 30 < a.y + a.height && b.y + b.height - 30 > a.y);
        return visible ? b : defaultBounds(part);
    };

    const send = (channel, value, only) => {
        Object.entries(wins).forEach(([part, w]) => {
            if (w && !w.isDestroyed() && (!only || only === part)) w.webContents.send(channel, value);
        });
    };
    const sendSettings = () => send('settings', settings);

    // hidden: its own switch, or for now playing also when it would show nothing at all
    const isHidden = (part) => !!settings[PARTS[part].hidden] ||
        (part === 'info' && !settings.showCover && !settings.showTitle && !settings.showArtist);

    // Hidden does not hide the window: a transparent window that has been hidden can come back blank and
    // stay that way. It goes fully see-through instead, and clicks pass through it, as when locked.
    const applyLock = () => {
        Object.entries(wins).forEach(([part, w]) => {
            if (!w || w.isDestroyed()) return;
            w.setIgnoreMouseEvents(settings.locked || isHidden(part));
            w.setFocusable(!settings.locked && !isHidden(part));
        });
        sendSettings();
    };

    const applyHidden = () => {
        Object.entries(wins).forEach(([part, w]) => {
            if (!w || w.isDestroyed()) return;
            if (!w.isVisible()) w.showInactive();
            w.setOpacity(isHidden(part) ? 0 : 1);
        });
        applyLock();
    };

    const fitHeight = () => {
        const w = wins.lyrics;
        if (!w || !settings.lines) return; // filling the window: its height is yours
        const b = w.getBounds();
        w.setBounds({ ...b, height: fittedHeight() });
        settings.bounds = w.getBounds();
    };

    const set = (key, value, after) => {
        settings[key] = value;
        saveSettings();
        if (after) after();
        sendSettings();
        onChange();
    };
    const toggleLock = () => set('locked', !settings.locked, applyLock);
    // Ctrl+Alt+H: both overlays together (shown if either is hidden, otherwise hidden)
    const toggleHidden = () => {
        const hide = !(settings.hidden || settings.infoHidden);
        settings.hidden = hide;
        settings.infoHidden = hide;
        saveSettings();
        applyHidden();
        onChange();
    };
    const togglePart = (part) => set(PARTS[part].hidden, !settings[PARTS[part].hidden], applyHidden);

    /* ---------- The song ---------- */
    let lastState = null;   // the latest state, kept for when a window (re)loads
    let lyricsVer = null;   // which lyrics we hold, so the userscript only sends them when they change
    let lastSeen = 0;

    const createWindow = (part) => {
        const w = new BrowserWindow({
            ...startBounds(part),
            transparent: true,
            backgroundColor: '#00000000',
            frame: false,
            resizable: false,   // resized from our own corner grip instead (see 'resize-start')
            maximizable: false,
            minimizable: false,
            fullscreenable: false,
            skipTaskbar: true,
            hasShadow: false,
            alwaysOnTop: true,
            show: false,
            title: PARTS[part].title,
            webPreferences: {
                preload: path.join(__dirname, 'preload.js'),
                contextIsolation: true,
                nodeIntegration: false,
                backgroundThrottling: false
            }
        });
        wins[part] = w;
        // 'screen-saver' keeps it above the taskbar and most other always-on-top windows
        w.setAlwaysOnTop(true, 'screen-saver');
        w.setVisibleOnAllWorkspaces(true);
        w.loadFile(path.join(__dirname, 'overlay.html'), { query: { part } });
        w.once('ready-to-show', () => applyHidden());
        // ready-to-show can come before the page's scripts run, so the page gets its settings once it has loaded
        w.webContents.on('did-finish-load', () => {
            w.webContents.send('settings', settings);
            if (lastState) w.webContents.send('state', lastState);
        });
        w.on('moved', () => { settings[PARTS[part].bounds] = w.getBounds(); saveSettings(); });
        // closing it (Alt+F4 while unlocked) only hides it
        w.on('close', (e) => {
            if (quitting) return;
            e.preventDefault();
            if (!settings[PARTS[part].hidden]) togglePart(part);
        });
        // links in the lyrics credit, if any, never open inside the overlay
        w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        w.webContents.on('will-navigate', (e) => e.preventDefault());
    };

    /* ---------- Resizing from the corner grip ----------
       The renderer says when the drag starts and stops; in between its window follows the mouse. */
    let resizing = null;
    ipcMain.on('resize-start', (e) => {
        const part = partOf(e.sender);
        if (!part || settings.locked) return;
        const w = wins[part];
        const start = screen.getCursorScreenPoint();
        const bounds = w.getBounds();
        const min = part === 'info' ? { w: 120, h: 40 } : { w: 220, h: 70 };
        clearInterval(resizing);
        resizing = setInterval(() => {
            const now = screen.getCursorScreenPoint();
            w.setBounds({
                x: bounds.x,
                y: bounds.y,
                width: Math.max(min.w, bounds.width + now.x - start.x),
                height: Math.max(min.h, bounds.height + now.y - start.y)
            });
        }, 16);
    });
    ipcMain.on('resize-end', (e) => {
        const part = partOf(e.sender);
        if (!part) return;
        clearInterval(resizing);
        resizing = null;
        settings[PARTS[part].bounds] = wins[part].getBounds();
        saveSettings();
    });

    /* ---------- Fade while the mouse is over one (locked mode gets no mouse events, so poll) ---------- */
    const hovered = { lyrics: false, info: false };
    setInterval(() => {
        const p = screen.getCursorScreenPoint();
        Object.entries(wins).forEach(([part, w]) => {
            if (!w || w.isDestroyed()) return;
            let over = false;
            if (settings.locked && settings.fadeOnHover && w.isVisible()) {
                const b = w.getBounds();
                over = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
            }
            if (over !== hovered[part]) { hovered[part] = over; w.webContents.send('hover', over); }
        });
    }, 100);

    // keep "Now playing" in the menu honest when SoundCloud goes quiet
    setInterval(() => {
        if (lastState && Date.now() - lastSeen > 8000 && !lastState.stale) { lastState.stale = true; onChange(); }
        if (lastState && Date.now() - lastSeen <= 8000 && lastState.stale) { lastState.stale = false; onChange(); }
    }, 2000);

    /* ---------- Settings from SoundCloud's settings panel ---------- */
    const WEB_SETTINGS = {
        fontSize: [range(16, 96)], // the window keeps its size: yours to set
        weight: [oneOf(400, 500, 600, 700, 800)],
        align: [oneOf('left', 'center', 'right')],
        lines: [oneOf(0, 1, 3, 5), () => fitHeight],
        backdrop: [oneOf('none', 'shadow', 'panel')],
        glow: [range(0, 100)],
        aura: [range(0, 2)],
        showCover: [flag, () => applyHidden],
        showTitle: [flag, () => applyHidden],
        showArtist: [flag, () => applyHidden],
        coverSize: [range(24, 120)],
        fadeOnHover: [flag],
        locked: [flag, () => applyLock],
        hidden: [flag, () => applyHidden],
        infoHidden: [flag, () => applyHidden]
    };
    const webSettings = () => Object.fromEntries(Object.keys(WEB_SETTINGS).map(k => [k, settings[k]]));

    const radio = (label, key, value, after) => ({
        label, type: 'radio', checked: settings[key] === value, click: () => set(key, value, after)
    });
    const resetPart = (part) => {
        const w = wins[part];
        if (!w) return;
        w.setBounds(defaultBounds(part));
        settings[PARTS[part].bounds] = w.getBounds();
        saveSettings();
    };

    return {
        settings: () => settings,
        set,
        start() {
            createWindow('lyrics');
            createWindow('info');
            if (refit) { fitHeight(); saveSettings(); }
        },

        // what the userscript posts to /state: { ver, at, title, artist, pos, playing, palette, cover, lyrics? }
        // answers with the lyrics version held and the settings, as the userscript expects
        handleState(state) {
            if (!state || typeof state !== 'object') return { ver: lyricsVer, settings: webSettings() };
            if (state.lyrics) lyricsVer = state.ver;
            const songChanged = !lastState || lastState.title !== state.title;
            lastState = { ...state, lyrics: state.lyrics || (lastState && lastState.lyrics) };
            lastSeen = Date.now();
            send('state', state);
            if (songChanged) onChange();
            return { ver: lyricsVer, settings: webSettings() };
        },

        // what the userscript posts to /settings: { key: value, ... }
        handleSettings(patch) {
            const after = new Set();
            Object.entries(patch && typeof patch === 'object' ? patch : {}).forEach(([key, value]) => {
                const rule = WEB_SETTINGS[key];
                if (!rule || !rule[0](value) || settings[key] === value) return;
                settings[key] = value;
                if (rule[1]) after.add(rule[1]());
            });
            saveSettings();
            after.forEach(fn => fn());
            sendSettings();
            onChange();
            return { settings: webSettings() };
        },

        // the song's sound boiled down to levels: { bass, mids, highs, beat } (for the aura, in the lyrics overlay)
        handleAudio(levels) { send('audio', levels, 'lyrics'); },

        // "Now playing: …", or null while nothing is connected
        nowPlaying() {
            const connected = lastState && !lastState.stale;
            if (!connected) return null;
            return lastState.title ? `${lastState.title} — ${lastState.artist || ''}` : '';
        },

        toggleLock,
        toggleHidden,
        // starting it again brings both back if they were hidden, and unlocks them so they can be moved
        bringBack() {
            if (settings.hidden || settings.infoHidden) { settings.hidden = false; settings.infoHidden = false; saveSettings(); applyHidden(); onChange(); }
            if (settings.locked) toggleLock();
        },

        // the overlays' own menu entries, for whichever tray menu holds them
        menuItems() {
            return [
                { label: 'Lock in place (clicks pass through)', type: 'checkbox', checked: settings.locked, accelerator: 'Ctrl+Alt+L', click: toggleLock },
                { label: 'Hide lyrics', type: 'checkbox', checked: settings.hidden, click: () => togglePart('lyrics') },
                { label: 'Hide now playing', type: 'checkbox', checked: settings.infoHidden, click: () => togglePart('info') },
                { label: 'Hide both', accelerator: 'Ctrl+Alt+H', click: toggleHidden },
                { type: 'separator' },
                { label: 'Text size', submenu: [
                    radio('Small', 'fontSize', 24), radio('Medium', 'fontSize', 34),
                    radio('Large', 'fontSize', 46), radio('Huge', 'fontSize', 62)
                ] },
                { label: 'Weight', submenu: [radio('Medium', 'weight', 500), radio('Semibold', 'weight', 600), radio('Bold', 'weight', 700)] },
                { label: 'Alignment', submenu: [radio('Left', 'align', 'left'), radio('Centre', 'align', 'center'), radio('Right', 'align', 'right')] },
                { label: 'Lines shown', submenu: [
                    radio('Fill the window (taller shows more)', 'lines', 0),
                    radio('1 (just the one being sung)', 'lines', 1, fitHeight), radio('3', 'lines', 3, fitHeight), radio('5', 'lines', 5, fitHeight)
                ] },
                { label: 'Backdrop', submenu: [
                    radio('None', 'backdrop', 'none'), radio('Shadow behind the text', 'backdrop', 'shadow'), radio('Dark panel', 'backdrop', 'panel')
                ] },
                { label: 'Glow', submenu: [radio('Off', 'glow', 0), radio('Low', 'glow', 25), radio('Medium', 'glow', 50), radio('High', 'glow', 85)] },
                { label: 'Aura (cover colours)', submenu: [radio('Off', 'aura', 0), radio('Subtle', 'aura', 0.6), radio('Normal', 'aura', 1), radio('Strong', 'aura', 1.5)] },
                { label: 'Now playing', submenu: [
                    { label: 'Cover', type: 'checkbox', checked: settings.showCover, click: () => set('showCover', !settings.showCover, applyHidden) },
                    { label: 'Title', type: 'checkbox', checked: settings.showTitle, click: () => set('showTitle', !settings.showTitle, applyHidden) },
                    { label: 'Artist', type: 'checkbox', checked: settings.showArtist, click: () => set('showArtist', !settings.showArtist, applyHidden) }
                ] },
                { label: 'Fade out when the mouse is over them (locked)', type: 'checkbox', checked: settings.fadeOnHover, click: () => set('fadeOnHover', !settings.fadeOnHover) },
                { label: 'Reset positions and sizes', click: () => { resetPart('lyrics'); resetPart('info'); } }
            ];
        },

        // write the settings now (on quit)
        flush() {
            Object.entries(wins).forEach(([part, w]) => { if (w && !w.isDestroyed()) settings[PARTS[part].bounds] = w.getBounds(); });
            clearTimeout(saveTimer);
            try { fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2)); } catch (e) {}
        }
    };
};
