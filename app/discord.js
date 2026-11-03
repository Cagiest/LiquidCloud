// Discord status: "Listening to …" with the song, the artist, the cover, the time left and a "Listen on
// SoundCloud" button. It talks to the Discord app on this computer (no account details pass through here)
// under your own Discord application, whose ID goes in settings (Discord status is off until there is one).
// Discord accepts about five updates every 20 seconds, so updates go out only when the song, play/pause or
// the position (a seek) changes, and never closer together than 4 seconds.

const { Client } = require('@xhayper/discord-rpc');

const LISTENING = 2; // Discord's activity type for "Listening to"

module.exports = function createPresence() {
    let client = null;
    let clientId = '';
    let ready = false;
    let enabled = false;
    let retry = null;
    let shown = { song: '', start: 0 }; // what was last sent, to skip repeats
    let pending = null;   // the newest activity waiting for the next allowed update
    let lastSent = 0;
    let timer = null;

    const connect = () => {
        clearTimeout(retry);
        if (!enabled || !clientId || client) return;
        client = new Client({ clientId });
        client.on('ready', () => { ready = true; shown = { song: '', start: 0 }; flush(); });
        client.on('disconnected', () => {
            ready = false;
            client = null;
            if (enabled) retry = setTimeout(connect, 15000); // Discord was closed: try again later
        });
        client.login().catch(() => {
            ready = false;
            client = null;
            if (enabled) retry = setTimeout(connect, 15000); // Discord is not running yet
        });
    };

    const disconnect = () => {
        clearTimeout(retry);
        clearTimeout(timer);
        if (client) { try { client.user && client.user.clearActivity(); client.destroy(); } catch (e) {} }
        client = null;
        ready = false;
        shown = { song: '', start: 0 };
    };

    const flush = () => {
        clearTimeout(timer);
        if (!ready || !client || !client.user || pending === null) return;
        const wait = lastSent + 4000 - Date.now();
        if (wait > 0) { timer = setTimeout(flush, wait); return; }
        const activity = pending;
        pending = null;
        lastSent = Date.now();
        (activity ? client.user.setActivity(activity) : client.user.clearActivity()).catch(() => {});
    };

    return {
        configure({ id, on }) {
            const changed = id !== clientId || on !== enabled;
            clientId = id || '';
            enabled = !!on && !!clientId;
            if (!changed) return;
            disconnect();
            connect();
        },

        // state as the userscript sends it: { title, artist, pos, playing, duration, cover, url }
        update(state) {
            if (!enabled) return;
            let activity = null;
            if (state && state.title && state.playing) {
                const start = Date.now() - (Number(state.pos) || 0) * 1000;
                const duration = Number(state.duration) || 0;
                activity = {
                    type: LISTENING,
                    details: String(state.title).slice(0, 128),
                    state: String(state.artist || 'SoundCloud').slice(0, 128),
                    largeImageKey: /^https:\/\//.test(state.cover || '') ? state.cover : undefined,
                    largeImageText: String(state.title).slice(0, 128),
                    startTimestamp: start,
                    endTimestamp: duration ? start + duration * 1000 : undefined,
                    buttons: /^https:\/\/soundcloud\.com\//.test(state.url || '') ? [{ label: 'Listen on SoundCloud', url: state.url }] : undefined,
                    instance: false
                };
            }
            // same song and still in step (within 3 s) with what Discord shows: nothing to send
            const song = activity ? `${activity.details}|${activity.state}` : 'off';
            const start = activity ? activity.startTimestamp : 0;
            if (song === shown.song && Math.abs(start - shown.start) < 3000) return;
            shown = { song, start };
            pending = activity;
            flush();
        },

        stop: disconnect
    };
};
