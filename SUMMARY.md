# SoundCloud → Spotify (LiquidMusic) userscript: project summary

A Tampermonkey userscript that restyles soundcloud.com to match Spotify running the Spicetify
"LiquidMusic" theme, and adds features SoundCloud doesn't have. It started as v6.12 (a mostly-CSS
script with several broken areas) and is now v6.44.

- **Project folder:** `C:preslLiquidCloud` (script, `dev/` server and loader, `backups/` per version)
- **Script:** `soundcloud-spotify.user.js` (CSS first, then JavaScript)
- **Standalone copies:** `Downloads\SoundCloud Spotify Layout & Dynamic Background-6.xx.user.js`
- **Browser:** Opera GX with Tampermonkey, logged in to SoundCloud

## Overall layout

Three floating panels under a fixed top bar, each stopping 12px above the bottom of the window:

| Panel | What it is |
| --- | --- |
| Library (left) | Icon rail, expands to 300px |
| Main (centre) | SoundCloud's page, scrolling inside its own rounded panel |
| Lyrics (right) | Synced lyrics for the playing song |

The player is a floating pill at the bottom centre. A blurred copy of the playing song's artwork
sits behind everything.

## What was built, by area

### Top bar
- Left: SoundCloud logo (goes to Discover), then your picture and name.
- Centre: search (navigates without reloading, so music keeps playing).
- Right, as icons: Import (opens TuneMyMusic after a notice), Upload, Library, Settings.

### Player bar
- Grid layout: shuffle, previous, play, next, repeat, a "now playing" chip (cover, cleaned title over
  artist, like), queue, volume; progress bar underneath.
- Queue ("Next up") is a floating panel above the bar.
- Volume is an always-visible horizontal slider that drives SoundCloud's real volume.
- **"On hover" mode:** the bar rests as a small capsule and springs open when the pointer nears the
  bottom centre of the window. Works everywhere, not just in fullscreen.

### Notifications
- SoundCloud's own bell is in its header, which the script hides, so the top bar has its own bell
  (between Upload and Library) with a count of new activity, checked every two minutes.
- The panel lists likes, reposts, comments (with their text), mentions and follows, with filter tabs
  (All, Likes, Reposts, Follows, Comments), loads older items as you scroll, and links to SoundCloud's
  own /notifications page. Names and titles open their pages without reloading.
- Data: api-v2 `/activities` and `/activities/<likes|reposts|follows|comments>` (found in SoundCloud's
  own code; activity types track-like, playlist-like, track-repost, playlist-repost, comment, mention,
  affiliation). "New" = newer than the last time the panel was opened, kept in this browser
  (`sc-notes-seen`); new items stay highlighted until it is opened again.

### Library
- Filled from SoundCloud's own library data: Liked Songs, your playlists, liked playlists and EPs,
  then followed artists.
- Expanded view: "Your Library" header with a Create pill, Playlists and Artists filter chips, rows
  labelled "Playlist • owner", "EP • artist" or "Artist".
- **Create** opens a dialog (name, public or private) that makes a new empty playlist.
- Remembers whether it was left open. Nothing shifts when it opens or closes.

### Playlist page
- Header: cover, "Playlist" label, large title, then creator avatar and name, track count, length
  and last-updated on one centred line. Round play button with action icons beside it.
- Tag-suggestion box removed.
- **Reorder:** on playlists you own, a Reorder button makes rows draggable. Nothing is sent while you
  arrange; Save order sends the new order in one request and confirms it; Cancel restores the page.

