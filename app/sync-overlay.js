// Copies the lyrics overlay into this app (overlay/). Its one source is the standalone Lyrics Overlay in
// C:\presl\Lyrics\lyrics-overlay; run `npm run sync-overlay` after changing it there.

const fs = require('fs');
const path = require('path');

const from = path.join(__dirname, '..', '..', 'Lyrics', 'lyrics-overlay');
const to = path.join(__dirname, 'overlay');
const files = ['core.js', 'overlay.html', 'overlay.css', 'overlay.js', 'aura.js', 'preload.js'];

fs.mkdirSync(to, { recursive: true });
for (const name of files) {
    fs.copyFileSync(path.join(from, name), path.join(to, name));
    console.log(`overlay/${name}`);
}
