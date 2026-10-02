# Sovereign: World Command

A real-time war game for Android. Pick any of ~200 countries on a world map, build up its economy and army, and take on the world.

It is single-player and fully offline, with no in-game purchases.

## Features

**World map**
- About 470 broad regions built from real states (Natural Earth data), named after their main city, plus a grid of sea zones.
- Terrain (plains, forest, hills, mountains, desert, jungle, marsh, arctic) affects movement and defence.
- River crossings, narrow straits and naval chokepoints (Suez, Panama, Bosphorus, Malacca, Hormuz...).
- Map views: countries, terrain, resources and alliances, plus a rotating 3D globe.
- Fog of war: you only see enemy troops and buildings near your own land and units.

**Economy (kept simple)**
- Money comes from the regions you control; every unit costs upkeep.
- Three resources: ⛏ materials (from every region, more with mines), 💥 ammunition (from factories, used up in battle) and ☢ uranium (mined in a few regions, used for warheads).
- A world market to buy and sell resources.

**Buildings**
- Mine, factory, barracks, airbase, port, fort and nuclear facility, several with up to three levels.
- Build mode: pick a building, valid regions light up green, tap to place. Progress shows on the map.

**Military**
- Infantry, tanks, artillery, anti-air, fighters, bombers, warships, submarines and aircraft carriers.
- One counter per army per region. Drag it onto a region to move or attack, or tap then tap.
- Battles show a tug-of-war bar, explosions and damage; tap a battle to see who is winning and why (terrain, forts, rivers, air support, ammo).
- Empty enemy regions are captured over a few hours. Artillery shells battles next door; ships shell coasts; planes patrol or bomb regions within range of an airbase.
- Troops sail from ports; enemy warships blockade coasts.
- Nuclear weapons (optional).

**Diplomacy**
- Alliances, promises not to attack, trade deals, war and peace (white peace or keeping captured land). Every option shows whether they are likely to accept.

**Victory**
- Control half the world, finish scenario goals, or be in the top three when the era ends.

**Game modes**

| Mode | Contents |
|---|---|
| Sandbox | Modern day (2026) |
| Scenarios | World War I (1914), World War II (1939), Cold War (1962), World War III (2030), Pacific Crisis (2027), Collapse of the EU (2028) |
| Challenges | Unify Africa, Survive as Taiwan, Microstate Rising, Restore the Union |
| Quick Match | Regional maps of Europe, Asia, Africa, the Americas and the Middle East, played over about 3 in-game years |

**Mobile-friendly**
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
npm test             # simulation tests (all scenarios, battles, buildings, fog, nukes, saves, a 1-year world run)
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
  economy.ts            money, resources, market, buildings, recruitment
  military.ts           movement, battles, captures, air, naval, ammo supply
  fog.ts                fog of war
  path.ts               A* over regions and sea zones, chokepoints
  diplomacy.ts          wars, peace, alliances, treaties
  ai.ts                 AI nations
  nuclear.ts, victory.ts
src/render/             canvas map renderer, WebGL globe, touch gestures
src/ui/                 Preact UI: menus, HUD, panels
android/                Capacitor Android project
```

## Credits

Map data comes from [Natural Earth](https://www.naturalearthdata.com/) (public domain). Borders and statistics are simplified for gameplay.
