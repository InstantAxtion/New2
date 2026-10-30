# Endless Drive

A relaxing driving game for Android. Pick a car and cruise an endless, generated world, or let it drive itself while you watch the scenery. Paste a Spotify playlist and listen while you drive.

## Features

**Endless world**
- The road never ends: it is generated as you drive, with long sweeping bends, hills and dips.
- 8 themes, blended smoothly into each other every ~1.4 km:
  🌊 Seaside (beaches, palms, sailboats, lighthouses) · ⛰️ Rolling Hills (sheep, farmhouses, wind turbines) · 🌾 Flatlands (patchwork fields, barns, windmills, hay bales) · 🏜️ Desert (dunes, cacti, red mesas) · 🌲 Forest · 🏔️ Alpine (big peaks, snow caps, cabins) · 🍂 Autumn Valley · ❄️ Winter (snowy pines, snowmen)
- Pick one theme, a few, or all of them. 🎲 New road gives you a different world.
- Time of day: a full day/night cycle (16 minutes), or fixed dawn, day, sunset or night. Stars and a moon at night, headlights, drifting clouds.
- Light oncoming traffic (can be turned off).

**Cars**
8 cars, each with its own top speed, acceleration and grip, and 13 paint colours: Sprint GT, City Hatch, Trail SUV, Ranch Pickup, Breeze Roadster (open top), Weekender Van, Thunder Muscle, Retro Bubble.

**Driving**
- 🕹️ *I drive*: ◀ ▶ buttons or tilt-to-steer, gas and brake (hold brake when stopped to reverse). Lane assist keeps you in lane when you let go of the steering.
- 🤖 *Auto-drive*: the car keeps its lane and slows for bends. Set the cruise speed with − / +, and swap lanes with ⇆.
- Switch between the two at any time.
- Cameras: Chase, High, Driver, Side and Cinematic (it cuts between roadside, drone, aerial, low and orbit shots). Drag the screen to look around.
- 👁️ hides all the controls to just watch the scenery (switches on auto-drive). Tap to bring them back.

**Music**
- Tap 🎵, paste a Spotify link (playlist, album, track, artist or podcast) and press Play. Your recent playlists are remembered.
- The built-in Spotify player plays previews unless you're logged in to Spotify inside it. For full songs, tap **Open in Spotify app**, start the music there, and come back: it keeps playing while you drive.
- How to get the link: in Spotify open the playlist → ⋯ → Share → Copy link.

**Other**
- Engine and wind sound (volume in Settings), km/h or mph, Low/Medium/High graphics (drops automatically if your phone struggles).
- Keeps the screen on and runs full-screen. Works in landscape and portrait.
- Keyboard in the browser: arrows/WASD to drive, Space for auto-drive, C camera, H hide controls, M music.

## Install on Android

Every push builds a debug APK in GitHub Actions:

1. Open the **Releases** section (the "Latest APK build" pre-release), or the **Actions** tab → latest **Build & test** run → **endless-drive-apk** artifact.
2. Download the `.apk` on your phone and open it. You may need to allow "install unknown apps".

## Development

Requirements: Node 22+. Building the APK also needs JDK 21 and the Android SDK.

```bash
npm install
npm run dev          # play in the browser at http://localhost:5173
npm test             # world generation, autopilot and Spotify link tests
npm run build        # production web build in dist/
npx cap sync android # copy the build into the Android project
cd android && ./gradlew assembleDebug   # APK at android/app/build/outputs/apk/debug/
```

Icons and splash screens: `python3 resources/make_icons.py` (needs Pillow).

Code map: `src/world/` (noise, themes, road and terrain maths), `src/chunks.ts` (terrain, road and scenery meshes), `src/props.ts` (low-poly scenery models), `src/cars.ts`, `src/drive.ts` (car physics and autopilot), `src/camera.ts`, `src/sky.ts` (sky, sun, day/night), `src/spotify.ts`, `src/ui.ts`, `src/game.ts`.
