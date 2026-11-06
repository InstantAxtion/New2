# Endless Drive

A relaxing driving game for Android. Pick a car and cruise an endless, generated world — or let it drive itself while you watch the scenery, listen to your Spotify playlist or the radio, or watch music videos on the car's dashboard screen. No goals, no scores: just driving.

## The world
- An endless road through 15 regions that blend into each other: 🌊 Seaside · ⛰️ Rolling Hills · 🌾 Flatlands · 🏜️ Desert · 🌲 Forest · 🏔️ Alpine · 🍂 Autumn Valley · ❄️ Winter · 🌃 Neon City (always night: lit towers, neon billboards, street lamps) · 🌴 Rainforest (jungle, ferns, mist) · 🌉 Lakes & Bridges · 🪨 Canyon (red rock walls, hoodoos, arches, bridges over gorges) · 🌸 Spring Blossom (cherry trees, tulip fields, petals on the wind) · 🏝️ Tropical Islands (causeways between islands, turquoise water) · 🍇 Vineyards & Lavender (rows of vines, purple fields, cypresses, stone farmhouses). A title card welcomes you to each one.
- Roads: four-lane highways with a central barrier, tunnels through mountain ridges, alpine hairpins, gravel roads that throw up dust, clifftop roads above the sea, great suspension bridges (lit at night), and cobbled old towns with stone gatehouses.
- Landmarks: hilltop castles, abbey ruins and waterfalls. Town windows glow at night; a drive-in cinema shows a film after dark; sailing boats out on the water.
- Seasons: each region's own look, or the whole world in spring, summer, autumn or winter (Settings).
- Places to stop: ⛽ fuel and EV charging stations, 🍔 roadside diners, 📷 scenic viewpoints, 🏕️ campsites (with a campfire at night) and ⚓ harbours with a pier and boats. Road signs announce them, along with town names, speed limits, bends, deer and tunnels.
- Life: cows, horses, sheep and deer grazing (and deer crossing the road — auto-drive stops for them), flocks of birds, geese in a V, gulls by the sea, eagles over the peaks, dolphins and whales offshore, fireflies, bats and owls at night, planes with contrails, hot-air balloons.
- Sky: the Milky Way and shooting stars, northern lights over the snow, rainbows when a shower clears.
- Small towns now and then in the countryside: houses and shops, street lamps, zebra crossings with people walking over, 30 mph (the city is 40 mph).
- Pick one region, several, or all. 🎲 gives you a new road.
- Time of day: a full day/night cycle or fixed dawn, day, sunset or night.
- Weather: clear, rain (wet shiny roads with puddles, street lights reflected at night, spray from traffic, wipers), thunderstorms (lightning and thunder), snow (it settles on the ground), fog, hail or sleet; desert sandstorms; wind in the trees with leaves and petals blowing; heat haze on hot afternoons.
- Traffic: cars, campervans, lorries, coaches and motorbikes, oncoming and in your lane; density slider from empty to busy.

## Cars
20 vehicles, each with its own speed, acceleration, grip, handling (body roll, dive, steering), engine sound and interior: Sprint GT, City Hatch, Trail SUV, Ranch Pickup, Breeze Roadster, Weekender Van, Thunder Muscle, Retro Bubble, Coastline '64, Volt Hatch (electric), Ridge Off-Roader, Tourer Estate, Apex V12, Strada Veloce, Halo Hyper (scissor doors), Starliner '57, Riviera Spider '62, Wanderer Camper (the roof pops up when you stop), Nomad Overlander (roof tent) — and the Horizon Tourer motorbike, which leans into the bends, with a rider's view over the bars.

**🎨 Customise** (per car), in a lit showroom with a turntable: paint colour and finish (metallic, gloss, matte, pearl), two-tone roof, racing stripes, decals (race number, flames, stripe, stars), your own number plate, rim style and colour, ride height, seat leather, trim (piano black, wood, carbon, aluminium), and ambient lighting at night. Open the doors, bonnet (engine bay or front boot) and boot to have a look.

**Fuel**: a tank (or battery) lasts about 75 miles. Stop at a fuel or charging station to fill up; on auto-drive the car pulls in by itself when it's low.

**Driver's seat** (📺 or the camera button): a cockpit shaped to the car — sport, comfort, luxury, classic (round dials, thin wheel), EV (tablet screen, yoke, glass roof), utility or van. Gauges show your speed; the rear-view and side mirrors work; the dash screen shows a live map of the road ahead (next region, towns, speed limit) or your music video. Wind the 🪟 windows down, open the ☀️ sunroof, or put the roadster's roof up. Drag to look right round the cabin. There's an air freshener swinging from the mirror, a phone on a mount, a coffee in the cup holder, sun visors (🕶️) and, on modern cars, a head-up display on the glass. Rain beads on the windscreen and the paint until the wipers sweep it away (snow settles on the roof; leaves, petals and the odd bug land on the glass); in the cold and wet the glass mists up (🌬️ demister); the dash glows at night.

