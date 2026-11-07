# LiquidCloud

A Spotify-style look for [SoundCloud](https://soundcloud.com): a grid player bar with the progress under the controls, the SF Pro font, a background that takes its colours from the cover, and synced lyrics.

## Userscript (any browser)

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Open **[liquidcloud.user.js](https://raw.githubusercontent.com/Cagiest/LiquidCloud/main/liquidcloud.user.js)** and press **Install**.
3. Open soundcloud.com.

That's all: the installed script is a small loader that fetches the newest version of the theme
(`soundcloud-spotify.user.js`) from this repository every time SoundCloud opens, so there is nothing to update by
hand. If GitHub can't be reached it uses the last version it got. (After a change is pushed, GitHub can take up to
five minutes to hand out the new copy.)

Optional: paste your own Spicy Lyrics key in the script's settings for word-by-word lyrics. Keys stay in your browser.

## Also in this repository

- `app/`: the Windows desktop app (WebView2), see `app/README.md`.
- `ios/`: the iPhone app (SwiftUI), built by GitHub Actions.
- `dev/`: the development loader and server used while working on the script.
