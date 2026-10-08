# Scramble Stepper

A single-page Rubik's cube (3x3) tool, built on three.js r147.

- **Step through:** generates a scramble and walks through it move by move on a 3D cube. An arrow shows which layer turns and in which direction, and there's a card for every step.
- **Play:** shuffle, then solve by dragging layers (or typing U D L R F B M E S, with Shift for counter-clockwise). Includes undo, a timer, a move count and a check for when the cube is solved.
- **Cube look:** UV-coated or matte finish, stickerless or black body with stickers, and two ways of holding the cube.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | The whole app: markup, styles and script |
| `vendor/three.min.js` | three.js r147, served locally so the page works without the CDN |
| `docker-compose.yml` | nginx container that serves only the two files above on port 8088 |

## Run it

```bash
# quick look
python3 -m http.server 8088
# or always-on
docker compose up -d
```

Then open `http://<host>:8088`. If `vendor/three.min.js` is missing, the page falls back to the jsDelivr CDN.

Google Fonts are still loaded from the web; without them the page falls back to system fonts.
