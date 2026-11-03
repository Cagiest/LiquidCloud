// Draws the lyrics the SoundCloud userscript sends (see main.js) and keeps them in time with playback.
// The same page is both overlays (see core.js): ?part=lyrics the lyrics and aura, ?part=info the cover,
// title and artist.

const $ = (id) => document.getElementById(id);
const body = document.body;
const view = $('view');
const column = $('column');
const msg = $('msg');
const cover = $('cover');
const title = $('title');
const artist = $('artist');
const part = new URLSearchParams(location.search).get('part') === 'info' ? 'info' : 'lyrics';
body.dataset.part = part;
if (part === 'info') $('hint').textContent = 'Drag to move \u00b7 Ctrl+Alt+L locks';

let settings = { lines: 3 };
let lyrics = null;          // { synced, lines: [{ t, end, right, words: [{ t, e, text, glue, bg }] }], credit }
let lineEls = [];
// last reported playback position (already corrected by the script's timing offsets)
let clock = { pos: 0, playing: false, at: 0, seen: 0 };
let shownSig = '';          // which lines were active last time the classes were set
let auraWant = null;        // where the words in focus are, for the aura: { x, y, w, h } in #view
let palette = '';

/* ---------- Settings and window state from main.js ---------- */
overlay.on('settings', (s) => {
    settings = s;
    const root = document.documentElement.style;
    root.setProperty('--fs', `${s.fontSize}px`);
    root.setProperty('--weight', String(s.weight));
    root.setProperty('--align', s.align);
    root.setProperty('--glow', String(s.glow));
    body.dataset.align = s.align;
    body.dataset.backdrop = s.backdrop;
    body.classList.toggle('unlocked', !s.locked);
    // now playing: cover, title, artist
    root.setProperty('--cover', String(s.coverSize || 44));
    body.classList.toggle('has-info', !!(s.showCover || s.showTitle || s.showArtist));
    body.classList.toggle('no-cover', !s.showCover || !cover.getAttribute('src'));
    body.classList.toggle('no-title', !s.showTitle);
    body.classList.toggle('no-artist', !s.showArtist);
    shownSig = ''; // re-place the column at the new size
});

overlay.on('hover', (over) => body.classList.toggle('hovered', over));

// the song's sound, boiled down to levels, when something sends it (the SoundCloud app does): it then
// drives the aura instead of the lyric timing. { bass, mids, highs, beat } 0-1, beat on the update it lands
let sound = { bass: 0, mids: 0, highs: 0, beat: 0, at: 0 };
overlay.on('audio', (a) => {
    if (!a || typeof a !== 'object') return;
    const n = (v) => Math.max(0, Math.min(1, Number(v) || 0));
    sound = { bass: n(a.bass), mids: n(a.mids), highs: n(a.highs), beat: Math.max(sound.beat, n(a.beat)), at: Date.now() };
});

/* ---------- The song, from SoundCloud ---------- */
overlay.on('state', (st) => {
    clock = { pos: Number(st.pos) || 0, playing: !!st.playing, at: Number(st.at) || Date.now(), seen: Date.now() };
    if (title.textContent !== (st.title || '') || artist.textContent !== (st.artist || '')) {
        title.textContent = st.title || '';
        artist.textContent = st.artist || '';
    }
    // only SoundCloud's own image server (the page's security policy allows nothing else)
    const art = typeof st.cover === 'string' && /^https:\/\/[a-z0-9-]+\.sndcdn\.com\//.test(st.cover) ? st.cover : '';
    if (art !== (cover.getAttribute('src') || '')) {
        if (art) cover.src = art; else cover.removeAttribute('src');
        body.classList.toggle('no-cover', !settings.showCover || !art);
    }
    const cols = Array.isArray(st.palette) ? st.palette.join() : '';
    if (part === 'info') return;
    if (cols !== palette) { palette = cols; Aura.colors(st.palette); }
    if (st.lyrics) setLyrics(st.lyrics);
});

const setLyrics = (data) => {
    if (data.lines && data.lines.length && data.synced) {
        lyrics = data;
        msg.textContent = '';
        build();
        return;
    }
    lyrics = null;
    column.textContent = '';
    lineEls = [];
    msg.textContent = data.lines ? 'These lyrics are not time-synced, so they are not shown here' : (data.message || '');
};