## Driving
- 🕹️ **Drive yourself**: ◀ ▶ or tilt to steer, gas and brake (hold brake to reverse), lane assist.
- 🤖 **Auto-drive** (the button beside Drive in the garage, or AUTO while driving): keeps its lane, slows for bends and towns, follows slower traffic and overtakes when the road is straight and clear, and stops for people on crossings. Styles: 🌿 Relaxed, 🚗 Normal, 🏁 Sporty. Set the cruise speed with − / +.
- 🌙 **Sleep timer** (30/60/90 min): auto-drive pulls over and stops, and the music fades out.
- Two cameras: 3rd person (behind the car) and 1st person (the driver's seat). Drag to look around — the view stays where you leave it; double-tap to look straight ahead again. 👁️ hides the controls.
- mph by default (km/h in Settings).

## Music
- 🎧 **Spotify**: paste a playlist/album/song link. **Log in to Spotify** in the music panel for full songs (email and password; Google/Facebook sign-in doesn't work inside apps), or open it in the Spotify app.
- 📺 **Music videos**: paste a Spotify playlist and each song plays as its official music video (or best lyric video), full length, on the dashboard screen or as a small corner video. Uses the YouTube Data API: a key can be built in (`VITE_YOUTUBE_KEY` in a git-ignored `.env.local`, or the `YOUTUBE_API_KEY` GitHub secret for CI builds), or pasted in Settings. YouTube links and playlists work without a key.
- 🔀 Shuffle, 🔁 repeat all or 🔂 one, and 🎤 synced lyrics on screen (from LRCLIB) with music videos.
- 🎙️ **Podcasts**: search any show and stream its episodes (skip, speed).
- 📻 **Radio**: 27 free, listener-supported SomaFM stations — chill, pop & rock, electronic, folk & country, jazz & lounge, ambient.
- The dash screen can show a music visualizer instead of the map (Settings).
- The engine and ambient sounds get quieter while music plays.

## Sound
Each engine sounds different (V8, V12, flat-six, four- and six-cylinder, diesel, flat-four, electric) with gear changes, a starter and door thunk when you set off, and pops and crackles from sporty exhausts; tyres hum on asphalt, hiss in the wet and crunch on gravel; rain drums on the roof; traffic whooshes past; and the place you're in — waves, birds, jungle insects, mountain wind, city hum, crickets at night, rain and thunder. Shut windows muffle the outside.

## 📊 Trips
This trip, all-time distance and time, longest trip, top speed, and distance by region and by car. A resettable trip meter, compass and altitude on the HUD (or a minimal HUD). The game remembers where you stopped — **📍 Places → Continue** — and you can ☆ save favourite places to come back to. A 🛂 passport collects a stamp for every region, landmark, stop and sight you find, and a 📔 journey log keeps each trip with its route map.

## Graphics
Photo-real ground, road, cobble and pavement textures and photo-scanned boulders (CC0, Poly Haven), recorded rain, birdsong, crickets, wind and waves (CC0, OpenGameArt), trees made of leaf and needle cards that sway in the wind, physically based lighting with sky reflections, shadows, filmic tone mapping, bloom, sun shafts and a lens flare. Ultra, High (default), Medium or Low, with resolution that adapts to keep it smooth; a sound mixer, and a reduce-motion option; it steps down automatically if the phone can't keep up. Landscape or vertical (Settings → Screen).

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

Icons and splash: `python3 resources/make_icons.py`. Credits: `public/textures/CREDITS.md`, `public/models/CREDITS.md`, `public/impostors/CREDITS.md`, `public/sounds/CREDITS.md`.

Code map: `src/world/` (regions, road, terrain, towns, bridges), `src/chunks.ts` (terrain, road, bridges, scenery), `src/foliage.ts`, `src/props.ts`, `src/special.ts` (city), `src/carspecs.ts` + `src/carbody.ts` + `src/carparts.ts` + `src/cockpit.ts` + `src/cars.ts` (cars), `src/drive.ts` (physics, auto-drive), `src/traffic.ts` + `src/vehicles.ts`, `src/peds.ts`, `src/weather.ts`, `src/sky.ts`, `src/audio.ts`, `src/map.ts`, `src/music.ts` + `src/youtube.ts` + `src/video.ts` + `src/tracks.ts`, `src/radio.ts`, `src/stats.ts`, `src/ui.ts`, `src/game.ts`.
