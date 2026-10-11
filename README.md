# 3x3 Shuffler

Live at **https://3x3shuffler.app**. A Rubik's cube (3x3) site built on three.js r147. Static files only, no backend.

- **Step through:** shows a scramble move by move on a 3D cube, with an arrow for each turn and a grid of step cards. Paste any scramble (numbering, commas and curly quotes are ignored) or reopen one from the recent list.
- **Play:** shuffle (randomly or to a pasted scramble), then solve by dragging layers or with the keys U D L R F B M E S (Shift for counter-clockwise). Includes undo, a move count, a timer that starts on your first turn, and a list of recent solves.
- **Timer:** a timer for solving a real cube. Hold Space (or press and hold on a phone) until the display turns green, let go to start, and press any key or tap to stop. Shows best, Ao5, Ao12 and mean, plus your times.
- **Cube look:** UV-coated or matte finish, stickerless or black with stickers, and two ways of holding the cube.

Times, solves, recent scrambles and settings are stored in the browser's localStorage. Nothing is sent to a server.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | Page markup, plus the search and share metadata (description, Open Graph tags, structured data) |
| `styles.css`, `app.js` | All styles and all app code |
| `vendor/three.min.js` | three.js r147, served locally (no CDN) |
| `icon.svg`, `*.png`, `site.webmanifest` | Favicon, home-screen icons and the link preview image |
| `robots.txt`, `sitemap.xml` | For search engines |
| `_headers` | Security headers for Cloudflare (same policy as the nginx config) |
| `.assetsignore` | Keeps repo-only files (README, compose, nginx, .git) off the live site |
| `nginx/default.conf`, `docker-compose.yml` | Self-hosting with nginx instead of Cloudflare |

## Run it yourself

```bash
docker compose up -d        # http://<host>:8088
# or, for a quick look without the security headers:
python3 -m http.server 8088
```

## Links

`?scramble=R+U2+F'` opens that scramble in Step through. `#play` and `#timer` open those tabs.

## Security notes

- No inline script or style, so the policy only allows scripts from the site itself (`script-src 'self'`). The structured-data block in `index.html` is JSON, which browsers don't run.
- Everything users type or paste is checked against the 18 face turns before it is used, and is always shown as plain text.
- `frame-ancestors 'none'` stops other sites from framing the page.
- Only Google Fonts is loaded from elsewhere. Without it the page falls back to system fonts.
