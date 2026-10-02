# Sovereign: World Command

A real-time grand-strategy war game for Android. You can rule any of ~200 nations on a world map with about 1,500 real provinces and run its economy, armies, diplomacy and spy networks.

It is single-player and fully offline, with no in-game purchases.

## Features

**World map**
- About 1,500 provinces built from real states and regions (Natural Earth data), plus about 10,800 sea zones.
- Terrain: plains, forest, hills, mountains, desert, jungle, marsh and arctic.
- River crossings, narrow straits, and naval chokepoints (Suez, Panama, Bosphorus, Malacca, Hormuz and others).
- Map layers: political, terrain, resources, supply, unrest, alliances and weather.
- A rotating 3D globe view.
- Seasons and weather: winter, monsoon, tropical storms and desert heat.

**Real time**
- Speeds: pause, 1×, 2× and 5×.

**Economy**
- GDP, growth, inflation and debt; the AI can trigger credit crises.
- Tax rate plus spending sliders for military, infrastructure, research and welfare.
- Investment in four sectors: agriculture, industry, technology and services.
- Seven resources: oil, gas, steel, rare earths, uranium, food and electronics.
- A global market with supply-and-demand prices.
- Sanctions, resource embargoes, tariff wars and asset freezes.
- Blockades and submarine raids on trade.
- A war-economy toggle.

**Military**
- Land units: infantry, armor, artillery, special forces, air defense and missile batteries.
- Air units: fighters, bombers, drones and airlift. Missions: air superiority, close air support, bombing, recon and airlift.
- Naval units: carriers, battleships, destroyers, submarines and amphibious groups. Missions: patrol, blockade, shore bombardment and shipping raids.
- Amphibious invasions.
- Supply lines, depots and airlift; units take attrition when out of supply.
- Encirclement forces surrenders.
- Generals with traits.
- Conscription laws.
- Fog of war, cleared by spies, satellites and recon.

**Controls**
- Tap a unit counter to select it, then tap a province to move or attack.
- Long-press a province for more orders.
- Drag across provinces to draw a front line, then choose hold or advance.
- Orders can be queued.

**Nuclear weapons**
- Arm and launch warheads, with ICBMs or bomber, missile and submarine delivery.
- Missile shields can intercept.
- A strike leaves fallout, crashes world markets, causes global outrage and can trigger retaliation.
- A DEFCON meter tracks world tension.
- Nukes can be switched off for a game.

**Politics**
- Government types: democracy, authoritarian, monarchy, communist and theocracy.
- Approval, stability, war support and war weariness.
- Democracies hold elections. Authoritarian governments face coups, which you can purge.
- Provincial unrest, rebels and separatist uprisings.
- Propaganda.
- Advisors can automate any area of government.

**Diplomacy**
- Alliances (blocs), non-aggression pacts, trade deals, military access, independence guarantees, foreign aid, vassals and territorial demands.
- Peace deals: white peace, ceding territory, reparations, vassalization or annexation.
- Allies can betray you.
- Aggressive conquest builds "infamy", which makes coalitions form against you.
- An inbox of messages from AI leaders.

**UN / world council**
- Resolutions: condemnations, sanctions, peacekeeping, disarmament and aid.
- Permanent members can veto.
- Secretary-General elections.

**Research**
- About 60 technologies, from 1905 dreadnoughts to 2045 fusion and Mars colonization.
- Includes cyber warfare, hypersonic missiles, AI drone swarms, railguns and missile shields.

**Espionage**
- Intel gathering, sabotage, technology theft, election interference, assassination, inciting unrest and propaganda.
- Cyber attacks on power grids, banks and radar.

**World events**
- Pandemics, earthquakes, financial crashes, refugee crises, famines, economic booms and resource discoveries.

**Media**
- A live news ticker and a public-opinion social feed.

**Victory conditions**
- Military, economic, diplomatic, technology or survival victory.
- The end screen shows a timelapse replay of borders over the whole game.

**Game modes**

| Mode | Contents |
|---|---|
| Sandbox | Modern day (2026) |
| Scenarios | World War I (1914), World War II (1939), Cold War (1962), World War III (2030), Pacific Crisis (2027), Collapse of the EU (2028) |
| Challenges | Unify Africa, Survive as Taiwan, Microstate Rising, Restore the Union |
| Quick Match | Regional maps of Europe, Asia, Africa, the Americas and the Middle East, played over about 3 in-game years |

**Mobile-friendly**
- Local notifications when you're attacked while the app is in the background.
- Offline progress: your advisors run the country while the app is closed (1 real minute = 1 game day, up to 30 days), and you get a report when you return.
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
npm test             # simulation tests (all scenarios, combat, nukes, saves, a 1-year world run)
npm run build        # production web build in dist/
npx cap sync android # copy the build into the Android project
cd android && ./gradlew assembleDebug   # APK at android/app/build/outputs/apk/debug/
```

To regenerate the map from Natural Earth: `npm run build:map`. It downloads the data to `scripts/.cache/` and writes `public/data/world.json`.

To regenerate the icons and splash screens: `node resources/gen.mjs`.

### Project layout

```
scripts/build-map.mjs   Natural Earth → provinces, sea zones, terrain, rivers, straits
src/data/               countries, units, technologies, scenarios, names
src/sim/                the simulation (pure TypeScript, runs headless in tests)
  engine.ts             hourly/daily/monthly tick loop, offline catch-up, save format
  economy.ts            budgets, resources, world market, production
  military.ts           movement, land/air/naval combat, supply, missiles
  path.ts               A* over provinces and sea zones, chokepoints
  diplomacy.ts          wars, peace, alliances, treaties, sanctions
  ai.ts                 AI nations and the player's advisors
  politics.ts, un.ts, tech.ts, covert.ts, nuclear.ts, events.ts, weather.ts, victory.ts
src/render/             canvas map renderer, globe, touch gestures
src/ui/                 Preact UI: menus, HUD, panels
android/                Capacitor Android project
```

## Credits

Map data comes from [Natural Earth](https://www.naturalearthdata.com/) (public domain). Borders and statistics are simplified for gameplay.
