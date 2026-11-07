# LiquidCloud (desktop app)

SoundCloud as its own app, with the LiquidCloud theme, ad blocking, the lyrics overlay and its aura, and
Discord status. One file: `release\LiquidCloud.exe` (portable, nothing to install, nothing to set up).
Open it and SoundCloud opens; LiquidCloud stays in the tray (lyrics, switches, quit). Opening it again
brings the SoundCloud window back.

## How it works

SoundCloud's encrypted tracks (most label releases) only get their decryption keys in software SoundCloud
recognises. Electron was refused (see below); **WebView2**, Microsoft Edge's engine that is built into
Windows, gets them. So LiquidCloud is two programs packed in one file:

| Part | What it does |
| --- | --- |
| `browser/` (`LiquidCloud.Browser.exe`) | The SoundCloud window: C# + WebView2. Runs the theme in every SoundCloud page, answers the theme's requests (the companion, and the userscript's `@connect` sites only), blocks ads (`adblock.json`), remembers its position. No Windows title bar: the theme's top bar is the title bar (46px, search centred, drag region, its own minimise / maximise / close; the window keeps its frame for resizing, snap and shadow). Profile: `%APPDATA%\LiquidCloud\webview2` |
| `main.js` | The companion (Electron): opens the window, runs the lyrics overlay, Discord status and the tray, and listens on http://127.0.0.1:8766 (the same address the standalone overlay uses) |
| `build-theme.js` | Builds `browser-assets/theme.js`: the theme (`../liquidcloud.user.js`) with stand-ins for Tampermonkey (`inject.js`), `audio-tap.js` and the bridge to the window program; plus `adblock.json` and `connect.json` |
| `audio-tap.js` | Hears unencrypted songs for the aura (encrypted ones follow the lyric timing) |
| `discord.js` | "Listening to" status with song, artist, cover, time left and a Listen on SoundCloud button |
| `overlay/` | The lyrics overlay, copied from `C:\presl\Lyrics\lyrics-overlay` by `npm run sync-overlay` (edit it there) |

The companion's replies to the window carry the ad-blocking switch and tray commands (play, next,
previous, show). Media keys work through WebView2 itself.

## Building

```
npm run dist
```

builds the theme from the current userscript, publishes the window program (`dotnet publish`, needs the
.NET 9 SDK) and packs everything into `release\LiquidCloud.exe`. The window program carries its own .NET,
so the exe needs nothing installed (WebView2 is part of Windows 10/11).

Running from source: `npm run build-window` once, then `npm start` (or `Start LiquidCloud.cmd`), which
rebuilds the theme each start. After changing the overlay in `C:\presl\Lyrics\lyrics-overlay`, run
`npm run sync-overlay` first.

## Settings and data (`%APPDATA%\LiquidCloud`)

- `liquidcloud.json` (tray: Open settings file; applies while it runs): `discordClientId` (your Discord
  application's ID; Discord status stays off until it is set), `blockAds`, `discordStatus`,
  `startWithWindows`.
- `overlay.json`: the lyrics overlay (taken from the standalone overlay the first time).
- `webview2\`: the SoundCloud window's profile (sign-in, cookies). `window.json`: its position.

## Things worth knowing

- **Why not Electron:** SoundCloud's licence server answered 403 to every key request from Electron, even
  castlabs' Widevine build VMP-signed through castlabs EVS, packaged or not, with or without a debugger,
  on v44.5.1 and on v43.2.0 (BetterSoundCloud's version; its app is refused too). WebView2 gets 200.
  Tested 22 Oct 2026. (An Edge app window with a LiquidCloud extension also played, but Edge switches off
  command-line extensions and asks for developer mode, so it could not be zero-setup.)
- **Encrypted tracks need SoundCloud's own ads left alone.** Step tests (23 Oct 2026), adding one feature at a
  time on a fresh profile: plain WebView2, in-app error logging, the theme, the custom title bar, the audio listener,
  and blocking the other ad networks (`adblock.json`) all passed: 72 keys given, none refused, an ad included.
  Every refusal before that came after SoundCloud's ad was interfered with: its ad check blocked, its ad audio
  (AdsWizz) blocked, or the ad muted. A refusal or two then gets that profile refused for hours or longer, so
  `audio-tap.js` leaves ads unmuted (`MUTE_ADS = false`) and `adblock.json` leaves SoundCloud's ad flow alone.
  The window still pauses after two refusals within 15 s, so a refusal cannot snowball. The window program's
  test switches (`--profile`, `--plain`, `--no-devlog`) and the theme variants (`theme-notap.js`,
  `theme-nomute.js`) are kept for repeating such tests.
- **Google sign-in** may be refused in the window (Google limits sign-in inside apps); email + SoundCloud
  password (Forgot password sets one) or Apple work.
- **The standalone Lyrics Overlay and LiquidCloud use the same port (8766):** run one or the other.
- `npm install` does not download Electron's binary here: run `node node_modules/electron/install.js`.
- Two desktop overlays, the lyrics and now playing (cover, title, artist), each moved, resized and hidden on its own.
- Ctrl+Alt+L / Ctrl+Alt+H lock / hide both overlays. F12 in the SoundCloud window opens developer tools.
