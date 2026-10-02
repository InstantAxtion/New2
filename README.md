# Sovereign: World Command

A real-time war game for Android. Pick any of ~200 countries on a world map, build up its economy and army, and take on the world.

It is single-player and fully offline, with no in-game purchases.

## Features

**World map**
- About 470 broad regions built from real states (Natural Earth data), named after their main city, plus a grid of sea zones. Neighbouring regions are shaded differently so each one stands out.
- Terrain (plains, forest, hills, mountains, desert, jungle, marsh, arctic) affects movement and defence.
- River crossings, narrow straits and naval chokepoints (Suez, Panama, Bosphorus, Malacca, Hormuz...).
- Map views: countries, terrain, resources and alliances, plus a rotating 3D globe.
- Smooth camera: flick the map and it glides, double-tap to zoom, and the camera flies to events.
- Fog of war: you only see enemy troops and buildings near your own land and units.

**Economy (just money)**
- Everything costs only 💰 money. Money comes from taxes in your regions plus ⛏ resource exports.
- Your country digs up resources and sells them to the world automatically. Mines dig more; the world price goes up and down, with booms and crashes.
- Everyone buys from you by default, except countries at war with you or that put an embargo on you. You can embargo others too.
- Countries fighting a stronger enemy get foreign aid from their friends.

**Buildings**
- Mine (more resources to sell), factory (more taxes), barracks, airbase, port and fort, several with up to three levels.
- Mines and factories show exactly what they earn: per region on the map while placing them, in the build menu and region panel (with payback time), and when they finish.
- Build mode: pick a building, valid regions light up green, tap to place. Progress shows on the map.

**Military**
- Six unit types: infantry, tanks, artillery, fighters, bombers and warships.
- One counter per army per region. Drag it onto a region to move or attack, or tap then tap. "🪖 All troops" selects every land unit at once.
- Units glide smoothly between regions.
- Battles show a tug-of-war bar, explosions and damage; tap a battle to see who is winning and why (terrain, forts, rivers, air support, dug-in defenders).
- Empty enemy regions are captured over a few hours. Artillery shells battles next door; ships shell coasts; planes patrol or bomb regions within range of an airbase.
- Troops sail from ports; enemy warships blockade coasts.

**Diplomacy**
- Alliances, promises not to attack, embargoes, war and peace (white peace or keeping captured land). Every option shows whether they are likely to accept.
- Alliance offers, peace offers and surrenders pop up on screen. Friendships and rivalries with your country grow over time.
- A light-hearted news feed with BREAKING banners, filters (wars, deals, money, you) and tap-to-see locations.

**Victory**
- Control half the world, finish scenario goals, or be in the top three when the era ends.

**Game modes**

| Mode | Contents |
|---|---|
| Sandbox | Modern day (2026) |
| Scenarios | World War I (1914), World War II (1939), Cold War (1962), World War III (2030), Pacific Crisis (2027), Collapse of the EU (2028), Free-for-All!, Superpower Showdown, Korean Flashpoint, Southern Showdown, Resource Gold Rush, Empires Strike Back |
| Challenges | Everyone vs You, Island Empire, Unify Africa, Survive as Taiwan, Microstate Rising, Restore the Union |
| Quick Match | Regional maps of Europe, Asia, Africa, the Americas and the Middle East, played over about 3 in-game years |

**Look and feel**
- Cartoon style: a rounded font, chunky outlined "candy" buttons that squish when tapped, bouncy panels and pop-ups.
- A bright map with ink outlines, foamy coastlines and punchy country colours.

**Mobile-friendly**
- Big touch targets, a one-thumb Play/Pause button and a speed button, and map buttons in the thumb zone (bottom right).
- Panels slide up from the bottom; swipe them down to close.
- Short vibrations when you select, give orders, build, capture land or get attacked (can be turned off).
- Local notifications when you're attacked while the app is in the background.
- Offline progress: the world moves on while the app is closed (1 real minute = 1 game day, up to 30 days), and you get a report when you return.
- Autosave and three save slots.
- A battery-saver mode.

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
npm test             # simulation tests (all scenarios, battles, buildings, embargoes, fog, saves, a 1-year world run)
npm run build        # production web build in dist/
npx cap sync android # copy the build into the Android project
cd android && ./gradlew assembleDebug   # APK at android/app/build/outputs/apk/debug/
```

To regenerate the map from Natural Earth: `npm run build:map`. It downloads the data to `scripts/.cache/` and writes `public/data/world.json`.

To regenerate the icons and splash screens: `node resources/gen.mjs`.

### Project layout

```
scripts/build-map.mjs   Natural Earth → regions, sea zones, terrain, rivers, straits
scripts/dev/            headless simulation runs and profiling
src/data/               countries, units, buildings, scenarios
src/sim/                the simulation (pure TypeScript, runs headless in tests)
  engine.ts             hourly/daily/monthly tick loop, offline catch-up, save format
  economy.ts            taxes, resource exports, embargoes, buildings, recruitment
  military.ts           movement, battles, captures, air, naval
  fog.ts                fog of war
  path.ts               A* over regions and sea zones, chokepoints
  diplomacy.ts          wars, peace, alliances, treaties, foreign aid
  ai.ts                 AI nations
  headlines.ts          fun news headline templates
  victory.ts
src/render/             canvas map renderer, WebGL globe, touch gestures
src/ui/                 Preact UI: menus, HUD, panels
android/                Capacitor Android project
```

## Credits

Map data comes from [Natural Earth](https://www.naturalearthdata.com/) (public domain). Borders and statistics are simplified for gameplay.
