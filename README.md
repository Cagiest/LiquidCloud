# LiquidCloud

A Spotify-style look for [SoundCloud](https://soundcloud.com): a grid player bar with the progress under the controls, the SF Pro font, a background that takes its colours from the cover, and synced lyrics.

## Userscript (any browser)

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Open **[liquidcloud.user.js](https://raw.githubusercontent.com/Cagiest/LiquidCloud/main/liquidcloud.user.js)** and press **Install**.
3. Open soundcloud.com.

Updates come through Tampermonkey the usual way: it checks this repository for a newer version (once a day by
default) and you can see every change in the commit history. To update straight away: Tampermonkey's menu →
**Utilities** → **Check for userscript updates**. Tampermonkey asks you again whenever a new version needs new
permissions.

Optional: paste your own Spicy Lyrics key in the script's settings for word-by-word lyrics. Keys stay in your browser.

## Also in this repository

- `app/`: the Windows desktop app (WebView2), see `app/README.md`.
- `ios/`: the iPhone app (SwiftUI), built by GitHub Actions.
- `dev/`: the development loader and server used while working on the script.