### Track rows (playlists, previews and the song page share one format)
- Columns: number, cover, title over artist, plays, like, length, under a "# Title / Plays / clock"
  header. Lengths are added to playlist rows (SoundCloud doesn't show them).
- Play and pause appear in the number slot, in the song's accent colour.
- A click on a row plays it but never pauses it; pausing is for the play/pause buttons and Space.

### Artist page
- Blurred profile picture fading down the panel, avatar, large name, followers and track count.
- Round play button, Follow pill, icon buttons.
- **Popular:** top tracks with plays and length ("See more" for ten).
- **Fans also like:** related artists, to the right of Popular.
- **Discography:** tabs as filter pills; releases as tiles (cover, name, year) on every tab.
- Tabs with nothing behind them are hidden; Vinyl is always hidden.
- Switching tabs only moves the list; the header and scroll position stay put.

### Song page
- SoundCloud's logged-in track page is a separate embedded app that can't be restyled, so the script
  draws its own page over it and presses SoundCloud's real buttons behind the scenes.
- Header (cover, "Single", title, artist • year • length), action row (play, shuffle, like, add to
  playlist, repost, copy link), a playlist-style track row, release date and label, an About
  section, "More by {artist}" tiles, and comments with "Show more".
- "Original page" button switches to SoundCloud's own page, which is still needed to write a comment.

### Discover and search
- **Discover:** horizontal shelves of 180px tiles with title and subtitle, play on hover, arrows that
  scroll four tiles.
- **Search:** large title, filter pills, results as compact cards in columns. Legal links moved to
  the bottom; language picker and "Go+ tracks" filter removed.

### Page transitions
- Clicking a link no longer blanks the page: the current page stays while the next loads, slides
  out, and the new one slides in. Back and forward buttons don't get this.

### Lyrics
- **Sources:** LRCLIB lyrics appear straight away. If Spicy Lyrics has better ones (word timing, or
  timing where LRCLIB has none), they replace them a few seconds later; untimed Spicy text never
  replaces timed LRCLIB lines. If neither has the song, Genius is used (plain, unsynced). A result is
  only used when title and artist match.
- **Spicy Lyrics** needs only its own client key. It looks songs up by Spotify track ID, which the
  script gets from, in order: a Spotify link you pasted for that song; MusicBrainz recordings looked
  up on ListenBrainz; ListenBrainz by artist and title; Apple's song search (forgiving about spelling
  and stage names) plus ListenBrainz; and last the Spotify links stored on MusicBrainz itself. A song
  can have several Spotify IDs, so each is tried until Spicy Lyrics has one. The ID that worked is
  remembered per song.
- **Word animation:** driven every screen frame. The current word's gradient fills continuously while
  the word grows, lifts and glows, then settles with a fading afterglow. Real word timing with Spicy
  Lyrics; estimated from line timing with LRCLIB.
- **Lines:** the active line is full size and sharp; others are slightly smaller and blur with
  distance. Pointing at the lyrics sharpens them all. Several lines can be active at once.
- **Backing vocals** (Spicy Lyrics) appear under their lead line at a smaller size with their own sweep.
- Click a line to jump there. Songs without timestamps show plain text.
- **Alignment:** a "Lyrics alignment" setting (left, middle, right) sets which side lines are set
  from and grow from, in the panel and in fullscreen.
- **Font:** SF Pro Display, semibold by default, set as normal running text so the font's own
  spacing applies. A "Lyrics weight" setting changes it.
- **Timing offsets:** one for every song, plus per-song entries added with + while a song plays.

### Fullscreen lyrics
- Opened from the button at the bottom right of the lyrics panel. Blurred, optionally rotating
  cover as background; cover with title and artist; large lyrics. Content blurs in on open.
- Ignores browser zoom, so sizes and blur stay the same at any zoom level.

