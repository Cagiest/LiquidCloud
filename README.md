# LiquidCloud

A Spotify-style look for [SoundCloud](https://soundcloud.com): a grid player bar with the progress under the controls, the SF Pro font, a background that takes its colours from the cover, and synced lyrics.

## Userscript (any browser)

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Open **[soundcloud-spotify.user.js](https://raw.githubusercontent.com/Cagiest/LiquidCloud/main/soundcloud-spotify.user.js)** and press **Install**.
3. Open soundcloud.com.

Tampermonkey checks this repository for a newer version by itself (once a day by default) and updates the script. To update straight away: Tampermonkey's menu → **Utilities** → **Check for userscript updates**.

Optional: paste your own Spicy Lyrics key in the script's settings for word-by-word lyrics. Keys stay in your browser.

## Also in this repository

- `app/`: the Windows desktop app (WebView2), see `app/README.md`.
- `ios/`: the iPhone app (SwiftUI), built by GitHub Actions.
- `dev/`: the development loader and server used while working on the script.
