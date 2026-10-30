# Endless Drive

A relaxing driving game for Android. Pick a car and cruise an endless, generated world, or let it drive itself while you watch the scenery. Paste a Spotify playlist and listen while you drive — or watch each song's music video on the car's dashboard screen.

## Features

**Endless world**
- The road never ends: it is generated as you drive, with long sweeping bends, hills and dips.
- 8 themes, blended smoothly into each other every ~1.4 km:
  🌊 Seaside (beaches, palms, sailboats, lighthouses) · ⛰️ Rolling Hills (sheep, farmhouses, wind turbines) · 🌾 Flatlands (patchwork fields, barns, windmills, hay bales) · 🏜️ Desert (dunes, cacti, red mesas) · 🌲 Forest · 🏔️ Alpine (big peaks, snow caps, cabins) · 🍂 Autumn Valley · ❄️ Winter (snowy pines, snowmen)
- Pick one theme, a few, or all of them. 🎲 New road gives you a different world.
- Time of day: a full day/night cycle (16 minutes), or fixed dawn, day, sunset or night. Stars and a moon at night, headlights, drifting clouds.
- Light oncoming traffic (can be turned off).

**Graphics**
- Photo-real ground: real grass, dry grass, forest-floor leaves, sand, rock and snow textures (CC0, Poly Haven), blended per region and steered by its colours; rock appears on steep slopes.
- Real asphalt with painted, worn lines and a bumpy surface.
- Trees made of bark-textured trunks and hundreds of leaf and needle cards that sway in the wind; palms with arching fronds; snow-laden firs.
- Cars with smooth curved bodies, wheel arches, glass cabins, alloy rims, brake discs and callipers, and glossy clear-coat paint that reflects the sky.
- Physically based lighting, a live sky (sun, moon, stars, two cloud layers) reflected in paint and water, real-time shadows, filmic tone mapping, and bloom on High.
- Graphics: **High** (default), Medium or Low; it steps down automatically if the phone can't keep up.

**Cars**
8 cars, each with its own top speed, acceleration and grip, and 13 paint colours: Sprint GT, City Hatch, Trail SUV, Ranch Pickup, Breeze Roadster (open top), Weekender Van, Thunder Muscle, Retro Bubble. Each has a cockpit with a steering wheel and a dashboard screen in the Driver view.

**Driving**
- 🕹️ *I drive*: ◀ ▶ buttons or tilt-to-steer, gas and brake (hold brake when stopped to reverse). Lane assist keeps you in lane when you let go of the steering.
- 🤖 *Auto-drive*: the car keeps its lane and slows for bends. Set the cruise speed with − / +, and swap lanes with ⇆.
- Switch between the two at any time.
- Cameras: Chase, High, Driver (from the driver's seat), Side and Cinematic (it cuts between roadside, drone, aerial, low and orbit shots). Drag the screen to look around.
- 👁️ hides all the controls to just watch the scenery (switches on auto-drive). Tap to bring them back.

**Music videos on the dashboard**
- Tap 🎵 → **📺 Music videos**, then paste a Spotify playlist, album or song link. The game reads the songs and, for each one, finds the official music video (or the best lyric video, if you prefer that in Settings) and plays it with sound, full length, one after another.
- Tap 📺 to jump into the driver's seat: the video plays on the car's dashboard screen. In the other cameras it shows as a small picture in the corner (can be turned off).
- ⏮ ⏯ ⏭, **🔁 Other video** if it picked the wrong one, or paste your own YouTube link for a song — your choices are remembered.
- You can also paste a YouTube playlist or video link directly.
- Finding videos automatically uses the official YouTube Data API. The app can have a key built in at build time (`VITE_YOUTUBE_KEY` in a git-ignored `.env.local`, or the `YOUTUBE_API_KEY` repository secret for GitHub Actions builds), or you can paste a **free API key** of your own: go to console.cloud.google.com → create a project → enable *YouTube Data API v3* → Credentials → Create API key, then paste it in ⚙️ Settings → Music videos. That gives about 100 new songs a day; songs you've played before are remembered and don't count. Without a key, YouTube links still work.
- Some videos aren't allowed to play outside YouTube; the game then tries the next-best video.

**Music (Spotify player)**
- Tap 🎵, paste a Spotify link (playlist, album, track, artist or podcast) and press Play. Your recent playlists are remembered.
- Tap **Log in to Spotify** in the music panel (in the app) to log in once; the player then plays full songs instead of 30-second previews. Use email and password or "Log in without password" (Google/Facebook sign-in doesn't work inside apps). The player's own "Log in" button opens the same in-app login.
- Or tap **Open in Spotify app**, start the music there, and come back: it keeps playing while you drive.
- How to get the link: in Spotify open the playlist → ⋯ → Share → Copy link.

**Quick settings**
- Time of day and traffic can be changed any time: in the garage, in the pause menu (⏸) and in Settings.

**Vertical mode**
- Plays in portrait as well as landscape. Settings → Screen: auto-rotate, always landscape or always vertical.

**Other**
- Engine and wind sound (volume in Settings), km/h or mph.
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

Icons and splash screens: `python3 resources/make_icons.py` (needs Pillow). Ground, asphalt and bark textures are CC0 from Poly Haven (see `public/textures/CREDITS.md`).

Code map: `src/world/` (noise, themes, road and terrain maths), `src/chunks.ts` (terrain, road, grass and scenery meshes), `src/materials.ts` (ground texture blending, wind), `src/foliage.ts` (trees), `src/props.ts` (buildings and other scenery), `src/carbody.ts` + `src/cars.ts` (car bodies, wheels, cockpit), `src/music.ts` + `src/youtube.ts` + `src/video.ts` + `src/tracks.ts` (music videos), `src/drive.ts` (car physics and autopilot), `src/camera.ts`, `src/sky.ts` (sky, sun, day/night), `src/spotify.ts`, `src/ui.ts`, `src/game.ts`.
