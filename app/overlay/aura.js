// The aura behind the lyrics: one silk sheet of light in the cover art's colours, drawn with WebGL2.
// The sheet is a band of fine strands that travels along a slow, morphing wave and rolls as it goes: where
// it turns edge-on the strands crowd together into bright folds, and its back face is dimmer than its
// front. The cover colours run across it and drift along it. It reacts to the music through four
// inputs: bass swells and widens it, mids speed up its flow, highs send a shimmer along the strands, and
// each beat sends a ripple outward from the words. Those come from the song's sound when there is any,
// otherwise from the lyric timing (overlay.js decides). Drawn on a transparent canvas behind the text.
// overlay.js calls Aura.colors() when the song changes and Aura.frame() every frame.

const Aura = (() => {
    const canvas = document.getElementById('aura');
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) return { colors() {}, frame() {} };

    const vertex = `#version 300 es
        in vec2 pos;
        void main() { gl_Position = vec4(pos, 0.0, 1.0); }`;

    const fragment = `#version 300 es
        precision highp float;
        uniform vec2 res;        // canvas size in pixels
        uniform float scale;     // canvas pixels per CSS pixel
        uniform float time;      // seconds
        uniform float flow;      // how far the sheet has travelled (runs faster with the mids)
        uniform vec3 c0, c1, c2; // cover colours
        uniform vec4 box;        // text being sung: centre x, y, half width, half height (CSS px, y down)
        uniform float power;     // 0 = off
        uniform vec3 drive;      // bass, mids, highs: 0-1, smoothed
        uniform vec4 ripples;    // two beats: age (s), strength, age, strength
        out vec4 outColor;

        const int STRANDS = 26;

        // a ripple running outward from the words: a short wave packet at distance age * speed
        float ripple(float dx, float age, float strength) {
            float r = age * 520.0;
            float d = dx - r;
            return strength * exp(-age * 1.6) * sin(d * 0.035) * exp(-d * d / 14000.0);
        }

        // across the sheet (v from -1 to 1) the cover colours, drifting along it
        vec3 sheetColor(float v, float x) {
            float s = clamp(v * 0.5 + 0.5 + 0.35 * sin(x * 0.0019 + time * 0.17), 0.0, 1.0);
            vec3 col = s < 0.5 ? mix(c0, c1, s * 2.0) : mix(c1, c2, s * 2.0 - 1.0);
            // saturation breathes slowly along the sheet
            float breathe = 0.5 + 0.5 * sin(time * 0.23 + x * 0.0011);
            float grey = dot(col, vec3(0.299, 0.587, 0.114));
            return clamp(mix(vec3(grey), col, mix(0.55, 1.3, breathe)), 0.0, 1.0);
        }

        void main() {
            vec2 c = vec2(gl_FragCoord.x, res.y - gl_FragCoord.y) / scale;   // CSS px, y down
            vec2 size = res / scale;
            float H = max(size.y, 130.0);
            float x = c.x;
            float bass = drive.x, mids = drive.y, highs = drive.z;
            float t = flow;

            // the centre line: three waves whose heights drift, so the shape keeps changing
            float a1 = 0.55 + 0.25 * sin(time * 0.13);
            float a2 = 0.30 + 0.20 * sin(time * 0.17 + 1.3);
            float a3 = 0.15 + 0.10 * sin(time * 0.29 + 2.1);
            float amp = H * 0.13 * (1.0 + 0.45 * bass);
            float k1 = 0.0052, k2 = 0.0091, k3 = 0.0153;
            float m = box.y + amp * (a1 * sin(k1 * x + t) + a2 * sin(k2 * x - 0.7 * t + 1.7) + a3 * sin(k3 * x + 1.3 * t + 4.0));
            float dm = amp * (a1 * k1 * cos(k1 * x + t) + a2 * k2 * cos(k2 * x - 0.7 * t + 1.7) + a3 * k3 * cos(k3 * x + 1.3 * t + 4.0));
            float dx = abs(x - box.x);
            m += H * 0.09 * (ripple(dx, ripples.x, ripples.y) + ripple(dx, ripples.z, ripples.w));

            // the roll: the sheet turns as it travels; its seen width is W * cos(theta)
            float kt = 0.0037;
            float theta = kt * x + 0.55 * t + 1.25 * sin(0.0021 * x - 0.31 * t);
            float dtheta = kt + 1.25 * 0.0021 * cos(0.0021 * x - 0.31 * t);
            float W = H * 0.27 * (0.85 + 0.15 * sin(0.0029 * x + 0.4 * t)) * (1.0 + 0.25 * bass);
            float dW = H * 0.27 * 0.15 * 0.0029 * cos(0.0029 * x + 0.4 * t) * (1.0 + 0.25 * bass);
            float ct = cos(theta), st = sin(theta);
            float S = W * ct;                                  // half the sheet's seen height
            float dS = dW * ct - W * st * dtheta;

            // the strands
            vec3 acc = vec3(0.0);
            float lit = 0.0;
            for (int i = 0; i < STRANDS; i++) {
                float v = (float(i) / float(STRANDS - 1)) * 2.0 - 1.0;
                float y = m + v * S;
                float d = abs(c.y - y) / sqrt(1.0 + (dm + v * dS) * (dm + v * dS));
                float depth = 0.55 + 0.45 * (v * st * 0.5 + 0.5);          // front face brighter than the back
                float shimmer = 1.0 + highs * 0.8 * sin(x * 0.021 - time * 7.0 + float(i) * 2.3);
                float edgeStrand = (i == 0 || i == STRANDS - 1) ? 1.8 : 1.0;  // the two edges read a little stronger
                float sheen = 0.45 + 0.55 * pow(0.5 + 0.5 * sin(x * 0.0043 + float(i) * 1.7 + time * 0.4), 1.5); // silk catches light unevenly
                float b = (exp(-d / 0.8) * 0.2 + exp(-d / 5.0) * 0.045) * depth * shimmer * edgeStrand * sheen;
                acc += sheetColor(v, x) * b;
                lit += b;
            }

            // the sheet between the strands: denser where it is turned edge-on, with a soft mist around it
            float across = (c.y - m) / (abs(S) + 1.5);
            float inside = 1.0 - smoothstep(0.92, 1.08, abs(across));
            float edgeOn = clamp(0.35 / (abs(ct) + 0.25), 0.0, 1.6);
            float fill = inside * 0.07 * edgeOn * (0.7 + 0.3 * (1.0 - across * across));
            float mist = exp(-max(abs(c.y - m) - abs(S), 0.0) / 34.0) * 0.05 * (1.0 + bass);
            float vAt = clamp(across, -1.0, 1.0) * sign(ct + 1e-4);
            acc += sheetColor(vAt, x) * (fill + mist);
            lit += fill + mist;

            // strongest around the words, fading out sideways and at the window edges,
            // and a little softer right behind the letters so they stay readable
            vec2 rel = abs(c - box.xy);
            float side = exp(-max(rel.x - box.z - 80.0, 0.0) / 320.0);
            float round = min(box.w, 24.0);
            vec2 di = rel - box.zw + round;
            float sd = length(max(di, 0.0)) + min(max(di.x, di.y), 0.0) - round;
            float behind = 1.0 - 0.38 * (1.0 - smoothstep(-26.0, 20.0, sd));
            // the sides fade over up to 35% of the width each (so a small window shows no hard edge)
            float fadeX = min(260.0, size.x * 0.35), fadeY = min(40.0, size.y * 0.22);
            float sx = smoothstep(0.0, fadeX, min(c.x, size.x - c.x));
            float sy = smoothstep(0.0, fadeY, min(c.y, size.y - c.y));
            float k = side * behind * sx * sx * sx * sy * sy * power * (0.75 + 0.45 * bass + 0.15 * highs);

            // soft limit, so the folds glow instead of turning into flat white
            float a = 1.0 - exp(-lit * k * 1.4);
            a = min(a, 0.85);
            vec3 col = lit > 0.0 ? acc / lit : vec3(0.0);
            outColor = vec4(col * a, a);
        }`;

    const compile = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
        return s;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    gl.useProgram(program);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, 'pos');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    const u = {};
    ['res', 'scale', 'time', 'flow', 'c0', 'c1', 'c2', 'box', 'power', 'drive', 'ripples'].forEach((n) => { u[n] = gl.getUniformLocation(program, n); });

    // full resolution: the strands are under a pixel wide
    const QUALITY = 1;
    const fallback = [[0.45, 0.35, 1], [0.2, 0.75, 1], [0.95, 0.4, 0.8]];
    let target = fallback.map(c => c.slice());
    let shown = fallback.map(c => c.slice());
    let box = null;
    let level = 0;
    let flow = 0;
    const drive = [0, 0, 0];                      // bass, mids, highs, smoothed
    let beats = [[99, 0], [99, 0]];               // the last two beats: [age s, strength]
    let hadColors = false;
    const start = performance.now();

    const parse = (css) => {
        const m = String(css).match(/^#?([0-9a-f]{6})$/i);
        if (!m) return null;
        const n = parseInt(m[1], 16);
        return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
    };

    return {
        // up to three '#rrggbb' colours from the cover; fewer are repeated
        colors(list) {
            const cols = (Array.isArray(list) ? list : []).map(parse).filter(Boolean);
            target = cols.length ? [0, 1, 2].map(i => cols[i % cols.length]) : fallback.map(c => c.slice());
            // the first cover shows straight away; later ones fade in
            if (!hadColors && cols.length) { shown = target.map(c => c.slice()); hadColors = true; }
        },

        // want: { x, y, w, h } of the words in focus (CSS px in the canvas), or null; power: setting (0 = off);
        // input: { bass, mids, highs } 0-1 and beat (0, or 0-1 strength on the frame a beat lands);
        // dt: seconds since the last frame
        frame(want, power, input, dt) {
            const goal = want && power > 0 ? power : 0;
            level += (goal - level) * Math.min(1, dt * 2.5);
            const next = input ? [input.bass, input.mids, input.highs] : [0, 0, 0];
            next.forEach((v, i) => {
                // quick to rise, slower to fall, so hits register and then settle
                const rate = v > drive[i] ? 14 : 2.5;
                drive[i] += (Math.max(0, Math.min(1, v || 0)) - drive[i]) * Math.min(1, dt * rate);
            });
            beats.forEach(b => { b[0] += dt; });
            if (input && input.beat > 0.05) beats = [[0, Math.min(1, input.beat)], beats[0]];
            flow += dt * (0.28 + 0.55 * drive[1] + 0.2 * drive[0]);
            if (want) {
                const target = [want.x + want.w / 2, want.y + want.h / 2, want.w / 2, want.h / 2];
                box = box ? box.map((v, i) => v + (target[i] - v) * Math.min(1, dt * 4)) : target;
            }
            const k = Math.min(1, dt * 1.2);
            shown = shown.map((c, i) => c.map((v, j) => v + (target[i][j] - v) * k));

            const w = Math.max(1, Math.round(canvas.clientWidth * QUALITY));
            const h = Math.max(1, Math.round(canvas.clientHeight * QUALITY));
            if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
            gl.viewport(0, 0, w, h);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            if (level < 0.01 || !box) return;

            gl.uniform2f(u.res, w, h);
            gl.uniform1f(u.scale, QUALITY);
            gl.uniform1f(u.time, (performance.now() - start) / 1000);
            gl.uniform1f(u.flow, flow);
            gl.uniform3fv(u.c0, shown[0]);
            gl.uniform3fv(u.c1, shown[1]);
            gl.uniform3fv(u.c2, shown[2]);
            gl.uniform4fv(u.box, box);
            gl.uniform1f(u.power, level);
            gl.uniform3fv(u.drive, drive);
            gl.uniform4f(u.ripples, beats[0][0], beats[0][1], beats[1][0], beats[1][1]);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
    };
})();
