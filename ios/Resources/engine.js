// LiquidCloud's engine. SoundCloud's own site runs hidden behind the app (Engine.swift): it keeps you signed
// in, plays the music (encrypted songs included, through Safari's engine) and answers the API. The app's
// screens are native; this script is how they talk to the hidden page:
//   LC.api(path)               SoundCloud's API with your sign-in, as JSON text
//   LC.play({ page, index })   open a page in the hidden site and start its song number `index`
//                              (index -1: the page is one song)
//   LC.control(action)         play / pause / toggle / next / prev / shuffle / repeat / like
//   LC.seek(fraction)          jump to a point in the song (0 to 1)
// and it reports what is playing to the app ("state" messages) whenever something changes.
(() => {
    if (location.hostname !== 'soundcloud.com' || window.top !== window || window.LC) return;

    const post = (name, body) => { try { window.webkit.messageHandlers[name].postMessage(body); } catch (e) {} };
    const q = (selector, root = document) => root.querySelector(selector);
    const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitFor = async (test, ms = 10000) => {
        const end = Date.now() + ms;
        while (Date.now() < end) {
            const value = test();
            if (value) return value;
            await sleep(150);
        }
        return null;
    };

    /* ---------- API ---------- */
    const clientId = () => {
        const hydration = window.__sc_hydration;
        const client = Array.isArray(hydration) && hydration.find(item => item && item.hydratable === 'apiClient' && item.data);
        return client ? client.data.id : null;
    };
    const token = () => (document.cookie.match(/(?:^|; )oauth_token=([^;]+)/) || [])[1] || null;

    const api = async (path) => {
        const id = await waitFor(clientId, 8000);
        if (!id) throw new Error('SoundCloud is still loading');
        const url = new URL(path, 'https://api-v2.soundcloud.com');
        if (url.origin !== 'https://api-v2.soundcloud.com') throw new Error('unexpected address');
        if (!url.searchParams.has('client_id')) url.searchParams.set('client_id', id);
        const t = token();
        const res = await fetch(url, t ? { headers: { Authorization: `OAuth ${t}` } } : {});
        if (!res.ok) throw new Error(`SoundCloud answered ${res.status}`);
        return res.text();
    };

    // Spicy Lyrics, asked from this page because the key only allows the sites you listed for it
    // (https://soundcloud.com). Its error replies can't be read here (no CORS header): status 0.
    const spicy = async (id, key) => {
        if (!/^[A-Za-z0-9]{22}$/.test(id)) return JSON.stringify({ status: 400 });
        try {
            const res = await fetch(`https://api.spicylyrics.org/v1/lyrics/${id}`, { headers: { Authorization: `Bearer ${key}` } });
            return JSON.stringify({ status: res.status, body: res.ok ? await res.json() : null });
        } catch (e) {
            return JSON.stringify({ status: 0 });
        }
    };

    /* ---------- Moving around the hidden site ---------- */
    // SoundCloud's site changes pages itself when one of its links is clicked
    const navigate = (path) => {
        if (location.pathname === path) return;
        const a = document.createElement('a');
        a.href = path;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
    };

    const playButton = () => q('.playControls .playControls__play');
    const isPlaying = () => { const b = playButton(); return !!(b && b.classList.contains('playing')); };
    const currentPath = () => { const link = q('.playControls .playbackSoundBadge__titleLink'); return link ? (link.getAttribute('href') || '').split('?')[0] : ''; };

    const play = async ({ page, index = 0 }) => {
        // the old page's buttons and rows stay on screen for a moment after the new page opens: mark them so
        // only the new page's are pressed
        if (location.pathname !== page) qa('.fullHero, .listenHero, .trackList__item, .soundList__item').forEach(el => { el.dataset.lcOld = '1'; });
        navigate(page);
        if (!await waitFor(() => location.pathname === page, 8000)) return 'the page did not open';
        if (index < 0) {
            // one song: its big play button
            const button = await waitFor(() => q('.fullHero:not([data-lc-old]) .sc-button-play, .listenHero:not([data-lc-old]) .sc-button-play'), 6000)
                || q('.fullHero .sc-button-play, .listenHero .sc-button-play');
            if (!button) return 'no play button';
            if (!(currentPath() === page && isPlaying()) && !button.classList.contains('sc-button-pause')) button.click();
            return 'ok';
        }
        // a list: a playlist's rows, or a page of songs (your likes, an artist's songs). Long lists load as
        // the page scrolls, so it scrolls until row `index` is there.
        const rows = () => { const list = qa('.trackList__item:not([data-lc-old])'); return list.length ? list : qa('.soundList__item:not([data-lc-old])'); };
        let list = await waitFor(() => (rows().length ? rows() : null), 8000);
        if (!list) { qa('[data-lc-old]').forEach(el => { delete el.dataset.lcOld; }); list = rows(); }
        for (let tries = 0; list && list.length <= index && tries < 60; tries++) {
            window.scrollTo(0, document.body.scrollHeight);
            await sleep(400);
            list = rows();
        }
        const row = list && list[index];
        if (!row) return 'song not found on the page';
        row.scrollIntoView({ block: 'center' });
        const button = row.querySelector('.sc-button-play');
        if (button) {
            if (!button.classList.contains('sc-button-pause')) button.click();
            return 'ok';
        }
        // playlist rows have no button: the row itself starts the song
        (row.querySelector('.trackItem') || row).click();
        return 'ok';
    };

    /* ---------- The player bar ---------- */
    const click = (selector) => { const b = q(selector); if (b) b.click(); return !!b; };
    const control = (action) => {
        switch (action) {
            case 'toggle': return click('.playControls .playControls__play');
            case 'play': return isPlaying() || click('.playControls .playControls__play');
            case 'pause': return !isPlaying() || click('.playControls .playControls__play');
            case 'next': return click('.playControls .skipControl__next');
            case 'prev': return click('.playControls .skipControl__previous');
            case 'shuffle': return click('.playControls .shuffleControl');
            case 'repeat': return click('.playControls .repeatControl');
            case 'like': return click('.playControls .playbackSoundBadge__like');
        }
        return false;
    };

    // SoundCloud's progress bar jumps to wherever it is pressed
    const seek = (fraction) => {
        const bar = q('.playControls .playbackTimeline__progressWrapper');
        if (!bar) return false;
        const r = bar.getBoundingClientRect();
        if (!r.width) return false;
        const x = r.left + r.width * Math.min(Math.max(fraction, 0), 1);
        const y = r.top + r.height / 2;
        const init = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1, view: window };
        bar.dispatchEvent(new PointerEvent('pointerdown', init));
        bar.dispatchEvent(new MouseEvent('mousedown', init));
        document.dispatchEvent(new MouseEvent('mousemove', init));
        bar.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
        bar.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }));
        document.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }));
        bar.dispatchEvent(new MouseEvent('click', { ...init, buttons: 0 }));
        return true;
    };

    const clock = (el) => {
        const m = el && el.textContent.match(/(\d+):(\d+)(?::(\d+))?/);
        if (!m) return 0;
        return m[3] ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : (+m[1]) * 60 + (+m[2]);
    };

    const state = () => {
        const link = q('.playControls .playbackSoundBadge__titleLink');
        const artist = q('.playControls .playbackSoundBadge__lightLink');
        const cover = q('.playControls .playbackSoundBadge__avatar .sc-artwork');
        const bar = q('.playControls .playbackTimeline__progressWrapper');
        const repeat = q('.playControls .repeatControl');
        const art = cover ? ((getComputedStyle(cover).backgroundImage.match(/url\("?([^")]+)"?\)/) || [])[1] || '') : '';
        let position = bar ? parseFloat(bar.getAttribute('aria-valuenow')) : NaN;
        let duration = bar ? parseFloat(bar.getAttribute('aria-valuemax')) : NaN;
        if (duration > 36000) { duration /= 1000; position /= 1000; } // milliseconds
        if (!(duration > 0)) duration = clock(q('.playControls .playbackTimeline__duration span[aria-hidden]') || q('.playControls .playbackTimeline__duration'));
        if (!(position >= 0)) position = clock(q('.playControls .playbackTimeline__timePassed span[aria-hidden]') || q('.playControls .playbackTimeline__timePassed'));
        return {
            title: link ? (link.getAttribute('title') || link.textContent).trim() : '',
            artist: artist ? (artist.getAttribute('title') || artist.textContent).trim() : '',
            path: currentPath(),
            artistPath: artist ? (artist.getAttribute('href') || '') : '',
            artwork: art.replace(/-t\d+x\d+\./, '-t500x500.'),
            playing: isPlaying(),
            position: position || 0,
            duration: duration || 0,
            liked: !!q('.playControls .playbackSoundBadge__like.sc-button-selected'),
            shuffle: !!q('.playControls .shuffleControl.m-shuffling'),
            repeat: repeat ? (repeat.classList.contains('m-one') ? 'one' : repeat.classList.contains('m-all') ? 'all' : 'none') : 'none',
            signedIn: !!token()
        };
    };

    let last = '';
    setInterval(() => {
        const s = state();
        const key = JSON.stringify({ ...s, position: Math.floor(s.position) });
        if (key === last) return;
        last = key;
        post('state', s);
    }, 400);

    /* ---------- Tracking cleanup (uBlock Origin's SoundCloud privacy rules) ---------- */
    // SoundCloud's tracking id and its experiment/analytics storage; the sign-in and player cookies are untouched
    const scrubTracking = () => {
        for (const name of ['sc_tracking_anonymous_id']) {
            if (document.cookie.includes(name + '=')) {
                for (const domain of ['', '; domain=.soundcloud.com', '; domain=soundcloud.com']) {
                    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain}`;
                }
            }
        }
        try {
            for (const key of Object.keys(localStorage)) {
                if (/sc_tracking_anonymous_id|statsig/i.test(key)) localStorage.removeItem(key);
            }
        } catch (e) {}
    };
    scrubTracking();
    setInterval(scrubTracking, 30000);

    window.LC = { api, spicy, play, control, seek, state, navigate };
    post('state', state());
})();
