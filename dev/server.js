// Dev-only bridge between this session and the Tampermonkey dev loader.
//   GET  /loader.user.js  the dev loader userscript (install once)
//   GET  /payload.js      the real script being developed
//   GET  /go?p=/path      test-browser helper (carries the script in window.name)
//   GET  /poll            loader asks for work; visible tabs receive queued commands
//   POST /result?id=      loader reports a command result
//   POST /cmd             queue JS for the visible SoundCloud tab, respond with its result
const http = require('http');
const fs = require('fs');
const path = require('path');
const payloadFile = process.argv[2];
const loaderFile = path.join(__dirname, 'loader.user.js');
const logFile = path.join(__dirname, 'bridge.log');

let queue = [];            // { id, js }
const waiting = new Map(); // id -> res
let nextId = 1;
let lastPoll = 0;

const body = (req) => new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
});

http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    res.setHeader('Cache-Control', 'no-store');
    if (u.pathname === '/loader.user.js') {
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        return res.end(fs.readFileSync(loaderFile));
    }
    if (u.pathname === '/payload.js') {
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        return res.end(fs.readFileSync(payloadFile));
    }
    if (u.pathname === '/go') {
        const p = u.searchParams.get('p') || '/';
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end('<script>window.name = ' + JSON.stringify(fs.readFileSync(payloadFile, 'utf8')).replace(/</g, '\\u003c') +
            '; location.replace("https://soundcloud.com" + ' + JSON.stringify(p) + ');</script>');
    }
    if (u.pathname === '/poll') {
        lastPoll = Date.now();
        const visible = u.searchParams.get('vis') === '1';
        const cmds = visible ? queue.splice(0) : [];
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ ver: fs.statSync(payloadFile).mtimeMs, cmds }));
    }
    if (u.pathname === '/result') {
        const id = Number(u.searchParams.get('id'));
        const text = await body(req);
        const w = waiting.get(id);
        if (w) { waiting.delete(id); w.end(text); }
        res.end('ok');
        return;
    }
    if (u.pathname === '/status') {
        return res.end(JSON.stringify({ lastPollAgoMs: lastPoll ? Date.now() - lastPoll : null, queued: queue.length }));
    }
    if (u.pathname === '/cmd' && req.method === 'POST') {
        const js = await body(req);
        const id = nextId++;
        queue.push({ id, js });
        waiting.set(id, res);
        fs.appendFileSync(logFile, `[cmd ${id}] ${js.slice(0, 200).replace(/\s+/g, ' ')}\n`);
        setTimeout(() => {
            if (waiting.has(id)) { waiting.delete(id); queue = queue.filter((c) => c.id !== id); res.end('TIMEOUT: no visible SoundCloud tab answered'); }
        }, Number(u.searchParams.get('t') || 25000));
        return;
    }
    res.statusCode = 404;
    res.end('not found');
}).listen(8765, '127.0.0.1');
