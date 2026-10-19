# Rot & Rust

A browser-based 3D survival game that mixes:

- **Rust**: the gather → craft → build loop. Hit trees and rocks for resources, smelt ore in a furnace, build a base from foundations, walls, doorways, windows, floors and stairs, then upgrade it twig → wood → stone → sheet metal.
- **Project Zomboid**: the zombie apocalypse simulation. Zombies hear noise (gunshots carry ~75–140 m, sprinting and chopping are loud, crouching is quiet) and see you (a flashlight gives you away at night). They bash through your walls and doors. Nightly hordes get bigger every day. You get moodles like Hungry, Bleeding, Panicked and Queasy, and any hit can carry an infection with no cure.
- **Escape from Tarkov**: the gunplay. Bullets are real projectiles with travel time and drop. You have recoil you must control, ADS with a FOV zoom, and hit zones (head, thorax, stomach, legs; leg hits make zombies crawl). Reloads are manual and use ammo from your inventory, shotgun shells load one at a time, there is no ammo counter (press **T** to check your mag), and auto weapons have a fire-mode toggle.

Everything runs in the browser with [three.js](https://threejs.org) and no build step. All art and sound are generated procedurally at runtime.

## Running it

ES modules won't load from `file://`, so serve the folder over HTTP:

```bash
npx http-server -p 8080 .      # or: python3 -m http.server 8080
```

Then open http://localhost:8080. It works on any static host (GitHub Pages, Netlify, etc.) as-is.

## Controls

| Key | Action |
| --- | --- |
| WASD / Shift / Ctrl or C / Space | Move / sprint / crouch / jump |
| Mouse, LMB, RMB | Look, attack/use/place, aim down sights |
| 1–6, mouse wheel | Select belt slot |
| Tab or I | Inventory and crafting |
| E | Interact: loot, open doors, pick hemp, drink water, search corpses |
| R | Reload (guns), cycle building piece (building plan) |
| T | Check magazine |
| B | Toggle fire mode (auto weapons) |
| F | Flashlight |
| M | Map (mouse wheel to zoom, M or Esc to close) |
| Hammer: LMB / RMB / X twice | Repair / upgrade / demolish |
| Esc | Pause menu (save, settings) |

Inventory: drag to move, Shift+click to quick-move, Ctrl+drag to split a stack, right-click to use or unload, drag outside the panels to drop.

### Controller

Any standard gamepad works (Xbox, PlayStation, Switch Pro and others the browser recognizes). Plug it in and press a button. Prompts switch to controller buttons automatically, and you can switch back to mouse and keyboard at any time.

| Button | Action |
| --- | --- |
| Left stick / L3 | Move (analog) / sprint toggle |
| Right stick / R3 | Look / fire mode |
| RT / LT | Attack, use or place / aim down sights (upgrade with the hammer, cycle piece with the building plan) |
| A / B | Jump / crouch toggle |
| X | Interact. Hold it, or tap it when there's nothing to interact with, to reload |
| Y | Inventory and crafting |
| View | Map (RB / LB zoom in / out) |
| LB / RB | Previous / next belt slot |
| D-pad ↑ ↓ ← → | Flashlight / check mag / demolish / reload or cycle building piece |
| Menu | Pause |

In menus and the inventory, a cursor appears. The left stick moves it, the D-pad snaps it between buttons and slots, and A selects, picks up or drops. X quick-moves an item (or crafts 5), Y uses or unloads an item, LT+A splits a stack, LB/RB switch crafting tabs, the right stick scrolls, and B goes back. D-pad left/right adjusts sliders. Look sensitivity and invert Y are in Settings. Firing and taking hits trigger rumble, and look speed slows slightly while your sights are over a zombie.

## The loop

1. Wake up on a beach with a rock. Hit trees for **wood** and rocks for **stone**, **metal ore** (brown) and **sulfur ore** (yellow). Pick **hemp** (E) for cloth.
2. Craft a hatchet and pickaxe, then a **building plan**. Place foundations, walls, a doorway with a door, and floors. Upgrade with the **hammer**.
3. Build a **furnace**, load it with wood and ore, and light it to get metal fragments, sulfur and charcoal. Turn those into gunpowder and ammo.
4. Loot the **town** (kitchen cabinets, fridges, wardrobes, car wrecks) and the **military checkpoint** (weapon crates) for guns, ammo and medical supplies. Break **barrels** for scrap.
5. Use the **map** (M) to find the town, the checkpoint, your base and your backpack after a death. Survive the nights. Raise your foundations (zombies can't climb them), upgrade your walls, and keep a sleeping bag down as a respawn point. When you die, your backpack stays where you fell.

The game autosaves every 60 seconds to `localStorage`. Use **Continue** on the title screen to resume.

## Code layout

| File | Purpose |
| --- | --- |
| `src/main.js` | Game bootstrap, main loop, input, interaction, death/respawn, save/load, objectives |
| `src/world.js` | Island terrain (heightfield), town and military generation, resource nodes, loot spots |
| `src/env.js` | Day/night cycle, sun/moon, fog, stars |
| `src/physics.js` | AABB colliders in a spatial hash, terrain-aware raycasts, cylinder movement resolution |
| `src/player.js` | First-person movement, stamina, hunger/thirst, bleeding, infection |
| `src/combat.js` | Held items: ballistic guns, recoil, ADS, reloads, melee and gathering, consumables, building/hammer input |
| `src/viewmodel.js` | Procedural first-person weapon/tool models and animation |
| `src/zombies.js` | Zombie spawning, senses (sight and hearing), AI states, base bashing, hit zones, hordes |
| `src/building.js` | Grid building system, stability/collapse, upgrades, doors, deployables (box, furnace, campfire, sleeping bag) |
| `src/items.js` | Item definitions, crafting recipes, loot tables |
| `src/inventory.js`, `src/crafting.js` | Containers and the crafting queue |
| `src/ui.js`, `index.html`, `style.css` | HUD, moodles, inventory drag-and-drop, crafting UI, menus |
| `src/audio.js` | WebAudio-synthesized sound effects |
| `src/map.js` | Island map: terrain render, grid, base/bag/backpack markers |
| `src/devconsole.js` | Dev console, cheats, stats overlay and debug visualisations |
| `src/gamepad.js` | Controller polling, gameplay mapping, rumble, aim slowdown, and the menu/inventory cursor |
| `vendor/three.module.min.js` | three.js r170 (MIT, see `vendor/THREE_LICENSE`) |

## Dev console

Press **`** (backquote) or **F8** to open the developer console, and **F3** to toggle the live stats overlay (FPS, frame/update/render time, draw calls, position and zone, survival stats, zombie counts by AI state, base pieces by tier, input device, and active cheats). Tab autocompletes commands, item ids and teleport targets. ↑/↓ scroll through command history (kept between sessions). Separate several commands with `;`. Errors and warnings are captured into the console, and a red badge appears when new ones arrive while it's closed.

| Group | Commands |
| --- | --- |
| Player | `god`, `noclip`, `speed <x>`, `heal`, `cure`, `infect <0-1>`, `bleed`, `sethp <n>`, `setstat <food\|water\|stamina> <n>`, `kill`, `pos`, `tp <x z \| town \| military \| beach \| bag \| base>` |
| Items | `give <item> [qty]`, `kit <starter\|builder\|guns\|smelt\|survival>`, `items [filter]`, `recipes`, `clearinv`, `ammo` (infinite), `freebuild`, `instacraft` |
| World & time | `time <hour>`, `day <n>`, `timescale <x>`, `freezetime`, `respawnnodes`, `refillloot`, `save`, `load`, `wipesave` |
| Zombies | `spawn [n] [dist]`, `horde [size]`, `killall [radius]`, `clearzombies`, `notarget`, `freezeai`, `nospawn`, `zombies [n]`, `noise <radius>` |
| Debug views | `look` (inspect what's under the crosshair), `mapzombies` (show zombies on the map), `showcolliders`, `showhitboxes`, `showai`, `shownoise`, `showbullets`, `debugall`, `stats`, `info`, `js <expr>` |

Toggles accept an optional `on`/`off`; without one they flip. Cheats aren't saved, so a reload resets them.

Add `?debuglock` to the URL to let automated tests drive the game without pointer lock. The game object is exposed as `window.game` for console tinkering.
