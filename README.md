# Endless Drive

A relaxing driving game for Android. Pick a car and cruise an endless, generated world — or let it drive itself while you watch the scenery, listen to your Spotify playlist or the radio, or watch music videos on the car's dashboard screen. No goals, no scores: just driving.

## The world
- An endless road through 12 regions that blend into each other: 🌊 Seaside · ⛰️ Rolling Hills · 🌾 Flatlands · 🏜️ Desert · 🌲 Forest · 🏔️ Alpine · 🍂 Autumn Valley · ❄️ Winter · 🌃 Neon City (always night: lit towers, neon billboards, street lamps) · 🌴 Rainforest (jungle, ferns, mist) · 🌉 Lakes & Bridges · 🪨 Canyon (red rock walls, hoodoos, arches, bridges over gorges).
- Small towns now and then in the countryside: houses and shops, street lamps, zebra crossings with people walking over, 30 mph (the city is 40 mph).
- Pick one region, several, or all. 🎲 gives you a new road.
- Time of day: a full day/night cycle or fixed dawn, day, sunset or night.
- Weather: clear, rain (wet shiny roads, wipers), thunderstorms (lightning and thunder), snow (it settles on the ground) or fog.
- Traffic: cars, campervans, lorries, coaches and motorbikes, oncoming and in your lane; density slider from empty to busy.

## Cars
13 cars, each with its own speed, acceleration, grip, handling (body roll, dive, steering), engine sound and interior: Sprint GT, City Hatch, Trail SUV, Ranch Pickup, Breeze Roadster, Weekender Van, Thunder Muscle, Retro Bubble, Coastline '64, Volt Hatch (electric), Ridge Off-Roader, Tourer Estate, Apex V12.

**🎨 Customise** (per car): paint colour and finish (metallic, gloss, matte, pearl), two-tone roof, racing stripes, rim style and colour, ride height, seat leather, trim (piano black, wood, carbon, aluminium), and ambient lighting at night.

**Driver's seat** (📺 or the camera button): a cockpit shaped to the car — sport, comfort, luxury, classic (round dials, thin wheel), EV (tablet screen, yoke, glass roof), utility or van. Gauges show your speed; the rear-view and side mirrors work; the dash screen shows a live map of the road ahead (next region, towns, speed limit) or your music video. Wind the 🪟 windows down, open the ☀️ sunroof, or put the roadster's roof up.

## Driving
- 🕹️ **Drive yourself**: ◀ ▶ or tilt to steer, gas and brake (hold brake to reverse), lane assist.
- 🤖 **Auto-drive** (the button beside Drive in the garage, or AUTO while driving): keeps its lane, slows for bends and towns, follows slower traffic and overtakes when the road is straight and clear, and stops for people on crossings. Styles: 🌿 Relaxed, 🚗 Normal, 🏁 Sporty. Set the cruise speed with − / +.
- 🌙 **Sleep timer** (30/60/90 min): auto-drive pulls over and stops, and the music fades out.
- Cameras: Chase, High, Driver, Side, Cinematic. Drag to look around. 👁️ hides the controls.
- mph by default (km/h in Settings).

## Music
- 🎧 **Spotify**: paste a playlist/album/song link. **Log in to Spotify** in the music panel for full songs (email and password; Google/Facebook sign-in doesn't work inside apps), or open it in the Spotify app.
- 📺 **Music videos**: paste a Spotify playlist and each song plays as its official music video (or best lyric video), full length, on the dashboard screen or as a small corner video. Uses the YouTube Data API: a key can be built in (`VITE_YOUTUBE_KEY` in a git-ignored `.env.local`, or the `YOUTUBE_API_KEY` GitHub secret for CI builds), or pasted in Settings. YouTube links and playlists work without a key.
- 📻 **Radio**: free, listener-supported SomaFM stations.
- The engine and ambient sounds get quieter while music plays.

## Sound
Each engine sounds different (V8, V12, flat-six, four- and six-cylinder, diesel, flat-four, electric) with gear changes; wind; and the place you're in — waves, birds, jungle insects, mountain wind, city hum, crickets at night, rain and thunder. Shut windows muffle the outside.

## 📊 Trips
This trip, all-time distance and time, longest trip, top speed, and distance by region and by car.

## Graphics
Photo-real ground and road textures (CC0, Poly Haven), trees made of leaf and needle cards that sway, physically based lighting with sky reflections, shadows, filmic tone mapping and bloom. High (default), Medium or Low; it steps down automatically if the phone can't keep up. Landscape or vertical (Settings → Screen).

## Install on Android
Every push builds a debug APK in GitHub Actions: open **Releases** ("Latest APK build") or **Actions** → **Build & test** → **endless-drive-apk**. Open the `.apk` on your phone (allow "install unknown apps").

## Development
Node 22+; the APK also needs JDK 21 and the Android SDK.

```bash
npm install
npm run dev          # play in the browser at http://localhost:5173
npm test             # world, auto-drive, music and projection tests
npm run build && npx cap sync android && (cd android && ./gradlew assembleDebug)
```

Icons and splash: `python3 resources/make_icons.py`. Textures: `public/textures/CREDITS.md`.

Code map: `src/world/` (regions, road, terrain, towns, bridges), `src/chunks.ts` (terrain, road, bridges, scenery), `src/foliage.ts`, `src/props.ts`, `src/special.ts` (city), `src/carspecs.ts` + `src/carbody.ts` + `src/carparts.ts` + `src/cockpit.ts` + `src/cars.ts` (cars), `src/drive.ts` (physics, auto-drive), `src/traffic.ts` + `src/vehicles.ts`, `src/peds.ts`, `src/weather.ts`, `src/sky.ts`, `src/audio.ts`, `src/map.ts`, `src/music.ts` + `src/youtube.ts` + `src/video.ts` + `src/tracks.ts`, `src/radio.ts`, `src/stats.ts`, `src/ui.ts`, `src/game.ts`.