### Settings (gear in the top bar, or in fullscreen)
| Tab | Contents |
| --- | --- |
| Appearance | Background brightness and blur; panel brightness and blur (all three panels together); lyrics glow; lyrics weight; lyrics alignment |
| Layout (fullscreen) | Show cover, show lyrics, lyrics position, centre cover when no lyrics, cover size, cover anchor point, lyrics size |
| Text (fullscreen) | Show title, show artist, alignment, text size |
| Background (fullscreen) | Brightness, blur, rotate while playing, rotation speed |
| Controls | Player bar (always, on hover, off) and fullscreen volume bar (visibility and position) |
| Lyrics | Timing offsets; Spicy Lyrics key; Spotify link for the playing song, with Search (opens Spotify's search for it), Save and Clear |

### Site-wide
- **Accent colour** comes from the playing song's artwork and fades between songs.
- **One title cleaner** strips promo text such as "(prod. x)" and "[OUT NOW]"; it is used for track
  rows, the player bar, the fullscreen title and the lyrics search.

## Version history

| Version | Main changes |
| --- | --- |
| 6.13 | Player bar, playlist header, play icons, progress bar, queue, in-app navigation |
| 6.14 | Artist page; custom song page |
| 6.15 | Floating panels, library rebuild, unified rows, comments, LRCLIB lyrics |
| 6.16 | Number-slot play button, inline volume, song-coloured accent, Discover, search, profile click fix, fullscreen lyrics |
| 6.17 | Accent fade, library animation fix, expanded fullscreen settings |
| 6.18 | Shared title cleaner, zoom-independent fullscreen, lyric timing offsets |
| 6.19 | Row centring, top bar icons and Import, settings in the top bar with tabs, Create playlist dialog, avatar shadow |
| 6.20 | Page transitions, fullscreen blur-in, blur slider, cover anchor grid, "On hover" bar everywhere |
| 6.21 | Bar pointer zone, list-only profile tab transitions, drag-to-reorder (first version) |
| 6.22–6.23 | Reorder save fix, then Reorder / Save order / Cancel mode |
| 6.24 | Rows no longer pause on click, Appearance tab, per-song timing list, word-by-word lyrics, Spicy Lyrics option |
| 6.25 | Per-letter lyric animation, overlapping lines, lyric font |
| 6.26 | Seek and volume fixed with the bar collapsed or hidden; Genius fallback |
| 6.27 | Lyrics back to whole words with a gradient sweep (restores the font's spacing); accent-coloured row play icon |
| 6.28 | Lyrics weight setting, semibold default; glow no longer clipped at the text edges |
| 6.29 | Spicy Lyrics without Spotify credentials: MusicBrainz match and pasted Spotify links; LRCLIB shows first |
| 6.30 | Backing vocals under their lead line; syllables of one word no longer split across rows |
| 6.31 | Per-frame word animation (fill, rise, glow, settle); lines blur and shrink with distance |
| 6.32 | Spotify client ID / secret removed; song matching through ListenBrainz and Apple search; Search button for the Spotify link; lyrics alignment setting; untimed Spicy text no longer replaces timed LRCLIB lyrics |
| 6.33 | Sends lyrics to the Lyrics Overlay desktop app (`C:\presl\Lyrics`); player bar no longer hidden under the library and lyrics panels |
| 6.34 | Sends the artwork's main colours (up to three) to the Lyrics Overlay for its aura |
| 6.35 | Aura colours taken from the cover as they look (k-means clusters by area, real saturation); Spicy Lyrics explains a refused key instead of "Failed to fetch" |
| 6.36 | Notifications bell and panel in the top bar; Settings > Desktop lyrics controls the Lyrics Overlay app; sends the cover for the overlay's now-playing block |
| 6.37 | Desktop lyrics: now-playing position is a 3x3 anchor picker (inside the aura) instead of above/below |
| 6.38 | Desktop lyrics: "Fill window" option for lines shown |
| 6.39 | Sends song length and link with each update (for the app's Discord status) |
| 6.40 | Top bar height is one variable (`--sc-bar-h`); in the LiquidCloud app the bar is a slim 36px title bar with window buttons (dragging, double-click maximise, snap) |
| 6.41 | App title bar 46px with larger contents; search box centred on the window, icons beside the window buttons |
| 6.42 | App window buttons styled like Spotify's (white, crisp 1px, 48px wide) |
| 6.43 | (LiquidCloud) volume diagnostics in the app's playback.log |
| 6.44 | Settings > Lyrics > Your TTML: load a .ttml file to check it against the song (Temporary, or Keep per song), like Spicy Lyrics' Lyrics Manager |
| 6.45 | Desktop lyrics: lyrics and now playing are two separate overlays; the anchor picker is replaced by "Hide the lyrics" / "Hide now playing" |

## Lyrics Overlay (desktop app)

A separate app in `C:\presl\Lyrics\lyrics-overlay` floats the synced lyrics on the desktop. From 6.33 the
script sends it the lyrics it found and the playback position (timing offsets applied) at
`http://127.0.0.1:8766/state`; when the app is not running it only checks every 5 seconds. Details are in
`C:\presl\Lyrics\SUMMARY.md`.

### Desktop lyrics settings
Settings > Desktop lyrics edits the overlay app's own settings: text size, weight, glow, alignment,
lines shown, what is behind the text, aura opacity, the now-playing overlay (cover, title, artist, cover
size), lock, fade under the mouse, and hiding each overlay (lyrics, now playing). The app returns its settings with every
reply to `/state`, so tray-menu changes show up here; changes go to `/settings`, which only takes the
listed keys with valid values. The tab is greyed out while the app is not running.

## LiquidCloud desktop app (`app/`)

One file, `app/release/LiquidCloud.exe`, nothing to set up: opens SoundCloud as its own window with this
theme, ad blocking, the lyrics overlay and its aura, and Discord status. The window is a small C# program
on WebView2 (Edge's engine built into Windows), because SoundCloud only gives encrypted tracks' keys to
software it recognises: WebView2 gets them, Electron was refused even with castlabs' Widevine build
VMP-signed. The theme is injected by the window program; the Electron companion runs the overlay, Discord
status and tray, reached at 127.0.0.1:8766. Build with `npm run dist`; details in `app/README.md`.

## How development works

- **Dev server:** `node dev/server.js soundcloud-spotify.user.js` from the project folder. It stops
  when the session that started it ends and has to be started again.
- **Dev loader:** a small Tampermonkey script that loads `soundcloud-spotify.user.js` from this
  computer (127.0.0.1:8765) and lets the Claude session read the page and run test snippets on the
  visible SoundCloud tab. It only talks to this computer.
- **Installing a standalone copy replaces the loader** and disconnects the session. Re-installing the
  loader (one click on Tampermonkey's update page) reconnects it.
- If the dev server isn't running, the loader uses the last copy of the script it loaded, so the
  theme keeps working but stops updating.
- **When development is finished**, install the latest standalone copy from Downloads so the script
  no longer depends on the loader.

## Things worth knowing

- **Layers:** `#app` is `position: fixed`, which makes it its own layer, so nothing inside it (the
  player bar included) can rise above `#app` itself. `#app` is at 1000: above the library (999) and lyrics
  (998) panels, below the top bar (9999). Things added to `<body>` that must show over the page sit above
  it: SoundCloud's menus (`.g-z-index-overlay`, raised from 900 to 1002), the song-page iframe and its
  Back button (1001).

- **Lyrics font on this computer:** the file registered as "SF Pro Display Bold"
  (`SFPRODISPLAYBOLD.OTF`) draws about 25% heavier than Spotify's lyrics, measured side by side. The
  semibold weight matches, which is why it is the default. Spicy Lyrics' own font file is Apple's San
  Francisco Bold; its server doesn't allow other sites to load it, and it is not copied into the script.
- **Spicy Lyrics setup:** a client key (`sl_pk_...`) from developers.spicylyrics.org with
  `https://soundcloud.com` as an allowed origin. Not the secret key. It is stored only in the browser.
- **Why a Spotify ID is needed at all:** Spicy Lyrics' database is keyed by Spotify track ID and has
  no search by title. SoundCloud songs have no Spotify ID, so each one has to be matched. Songs that
  aren't on Spotify can never get Spicy Lyrics.
- **Spotify's own search returned 403** with a development-mode app, even with Web API enabled,
  most likely because the account lacks Premium, so the client ID and secret fields were removed in
  6.32. Scraping Spotify's site search was considered and rejected: it means imitating
  Spotify's web player past a lock built to prevent that, and it breaks whenever Spotify changes it.
- **Why most songs failed to match before 6.32:** MusicBrainz lists most songs but stores a Spotify
  link on very few of them ("Loving Machine" by TV Girl had none). ListenBrainz keeps that mapping
  separately and covers far more. Songs still missed need a pasted link (Spotify: Share, Copy Song Link).
- **SoundCloud's audio cannot be analysed by the script.** Streams for monetised tracks are encrypted
  and the plain-MP3 address came back empty when tested, so syncing lyrics by listening to the audio
  is not possible from a userscript.
- **Genius has no lyrics API.** The fallback reads lyrics from its public song pages and can break if
  the page layout changes.
- **Reorder:** only rows that are loaded can be moved, and SoundCloud's player keeps the old order
  until the page is reloaded.
- **Another lyrics userscript's widgets are hidden** by this script because they overlapped the
  lyrics panel; disable that script in Tampermonkey if it's no longer wanted.

- **Spicy Lyrics error replies have no CORS header.** A wrong, deleted or rate-limited key gets a 401/429
  the page is not allowed to read, so the browser only throws a TypeError ("Failed to fetch"). The
  settings status line now says the key was refused instead.

## Not tested

- **Genius fallback:** search and page structure were checked, but the request itself has not run
  through Tampermonkey.
- **Create playlist:** the dialog was checked, but no playlist was actually created.
- **Pasted Spotify links** and the link field in the browser; the parser and the MusicBrainz lookup
  were tested outside the browser.
- **Truly overlapping lead lines** from Spicy Lyrics; backing vocals were confirmed on a real song.
- **The new word animation on LRCLIB songs** (estimated timing); it was watched on a Spicy Lyrics song.
- **Repost** from the song page.
- **Likes, feed and Library pages**, and search filters other than Everything.
- Several fullscreen options: the Below and Left layouts, two of the volume positions, the
  no-lyrics centring.
- SoundCloud's class names can change at any time, which would break the parts of the theme that
  rely on them.