// one span per word (or syllable), grouped the same way as on SoundCloud
const build = () => {
    column.textContent = '';
    lineEls = lyrics.lines.map((line) => {
        const el = document.createElement('div');
        el.className = 'line' + (line.right ? ' right' : '');
        el._words = [];
        if (line.words && line.words.length) {
            let holder = el;     // the lead line, or a backing-vocal block inside it
            let group = 0;
            let joined = null;   // keeps the syllables of one word together
            line.words.forEach((word, n) => {
                if ((word.bg || 0) !== group) {
                    group = word.bg || 0;
                    holder = document.createElement('div');
                    holder.className = 'bg';
                    el.appendChild(holder);
                    joined = null;
                }
                const span = document.createElement('span');
                span.className = 'w';
                span.textContent = word.text;
                el._words.push({ span, shown: '' });
                const prev = line.words[n - 1];
                const continues = prev && prev.glue && (prev.bg || 0) === group;
                if (word.glue || continues) {
                    if (!continues) { joined = document.createElement('span'); joined.className = 'word'; holder.appendChild(joined); }
                    joined.appendChild(span);
                } else {
                    holder.appendChild(span);
                }
                if (!word.glue) holder.appendChild(document.createTextNode(' '));
            });
        } else {
            el.classList.add('plain');
            el.textContent = line.text || '♪';
        }
        column.appendChild(el);
        return el;
    });
    // the source's credit, shown after the last line (Spicy Lyrics asks for attribution)
    const credit = document.createElement('div');
    credit.className = 'line credit';
    credit.textContent = lyrics.credit || '';
    column.appendChild(credit);
    lineEls.push(credit);
    shownSig = '';
    column.style.transition = 'none';
    requestAnimationFrame(() => { column.style.transition = ''; });
};

// the box around the text of these lines in #view, once the column has moved by shift
const textBox = (els, shift) => {
    const base = column.getBoundingClientRect();
    let box = null;
    const range = document.createRange();
    els.forEach((el) => {
        if (!el) return;
        // the words themselves: the line and its backing-vocal block are full width
        const rects = el._words && el._words.length
            ? el._words.map(entry => entry.span.getBoundingClientRect())
            : (range.selectNodeContents(el.firstChild || el), [...range.getClientRects()]);
        for (const r of rects) {
            if (!r.width) continue;
            const x = r.left - base.left, y = r.top - base.top + shift;
            box = box ? { x: Math.min(box.x, x), y: Math.min(box.y, y), r: Math.max(box.r, x + r.width), b: Math.max(box.b, y + r.height) }
                : { x, y, r: x + r.width, b: y + r.height };
        }
    });
    return box && { x: box.x, y: box.y, w: box.r - box.x, h: box.b - box.y };
};


/* ---------- Every frame ---------- */
let smooth = 0;
let lastFrameTime = 0; // song time at the previous frame
let frameAt = 0;
const easeOut = (x) => 1 - (1 - x) * (1 - x);

