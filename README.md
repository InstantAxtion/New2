# Sovereign: World Command

A real-time war game for Android. Pick any of ~200 countries on a world map, build up its economy and army, and take on the world.

It is single-player and fully offline, with no in-game purchases.

## Features

A Territorial.io-style conquest game on a real world map.

**How it plays**
- The world is cut into ~600,000 small land pixels (a 2000×1153 board). Every country owns its real land.
- One resource: 🪖 troops. They grow on their own (land income + interest) up to a cap set by your land. Crowded land is worth more than empty tundra.
- Attack by choosing a share of your troops on the slider and tapping a neighbour or empty land: your colour floods across the whole shared border, pixel by pixel, until the troops run out. Well-defended land and mountains cost more per pixel; the defender loses troops too.
- ⛵ Boats: tap a coast you don't border to ship troops across the sea (up to 3 at a time).
- 🤝 Alliances: neighbours offer to team up (a pop-up), and you can ask or break alliances by long-pressing a country. Allies can't attack each other — and bots sometimes betray.
- Smart bots: they keep most of their troops at home (troops at home are your defence and earn interest) and attack with the surplus, go all-in on empty land when it's safe, keep reserves sized to threats and incoming attacks, estimate what each attack would actually win, finish off weak rivals, hit neighbours busy fighting elsewhere, strike back, gang up on the runaway leader, avoid poking giants, team up against a common threat, and sail to the weakest coast in reach. In head-to-head tests they take 80–90% of the land against the previous bots. Easy mode uses the simpler bots; hard bots think faster and target you more.
- Big empires grow more slowly per pixel, so the leader can be caught.
- Win with 60% of the land (or when no rivals are left); lose when your last pixel falls.

**Modes**

| Mode | What it is |
|---|---|
| 🌍 World Conquest | Every country on Earth at once. Pick yours. |
| 🎯 Free-for-All | An empty world and 60 bots. Tap anywhere to land, then race for land. |
| 🏰 Europe / 🐉 Asia / 🦁 Africa / 🗽 Americas Brawl | Only one region is in play: smaller, faster matches. |

Easy, normal and hard difficulty.

**Look and feel**
- Crisp pixel-art territory with country names and troop counts, a flash on every captured pixel, a leaderboard, a news feed with BREAKING headlines.
- Cartoon style: a rounded font, chunky outlined buttons that squish when tapped, bouncy panels and pop-ups.
- Mobile-friendly: a big attack slider with presets at the bottom, one-thumb Play/Pause and speed buttons, swipe-to-close panels, flick-to-glide camera, double-tap zoom, vibration (can be turned off).
- Saves by itself; runs at 60 fps even on slower phones.

## Install on Android

Every push builds a debug APK in GitHub Actions:

1. Open the **Actions** tab, then the latest **Build & test** run.
2. Download the **sovereign-world-command-apk** artifact.
3. Copy the `.apk` to your phone and open it. You may need to allow "install unknown apps".

## Development

Requirements: Node 22+. Building the APK also needs JDK 21 and the Android SDK.

```bash
npm install
npm run dev          # play in the browser at http://localhost:5173
npm test             # game tests (every mode, attacks, boats, eliminations, winning, saves)
npm run build        # production web build in dist/
npx cap sync android # copy the build into the Android project
cd android && ./gradlew assembleDebug   # APK at android/app/build/outputs/apk/debug/
```

To regenerate the map from Natural Earth: `npm run build:map`. It downloads the data to `scripts/.cache/` and writes `public/data/world.json`.

To regenerate the icons and splash screens: `node resources/gen.mjs`.

### Project layout

```
scripts/build-map.mjs   Natural Earth → regions, terrain, coastlines
scripts/dev/terrrun.ts  headless match: npx tsx scripts/dev/terrrun.ts world 300 FRA
scripts/dev/aibattle.ts smart vs simple bots in one match: npx tsx scripts/dev/aibattle.ts ffa 300 4
src/terr/               the game (pure TypeScript, runs headless in tests)
  map.ts                the pixel board, terrain costs, coasts, sea routes for boats
  game.ts               troops, income, attacks spreading pixel by pixel, boats, alliances, saves
  ai.ts                 bots
  setup.ts              game modes and starting positions
src/render/terr.ts      map renderer (pixel texture, labels, boats, camera)
src/ui/terr/            Preact UI: menu, mode picker, HUD, attack slider, leaderboard, sheets
android/                Capacitor Android project
```

The previous region/unit-based version of the game is still in `src/sim`, `src/render/renderer.ts` and `src/ui/*.tsx` (not loaded by the app).

## Credits

Map data comes from [Natural Earth](https://www.naturalearthdata.com/) (public domain). Borders and statistics are simplified for gameplay.
