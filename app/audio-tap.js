// Hears what SoundCloud plays, for the lyrics overlay's aura, and mutes SoundCloud's audio ads. Runs in the
// SoundCloud page.
//
// Ads: SoundCloud's audio ads play from AdsWizz files (music streams separately), so media that starts from
// an adswizz.com address is an ad. It is muted while it plays, with a small "Ad · muted" pill, and the
// player's own volume is untouched, so the music comes back as loud as before. The ad itself still loads
// and runs: SoundCloud only gives the next encrypted track its key once it has.
// When the player starts a track, a copy of its sound is taken with captureStream(): the player itself is
// not touched, so playback is exactly as before. The copy goes into an analyser (connected to a silent
// output, nothing is heard twice), and about 30 times a second it is boiled down to four numbers sent to
// the app: bass, mids, highs (0-1, each scaled to the song's own loudness) and beat (0, or the strength of a
// bass hit on the update it lands). Encrypted tracks cannot be copied (the browser blocks it); for those,
// and whenever nothing is heard, nothing is sent and the overlay follows the lyric timing instead.

(() => {
    if (window.__liquidTap || !window.__liquid) return;
    window.__liquidTap = true;

    let ctx = null;
    let analyser = null;
    let bins = null;
    let source = null;
    let player = null;   // the media element being heard
    let stream = null;

    const attach = () => {
        if (!stream || !stream.getAudioTracks().length) return;
        try {
            ctx = ctx || new AudioContext();
            if (!analyser) {
                analyser = ctx.createAnalyser();
                analyser.fftSize = 2048;
                analyser.smoothingTimeConstant = 0.5;
                const silent = ctx.createGain();
                silent.gain.value = 0;
                analyser.connect(silent);
                silent.connect(ctx.destination);
                bins = new Uint8Array(analyser.frequencyBinCount);
            }
            if (source) source.disconnect();
            source = ctx.createMediaStreamSource(stream);
            source.connect(analyser);
            if (ctx.state === 'suspended') ctx.resume();
        } catch (e) {}
    };

    const hear = (el) => {
        if (el === player) { if (ctx && ctx.state === 'suspended') ctx.resume(); return; }
        let copy;
        try { copy = el.captureStream(); } catch (e) { return; } // encrypted, or not ready
        player = el;
        stream = copy;
        stream.addEventListener('addtrack', attach); // a new track (or format) brings a new audio track
        attach();
    };

    /* ---------- Muting ads ---------- */
    // off: SoundCloud refused the next encrypted track's key after a muted ad (23 Oct 2026); with ads playing
    // normally, 60 keys were given and none refused. Muting would only be safe if SoundCloud counted muted ads.
    const MUTE_ADS = false;
    const isAd = (el) => /^https?:\/\/([a-z0-9-]+\.)*adswizz\.com\//i.test(el.currentSrc || el.src || '');
    let pill = null;
    const showPill = (on) => {
        if (on && !pill) {
            pill = document.createElement('div');
            pill.textContent = MUTE_ADS ? 'Ad · muted' : 'Ad';
            pill.style.cssText = 'position:fixed;left:50%;bottom:118px;transform:translateX(-50%);z-index:1000003;' +
                'padding:6px 14px;border-radius:14px;background:rgba(18,18,18,0.92);border:1px solid rgba(255,255,255,0.12);' +
                'color:#e6e6e6;font:600 12px/1.2 sans-serif;pointer-events:none;box-shadow:0 6px 20px rgba(0,0,0,0.5)';
            document.body.appendChild(pill);
        }
        if (pill) pill.style.display = on ? 'block' : 'none';
    };
    const muteIfAd = (el) => {
        const ad = isAd(el);
        if (ad && MUTE_ADS) el.muted = true;
        else if (el.__liquidMutedAd && el.muted) el.muted = false;
        el.__liquidMutedAd = ad;
        showPill(ad && !el.paused);
    };
    const watched = new WeakSet();
    const watch = (el) => {
        if (watched.has(el)) return;
        watched.add(el);
        // the same element can go from an ad to music: decide again whenever its source changes or it starts
        ['loadstart', 'playing', 'pause', 'ended', 'emptied'].forEach(type => el.addEventListener(type, () => muteIfAd(el)));
    };

    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
        try { watch(this); muteIfAd(this); } catch (e) {}
        try { if (!isAd(this)) hear(this); } catch (e) {}
        return play.apply(this, args);
    };

    // levels, each scaled to the loudest it has been lately so quiet and loud songs both move it
    const peaks = [0.05, 0.05, 0.05];
    let bassAverage = 0;
    let lastBeat = 0;
    let quietSince = 0;
    const band = (lowHz, highHz) => {
        const hzPerBin = ctx.sampleRate / analyser.fftSize;
        const from = Math.max(1, Math.floor(lowHz / hzPerBin));
        const to = Math.min(bins.length - 1, Math.ceil(highHz / hzPerBin));
        let sum = 0;
        for (let i = from; i <= to; i++) sum += bins[i];
        return sum / ((to - from + 1) * 255);
    };

    setInterval(() => {
        if (!analyser || !player || player.paused) return;
        analyser.getByteFrequencyData(bins);
        const raw = [band(30, 150), band(250, 2000), band(4000, 12000)];
        const now = performance.now();
        // silence (paused, between tracks, or a track that could not be heard): send nothing
        if (raw[0] + raw[1] + raw[2] < 0.01) {
            if (!quietSince) quietSince = now;
            if (now - quietSince > 600) return;
        } else {
            quietSince = 0;
        }
        const levels = raw.map((v, i) => {
            peaks[i] = Math.max(peaks[i] * 0.997, v, 0.05);
            return Math.pow(Math.min(1, v / peaks[i]), 1.4);
        });
        // a beat: bass clearly above its recent average, at most four a second
        let beat = 0;
        if (raw[0] > bassAverage * 1.3 + 0.02 && now - lastBeat > 250) {
            beat = Math.min(1, (raw[0] / Math.max(bassAverage, 0.01) - 1) * 1.5);
            lastBeat = now;
        }
        bassAverage = bassAverage * 0.92 + raw[0] * 0.08;
        window.__liquid.audio({ bass: levels[0], mids: levels[1], highs: levels[2], beat });
    }, 33);
})();