const tick = (now) => {
    requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - frameAt) / 1000) || 0;
    frameAt = now;

    // nothing heard from SoundCloud for a while: the tab was closed or the browser quit
    const connected = Date.now() - clock.seen < 6000;
    // nothing from SoundCloud: blank. A song without synced lyrics: the cover, title and artist stay up
    body.classList.toggle('idle', !connected);
    body.classList.toggle('no-lyrics', connected && !lyrics);
    if (!connected) msg.textContent = 'Waiting for SoundCloud…';
    if (part === 'info') return; // the cover, title and artist need nothing per frame
    if (!connected || !lyrics) { Aura.frame(null, settings.aura || 0, null, dt); return; }

    // our own clock, running between reports and gently pulled toward them (snapping after a seek)
    const target = clock.pos + (clock.playing ? Math.min(3, (Date.now() - clock.at) / 1000) : 0) + 0.2;
    if (Math.abs(target - smooth) > 0.6) smooth = target;
    else smooth += (clock.playing ? dt : 0) + (target - smooth) * 0.06;
    const time = smooth;

    const lines = lyrics.lines;
    const active = [];
    let latest = -1;
    let next = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].t > time) { if (next < 0) next = i; continue; }
        latest = i;
        if (time < lines[i].end) active.push(i);
    }
    // between lines: keep the last one up for a second, then show what is coming
    let focus = active;
    if (!focus.length) {
        if (latest < 0) focus = [next >= 0 ? next : 0];
        else if (next < 0) focus = [lineEls.length - 1]; // song over: the credit
        else focus = [time - lines[latest].end > 1 ? next : latest];
    }

    const sig = active.join(',') + '|' + focus.join(',') + '|' + view.clientHeight;
    if (sig !== shownSig) {
        shownSig = sig;
        // centre the focused line(s) in the window
        const first = lineEls[focus[0]];
        const last = lineEls[focus[focus.length - 1]];
        let shift = 0;
        if (first && last) {
            const mid = (first.offsetTop + last.offsetTop + last.offsetHeight) / 2;
            shift = Math.round(view.clientHeight / 2 - mid);
            column.style.transform = `translateY(${shift}px)`;
            auraWant = textBox(focus.map(i => lineEls[i]), shift);
        }
        // which lines show: a set number either side of the focus, or (fill) every line that lands inside
        // the window once the column has moved; the farther from the focus, the dimmer
        const reach = (settings.lines - 1) / 2;
        const H = view.clientHeight;
        lineEls.forEach((el, i) => {
            const d = Math.min(...focus.map(f => Math.abs(f - i)));
            const top = el.offsetTop + shift;
            const shows = settings.lines ? d <= reach : top < H && top + el.offsetHeight > 0;
            el.classList.toggle('active', active.includes(i));
            el.style.setProperty('--d', String(d));
            el.style.opacity = d === 0 ? (active.includes(i) || el.classList.contains('credit') ? '1' : '0.6')
                : shows ? String(Math.max(0.22, 0.55 - 0.1 * (d - 1)))
                : '0';
        });
    }

    // What moves the aura: the song's sound when it is arriving, otherwise the lyric timing standing in
    // for it. From the lyrics: a new line is a big beat and each word a smaller one (longer words hit
    // harder); a held note keeps swelling (bass); singing keeps it flowing (mids); the start of each word
    // sparkles (highs).
    let input;
    if (Date.now() - sound.at < 500) {
        input = { bass: sound.bass, mids: sound.mids, highs: sound.highs, beat: sound.beat };
        sound.beat = 0;
    } else {
        input = { bass: 0, mids: 0, highs: 0, beat: 0 };
        active.forEach((i) => {
            const line = lines[i];
            if (line.t <= time && line.t > lastFrameTime) input.beat = 1;
            if (!line.words) { input.mids = Math.max(input.mids, 0.5); input.bass = Math.max(input.bass, 0.3); return; }
            line.words.forEach((word) => {
                const len = Math.max(0.1, word.e - word.t);
                if (word.t <= time && word.t > lastFrameTime) input.beat = Math.max(input.beat, (word.bg ? 0.25 : 0.4) + 0.35 * Math.min(1, len / 0.8));
                if (time >= word.t && time < word.e) {
                    const held = Math.min(1, (time - word.t) / 1.2) * Math.min(1, len / 0.9);
                    input.bass = Math.max(input.bass, 0.3 + 0.5 * held);
                    input.mids = Math.max(input.mids, 0.65);
                    input.highs = Math.max(input.highs, 0.15 + 0.45 * Math.max(0, 1 - (time - word.t) / 0.35));
                } else if (time >= word.e && time < word.e + 0.6) {
                    input.mids = Math.max(input.mids, 0.35);
                }
            });
        });
        input.bass = Math.max(input.bass, input.beat * 0.8);
    }
    lastFrameTime = time;
    Aura.frame(auraWant, settings.aura || 0, input, dt);

    // words of the lines being sung: fill, lift, grow and glow
    active.forEach((i) => {
        const el = lineEls[i];
        const words = lines[i].words;
        if (!el || !el._words || !words) return;
        el._words.forEach((entry, w) => {
            const word = words[w];
            if (!word) return;
            const length = Math.max(0.08, word.e - word.t);
            const progress = Math.min(1, Math.max(0, (time - word.t) / length));
            const since = time - word.e;
            let scale, lift, glow;
            if (time < word.t) { scale = 0.965; lift = 0.6; glow = 0; }
            else if (since <= 0) {
                const k = easeOut(progress);
                scale = 0.965 + 0.075 * k; lift = 0.6 - 3.2 * k; glow = 0.25 + 0.75 * k;
            } else {
                const back = easeOut(Math.min(1, since / 0.7));
                scale = 1.04 - 0.04 * back; lift = -2.6 + 2.6 * back; glow = 1 - 0.8 * back;
            }
            const key = `${Math.round(progress * 1000)}|${Math.round(scale * 1000)}|${Math.round(glow * 100)}`;
            if (entry.shown === key) return;
            entry.shown = key;
            const style = entry.span.style;
            style.setProperty('--p', (progress * 100).toFixed(1));
            style.setProperty('--s', scale.toFixed(4));
            style.setProperty('--y', lift.toFixed(2));
            style.setProperty('--g', glow.toFixed(3));
        });
    });
};
requestAnimationFrame(tick);

/* ---------- Resize grip ---------- */
const grip = $('grip');
grip.addEventListener('pointerdown', (e) => {
    grip.setPointerCapture(e.pointerId);
    overlay.resizeStart();
});
const endResize = () => overlay.resizeEnd();
grip.addEventListener('pointerup', endResize);
grip.addEventListener('lostpointercapture', endResize);
