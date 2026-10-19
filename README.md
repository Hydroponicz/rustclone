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

1. Wake up on a beach with a rock. Hit trees for **wood** and rocks for **stone**, **metal ore** (brown) and **sulfur ore** (yellow). Pick **hemp** (E) for cloth. Look for **wood piles** (stacked logs at forest edges, around town and at the checkpoint): press E to take the whole pile, about 200 wood, or chop it. Trees give about 10 wood per hit with a rock and 28 with a hatchet, bigger trees hold more, and you get a bonus when one falls.
2. Craft a hatchet and pickaxe, then a **building plan**. Place foundations, walls, a doorway with a door, and floors. Upgrade with the **hammer**.
3. Build a **furnace**, load it with wood and ore, and light it to get metal fragments, sulfur and charcoal. Turn those into gunpowder and ammo.
4. Loot the **town** (kitchen cabinets, fridges, wardrobes, car wrecks) and the **military checkpoint** (weapon crates) for guns, ammo and medical supplies. Break **barrels** for scrap.
5. Use the **map** (M) to find the town, the checkpoint, your base and your backpack after a death. Survive the nights. Raise your foundations (zombies can't climb them), upgrade your walls, and keep a sleeping bag down as a respawn point. When you die, your backpack stays where you fell.

### Food and saturation

Eating heals you over time on top of restoring hunger, and bigger meals heal more:

| Food | Hunger | Thirst | Heals over time | Where |
| --- | --- | --- | --- | --- |
| Soda Can | +5 | +25 | 4 HP / 10 s | houses |
| Crisps | +15 | −5 | 8 HP / 15 s | houses, zombies |
| Can of Beans | +35 | +5 | 20 HP / 30 s | houses, zombies |
| Canned Stew | +45 | +10 | 30 HP / 40 s | house kitchens |
| Army Ration (MRE) | +65 | +10 | 45 HP / 50 s | military crates |

Meals stack, so eating two heals faster, up to 60 HP stored. Stored healing waits while you're at full health. While it's active you get a **Well fed** status and a light green segment on the health bar showing the healing still to come. Hover a food item in your inventory to see its numbers.

The game autosaves every 60 seconds to `localStorage`. Use **Continue** on the title screen to resume. Starting, continuing or resuming switches the browser to fullscreen (you can turn this off in Settings).

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
| `src/devconsole.js` | Debug panel GUI, command line, cheats, stats overlay and debug visualisations |
| `src/gamepad.js` | Controller polling, gameplay mapping, rumble, aim slowdown, and the menu/inventory cursor |
| `vendor/three.module.min.js` | three.js r170 (MIT, see `vendor/THREE_LICENSE`) |

## Debug panel

Press **`** (backquote) or **F8** to open the debug panel. It's a side panel of checkboxes, sliders and buttons that you use with the mouse, and the game keeps running behind it. A controller keeps controlling the game while the panel is open, so you can play on the pad and flip settings with the mouse. **F3** toggles a compact stats overlay that stays visible while you play.

| Section | What's in it |
| --- | --- |
| Live info | FPS and frame/update/render timings, draw calls, position and zone, survival stats, zombie counts by AI state, base pieces by tier, input device, active cheats; "Inspect crosshair target" |
| Player | God mode, noclip/fly, infinite ammo, bleeding (checkboxes); move speed, health, food, water, stamina, infection (sliders); heal, cure, clear inventory, kill me |
| Teleport | Town, military, beach, sleeping bag, your base, or exact x/z coordinates |
| Items | Item picker with quantity, kits (starter, builder, guns, smelt, survival), quick ×1000 resources, free building/crafting, instant crafting |
| World & time | Time-of-day slider with dawn/noon/dusk/night/"horde time" presets, day number, game speed, freeze clock, respawn trees/rocks, refill loot, save/load/delete save |
| Zombies | Zombies ignore me, freeze all, disable spawns/hordes, show on map, max zombies; spawn count/distance and horde size sliders with spawn/horde/noise buttons; kill or remove all; live list of the nearest zombies |
| Debug views | Physics colliders, zombie hitboxes, AI state and targets, noise rings, bullet paths (with colour legends), all on/off |
| Command line | Collapsed by default. Every action is also a typed command (`help` lists them), with Tab completion and history. Errors and warnings show up here, with a red on-screen badge when new ones arrive. |

Controls stay in sync if something changes them in game. Cheats aren't saved, so a reload resets them.

Add `?debuglock` to the URL to let automated tests drive the game without pointer lock. The game object is exposed as `window.game` for console tinkering.
