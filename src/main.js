import * as THREE from 'three';
import { Terrain, World, initMaterials, WATER_LEVEL } from './world.js';
import { Physics, makeBox } from './physics.js';
import { Environment } from './env.js';
import { Player } from './player.js';
import { Container } from './inventory.js';
import { ITEMS } from './items.js';
import { ViewModel } from './viewmodel.js';
import { Combat } from './combat.js';
import { BuildingManager } from './building.js';
import { ZombieManager } from './zombies.js';
import { Crafting } from './crafting.js';
import { UI } from './ui.js';
import { Audio } from './audio.js';
import { PadState, PadGameplay, PadCursor } from './gamepad.js';
import { DevConsole } from './devconsole.js';
import { GameMap } from './map.js';

const SAVE_KEY = 'rotrust_save_v1';
const SETTINGS_KEY = 'rotrust_settings_v1';

// ------------------------------------------------------------------ input
class Input {
  constructor() {
    this.keys = new Set();
    this.justPressed = new Set();
    this.buttons = new Set();
    this.justClicked = new Set();
    this.mouseDX = 0; this.mouseDY = 0;
    this._dx = 0; this._dy = 0;
    this.wheel = 0; this._wheel = 0;
    // Controller: raw state plus virtual keys/buttons it holds this frame.
    this.pad = new PadState();
    this.padKeys = new Set();
    this.padButtons = new Set();
    this.moveX = 0; this.moveY = 0;
    this.lastDevice = 'kbm';
    window.addEventListener('keydown', (e) => {
      this.lastDevice = 'kbm';
      if (e.code === 'Tab') e.preventDefault();
      if (!e.repeat) this.justPressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.buttons.clear(); });
    window.addEventListener('mousedown', (e) => { this.lastDevice = 'kbm'; this.buttons.add(e.button); this.justClicked.add(e.button); });
    window.addEventListener('mouseup', (e) => this.buttons.delete(e.button));
    window.addEventListener('mousemove', (e) => {
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) this.lastDevice = 'kbm';
      if (document.pointerLockElement) { this._dx += e.movementX; this._dy += e.movementY; }
    });
    window.addEventListener('wheel', (e) => { this._wheel += Math.sign(e.deltaY); }, { passive: true });
  }
  down(...codes) { return codes.some((c) => this.keys.has(c) || this.padKeys.has(c)); }
  pressed(code) { return this.justPressed.has(code); }
  mouseDown(b) { return this.buttons.has(b) || this.padButtons.has(b); }
  mousePressed(b) { return this.justClicked.has(b); }
  beginFrame() {
    this.mouseDX = this._dx; this.mouseDY = this._dy;
    this._dx = this._dy = 0;
    this.wheel = this._wheel; this._wheel = 0;
    this.padKeys.clear();
    this.padButtons.clear();
    this.moveX = this.moveY = 0;
    this.pad.poll();
    if (this.pad.used) this.lastDevice = 'pad';
  }
  // True while a controller is driving the game (no pointer lock needed).
  get padActive() { return this.pad.connected && this.lastDevice === 'pad'; }
  rumble(strong, weak, ms) { if (this.padActive) this.pad.rumble(strong, weak, ms); }
  endFrame() { this.justPressed.clear(); this.justClicked.clear(); }
}

// ------------------------------------------------------------------ dropped loot bags
const BAG_GEO = new THREE.DodecahedronGeometry(0.28, 0);
const BAG_MAT = new THREE.MeshLambertMaterial({ color: 0x6b5a3a, flatShading: true });
class WorldBag {
  constructor(game, x, y, z, items, name = 'Dropped Items', life = 600) {
    this.kind = 'bag';
    this.game = game;
    this.name = name;
    this.container = new Container(Math.max(12, items.length), name);
    for (const it of items) this.container.addItem(it);
    this.mesh = new THREE.Mesh(BAG_GEO, BAG_MAT);
    this.mesh.position.set(x, y + 0.22, z);
    this.mesh.scale.set(1, 0.75, 1);
    this.mesh.castShadow = true;
    game.scene.add(this.mesh);
    this.box = makeBox(x - 0.35, y, z - 0.35, x + 0.35, y + 0.5, z + 0.35, 'bag', this, false);
    game.physics.add(this.box);
    this.expires = game.clock + life;
    this.pos = { x, y, z };
  }
  label() { return `Open ${this.name}`; }
  interact(game) { game.ui.openContainer(this.container, this); }
  onClose() { if (this.container.isEmpty()) this.remove(); }
  remove() {
    this.game.scene.remove(this.mesh);
    this.game.physics.remove(this.box);
    const list = this.game.bags;
    const i = list.indexOf(this);
    if (i >= 0) list.splice(i, 1);
  }
  serialize() { return { x: this.pos.x, y: this.pos.y, z: this.pos.z, name: this.name, slots: this.container.serialize(), left: this.expires - this.game.clock }; }
}

// ------------------------------------------------------------------ objectives (the core loop, as a guide)
const OBJECTIVES = [
  { id: 'gather', text: 'Gather 150 wood and 100 stone (hit trees and rocks)', check: (g) => g.inventory.count('wood') >= 150 && g.inventory.count('stone') >= 100 },
  { id: 'hatchet', text: 'Craft a Stone Hatchet or Pickaxe [Tab]', check: (g) => g.inventory.count('hatchet') + g.inventory.count('pickaxe') > 0 },
  { id: 'foundation', text: 'Craft a Building Plan and place a foundation', check: (g) => g.building.pieces.some((p) => p.type === 'foundation') },
  { id: 'walls', text: 'Enclose a foundation: walls + doorway + door', check: (g) => g.building.pieces.some((p) => p.type === 'door') },
  { id: 'upgrade', text: 'Upgrade a piece with the Hammer (RMB)', check: (g) => g.building.pieces.some((p) => p.tier > 0) },
  { id: 'furnace', text: 'Build a Furnace and smelt metal ore', check: (g) => g.inventory.count('metal_frags') > 0 },
  { id: 'gun', text: 'Find or craft a firearm (loot the town)', check: (g) => g.inventory.slots.some((s) => s && ITEMS[s.id].gun) },
  { id: 'night', text: 'Survive the night horde', check: (g) => g.env.day >= 2 && g.env.hours > 6 },
];

// ------------------------------------------------------------------ game
class Game {
  constructor() {
    this.clock = 0;
    this.stats = { kills: 0 };
    this.settings = { sensitivity: 1, fov: 75, volume: 0.6, maxZombies: 60, padSens: 1, invertY: false, padEnabled: true };
    try { Object.assign(this.settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch { /* ignore */ }
    this.objectivesDone = new Set();
    // Debug toggles driven by the dev console (` key).
    this.cheats = {
      god: false, noclip: false, speed: 1, infiniteAmmo: false, freeBuild: false, instaCraft: false,
      timeScale: 1, freezeTime: false, noTarget: false, freezeAI: false, noSpawn: false,
    };

    const canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false; // count both scene passes per frame

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, window.innerWidth / window.innerHeight, 0.05, 700);
    this.camera.rotation.order = 'YXZ';
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 10);
    this.vmAmbient = new THREE.AmbientLight(0xffffff, 0.6);
    this.vmSun = new THREE.DirectionalLight(0xffffff, 1.2);
    this.vmSun.position.set(0.5, 1, 0.3);
    this.vmScene.add(this.vmAmbient, this.vmSun);

    initMaterials();
    this.input = new Input();
    this.audio = new Audio();
    this.audio.volume = this.settings.volume;
    this.terrain = new Terrain();
    this.physics = new Physics(this.terrain);
    this.env = new Environment(this.scene);
    this.inventory = new Container(30, 'Inventory');
    this.player = new Player(this);
    this.world = new World(this);
    this.world.build();
    this.viewmodel = new ViewModel(this.vmScene);
    this.combat = new Combat(this);
    this.building = new BuildingManager(this);
    this.zombies = new ZombieManager(this);
    this.crafting = new Crafting(this);
    this.ui = new UI(this);
    this.padGameplay = new PadGameplay(this);
    this.padCursor = new PadCursor(this);
    this.map = new GameMap(this);
    this.dev = new DevConsole(this);
    this.currentInteract = null;
    window.addEventListener('gamepadconnected', (e) => this.ui.message(`Controller detected: ${e.gamepad.id.split('(')[0].trim()} (turn off in Settings if this isn't a controller)`));
    window.addEventListener('gamepaddisconnected', () => {
      this.ui.message('Controller disconnected', 'warn');
      if (this.running && !document.pointerLockElement && !this.debugLock) this.pause();
    });
    this.bags = [];
    this.inventory.onChange = () => this.ui.refresh();

    this.running = false;
    this.started = false;
    // ?debuglock lets automated tests drive the game without real pointer lock.
    this.debugLock = new URLSearchParams(location.search).has('debuglock');
    this._v = new THREE.Vector3();
    this._bindUI();
    window.addEventListener('resize', () => this.onResize());
    document.addEventListener('pointerlockchange', () => this.onLockChange());
    this.ui.showMenu('start');
    this.last = performance.now();
    this.saveT = 60;
    requestAnimationFrame((t) => this.frame(t));
  }

  // ------------------------------------------------------------------ setup / menus
  _bindUI() {
    const $ = (id) => document.getElementById(id);
    $('menu-new').onclick = () => { this.newGame(); this.startPlaying(); };
    $('menu-continue').onclick = () => { if (this.load()) this.startPlaying(); };
    $('menu-resume').onclick = () => this.startPlaying();
    $('menu-save').onclick = () => { this.save(); this.ui.message('Game saved.'); };
    $('death-bag').onclick = () => this.respawn(true);
    $('death-beach').onclick = () => this.respawn(false);
    const sens = $('set-sens'), fov = $('set-fov'), vol = $('set-vol'), zc = $('set-zombies'), psens = $('set-padsens'), inv = $('set-invert'), pen = $('set-padenabled');
    sens.value = this.settings.sensitivity; fov.value = this.settings.fov; vol.value = this.settings.volume; zc.value = this.settings.maxZombies;
    psens.value = this.settings.padSens; inv.checked = !!this.settings.invertY; pen.checked = this.settings.padEnabled !== false;
    const apply = () => {
      this.settings.sensitivity = Number(sens.value);
      this.settings.fov = Number(fov.value);
      this.settings.volume = Number(vol.value);
      this.settings.maxZombies = Number(zc.value);
      this.settings.padSens = Number(psens.value);
      this.settings.invertY = inv.checked;
      this.settings.padEnabled = pen.checked;
      this.input.pad.enabled = pen.checked;
      if (!pen.checked) this.input.lastDevice = 'kbm';
      $('set-padsens-v').textContent = this.settings.padSens.toFixed(2);
      this.audio.volume = this.settings.volume;
      if (this.audio.master) this.audio.master.gain.value = this.settings.volume;
      $('set-sens-v').textContent = this.settings.sensitivity.toFixed(2);
      $('set-fov-v').textContent = this.settings.fov;
      $('set-vol-v').textContent = Math.round(this.settings.volume * 100) + '%';
      $('set-zombies-v').textContent = this.settings.maxZombies;
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* ignore */ }
    };
    [sens, fov, vol, zc, psens, inv, pen].forEach((e) => (e.oninput = apply));
    inv.onchange = pen.onchange = apply;
    apply();
    // Any key (other than Esc) or click recaptures the mouse when it was left free.
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' && e.code !== 'Backquote' && e.code !== 'F8' && this.needsRelock) this.lock();
    });
    document.getElementById('game').addEventListener('click', () => {
      if (this.started && !this.ui.inventoryOpen && this.player.alive && !this.dev.open) this.lock();
    });
  }

  lock() {
    const c = document.getElementById('game');
    if (document.pointerLockElement !== c) {
      const p = c.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    }
  }

  startPlaying() {
    this.audio.init();
    this.audio.resume();
    this.started = true;
    this.running = true;
    this.ui.hideMenu();
    this.ui.refresh();
    if (!this.input.padActive) this.lock();
  }

  pause() {
    if (!this.running) return;
    this.running = false;
    this.ui.closeInventory(false);
    if (document.pointerLockElement) document.exitPointerLock();
    this.ui.showMenu('pause');
  }

  // Running and alive, but the mouse isn't captured (e.g. right after closing a container).
  get needsRelock() {
    return this.started && this.running && this.player.alive && !this.ui.inventoryOpen && !document.pointerLockElement &&
      !this.input.padActive && !this.debugLock && !this.dev.open;
  }

  onLockChange() {
    const locked = !!document.pointerLockElement;
    // Esc with the map open closes the map rather than pausing (the browser eats that Esc).
    if (!locked && this.map.open) { this.map.close(); this.ui.lastClosed = performance.now(); return; }
    // Losing the lock just after closing a container (e.g. the browser handling that same Esc press)
    // isn't a pause request.
    if (!locked && performance.now() - this.ui.lastClosed < 1500) return;
    if (!locked && this.started && !this.ui.inventoryOpen && this.player.alive && !this.input.padActive && !this.dev.open) {
      this.running = false;
      this.ui.showMenu('pause');
    }
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    if (this.map.open) { this.map._resize(); this.map.draw(); }
    this.renderer.setSize(w, h);
    this.camera.aspect = this.vmCamera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vmCamera.updateProjectionMatrix();
  }

  newGame() {
    this.building.clear();
    this.zombies.clear();
    for (const b of [...this.bags]) b.remove();
    this.crafting.clear();
    this.env.hours = 8;
    this.env.day = 1;
    this.zombies.hordeDay = 0;
    this.stats.kills = 0;
    this.objectivesDone.clear();
    this.player.reset();
    this.giveStartKit();
    const s = this.terrain.beachSpawn();
    this.player.teleport(s.x, s.z);
    this.player.yaw = Math.atan2(s.x, s.z); // face inland
    this.player.pitch = 0;
    this.combat.slot = 0;
    this.ui.message('You wake up on a beach. The dead walk. Gather, build, survive.', 'warn');
    const k = (n) => this.ui.key(n);
    this.ui.message(`${k('LMB')}: hit trees & rocks · ${k('Tab')}: inventory/crafting · ${k('E')}: interact`);
  }

  giveStartKit() {
    this.inventory.clear();
    this.inventory.slots[0] = { id: 'rock', qty: 1 };
    this.inventory.slots[1] = { id: 'bandage', qty: 2 };
    this.inventory.slots[6] = { id: 'flashlight', qty: 1 };
    this.inventory.changed();
  }

  // ------------------------------------------------------------------ gameplay hooks
  makeNoise(x, z, radius) {
    this.dev.debug.onNoise(x, z, radius);
    if (!this.cheats.noTarget) this.zombies.noise(x, z, radius);
  }

  damagePlayer(amount, source, silent = false) {
    const p = this.player;
    if (!p.alive || this.cheats.god) return;
    p.health -= amount;
    if (!silent) {
      this.ui.damageFlash(amount);
      this.input.rumble(0.4 + amount / 30, 0.6, 180);
      this.audio.play('hurt');
      p.lastHurt = this.clock;
    }
    if (p.health <= 0) this.die(source);
  }

  zombieHitsPlayer() {
    const p = this.player;
    const dmg = (8 + Math.random() * 7) * (this.env.isNight ? 1.25 : 1);
    this.audio.play('zhit');
    this.combat.recoilPitch += (Math.random() - 0.3) * 0.08;
    this.combat.recoilYaw += (Math.random() - 0.5) * 0.12;
    if (this.cheats.god) return;
    if (Math.random() < 0.3 && !p.bleeding) { p.bleeding = true; this.ui.message('You are bleeding! Use a bandage.', 'bad'); }
    // Project Zomboid-style: a scratch or bite can carry the infection.
    if (p.infection === 0 && Math.random() < 0.04) p.infection = 0.0001;
    this.damagePlayer(dmg, 'zombie');
  }

  consume(id, slotIndex = -1) {
    const def = ITEMS[id];
    if (!def || !def.use) return;
    const p = this.player;
    const u = def.use;
    if (u.heal) p.health = Math.min(100, p.health + u.heal);
    if (u.stopBleed && p.bleeding) { p.bleeding = false; this.ui.message('Bleeding stopped.'); }
    if (u.food) p.food = Math.max(0, Math.min(100, p.food + u.food));
    if (u.water) p.water = Math.max(0, Math.min(100, p.water + u.water));
    const inv = this.inventory;
    const slot = slotIndex >= 0 ? inv.slots[slotIndex] : inv.slots[this.combat.slot];
    if (slot && slot.id === id) {
      slot.qty--;
      const idx = inv.slots.indexOf(slot);
      if (slot.qty <= 0) inv.slots[idx] = null;
      inv.changed();
    } else inv.remove(id, 1);
    this.audio.play('eat');
  }

  dropItems(items, name = 'Dropped Items', life = 600) {
    const p = this.player.pos;
    const fwdX = -Math.sin(this.player.yaw), fwdZ = -Math.cos(this.player.yaw);
    const x = p.x + fwdX * 0.8, z = p.z + fwdZ * 0.8;
    const y = this.physics.groundAt(x, z, 0.3, p.y + 0.5);
    const bag = new WorldBag(this, x, y, z, items, name, life);
    this.bags.push(bag);
    return bag;
  }

  die(source) {
    const p = this.player;
    p.alive = false;
    p.health = 0;
    const items = this.inventory.slots.filter(Boolean);
    if (items.length) {
      const bag = new WorldBag(this, p.pos.x, this.physics.groundAt(p.pos.x, p.pos.z, 0.3, p.pos.y + 0.5), p.pos.z, items, 'Your Backpack', 1800);
      this.bags.push(bag);
    }
    this.inventory.clear();
    this.crafting.clear();
    this.ui.closeInventory(false);
    this.map.close();
    this.combat.flashlightOn = false;
    this.combat.cancelActions();
    this.padGameplay.reset();
    if (document.pointerLockElement) document.exitPointerLock();
    const cause = source === 'zombie' ? 'Killed by the dead' : source === 'fall' ? 'Fell to your death' : source === 'status' ? (p.infection >= 1 ? 'Succumbed to the infection' : 'Died of exposure') : 'You died';
    this.ui.showDeath(`${cause}. Survived until day ${this.env.day}, ${this.stats.kills} zombies put down. Your backpack was left where you fell.`);
  }

  respawn(atBag) {
    const p = this.player;
    p.reset();
    this.giveStartKit();
    const bag = this.building.spawnBag;
    if (atBag && bag) p.teleport(bag.x, bag.z, bag.y + 0.2);
    else {
      const s = this.terrain.beachSpawn();
      p.teleport(s.x, s.z);
      p.yaw = Math.atan2(s.x, s.z);
    }
    this.ui.hideDeath();
    this.startPlaying();
  }

  // What's under the crosshair that E can act on?
  findInteractable() {
    const cam = this.camera;
    const o = cam.position;
    const d = this._v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const hit = this.physics.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 3, { solidOnly: false, filter: (b) => b.solid || b.kind === 'node' || b.kind === 'bag' || b.kind === 'build' });
    const corpse = this.zombies.raycast(o, d, hit ? hit.dist : 3, true);
    if (corpse && !corpse.zombie.alive) {
      const z = corpse.zombie;
      return { label: z.loot && !z.loot.isEmpty() ? 'Search corpse' : 'Corpse (empty)', act: () => this.ui.openContainer(z.loot, null) };
    }
    if (hit && hit.box && hit.box.owner) {
      const own = hit.box.owner;
      if (own.kind === 'node' && own.type === 'hemp') {
        return { label: 'Pick Hemp', act: () => { this.combat._give('cloth', 10); this.world.depleteNode(own, this.clock); } };
      }
      if (own.kind === 'piece' && own.type === 'door') {
        return { label: own.open ? 'Close door' : 'Open door', act: () => this.building.toggleDoor(own) };
      }
      if (own.label && own.interact) return { label: own.label(), act: () => own.interact(this) };
    }
    // Drinking from fresh water / sea
    if (d.y < -0.2) {
      const t = (WATER_LEVEL - o.y) / d.y;
      if (t > 0 && t < 3 && (!hit || hit.dist > t)) {
        const wx = o.x + d.x * t, wz = o.z + d.z * t;
        if (this.terrain.heightAt(wx, wz) < WATER_LEVEL) return { label: 'Drink water', act: () => { this.player.water = Math.min(100, this.player.water + 15); this.audio.play('eat'); } };
      }
    }
    return null;
  }

  updateObjectives() {
    const next = OBJECTIVES.find((o) => !this.objectivesDone.has(o.id));
    if (next && next.check(this)) {
      this.objectivesDone.add(next.id);
      this.ui.message(`✔ ${next.text}`);
      this.audio.play('craft');
    }
    const el = document.getElementById('objective');
    const cur = OBJECTIVES.find((o) => !this.objectivesDone.has(o.id));
    const text = cur ? cur.text.replace('[Tab]', `[${this.ui.key('Tab')}]`).replace('(RMB)', `(${this.ui.key('RMB')})`) : '';
    el.innerHTML = cur ? `<b>Objective</b> ${text}` : '<b>Objective</b> Keep surviving. The nights get worse.';
  }

  // ------------------------------------------------------------------ main loop
  frame(t) {
    requestAnimationFrame((tt) => this.frame(tt));
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    const t0 = performance.now();
    this.tick(dt);
    const t1 = performance.now();
    this.render();
    this.dev.frame(dt, t1 - t0, performance.now() - t1);
  }

  tick(dt) {
    this.input.beginFrame();
    this.ui.beginFrame();
    document.body.classList.toggle('pad', this.input.lastDevice === 'pad');
    // Controller drives either the on-screen cursor (menus/inventory) or the game itself.
    const uiRoot = this.padCursor.currentRoot();
    this.padCursor.update(dt);
    if (!uiRoot && this.running) this.padGameplay.apply(dt);
    if (this.running) this.update(dt * this.cheats.timeScale);
    this.ui.endFrame();
    this.input.endFrame();
  }

  update(dt) {
    this.clock += dt;
    const input = this.input;
    const locked = !!document.pointerLockElement || this.debugLock || this.input.padActive;
    const p = this.player;

    // Global keys
    if (this.ui.inventoryOpen && (input.pressed('Tab') || input.pressed('KeyI') || input.pressed('KeyE') || input.pressed('Escape'))) {
      // Esc can't re-grab the mouse (browsers don't treat it as a user gesture), so don't try;
      // the "click to resume" hint covers that case.
      this.ui.closeInventory(!input.pressed('Escape'));
      input.justPressed.delete('KeyE');
      input.justPressed.delete('Tab');
      input.justPressed.delete('KeyI');
    } else if ((input.pressed('Tab') || input.pressed('KeyI')) && p.alive) {
      this.map.close();
      this.ui.openInventory();
    } else if (input.pressed('KeyM') && p.alive) {
      this.map.toggle();
    } else if (this.map.open && input.pressed('Escape')) {
      this.map.close();
    }
    if (this.map.open && input.wheel) {
      this.map.zoomBy(-input.wheel);
      input.wheel = 0;
    }
    if (locked && p.alive) {
      for (let i = 0; i < 6; i++) if (input.pressed(`Digit${i + 1}`)) this.combat.selectSlot(i);
      if (input.wheel && !(this.combat.def && this.combat.def.gun && this.combat.adsAmount > 0.5)) this.combat.selectSlot((this.combat.slot + input.wheel + 6) % 6);
    }

    if (p.alive) {
      p.update(dt, input, locked && !this.ui.inventoryOpen);
      p.updateStats(dt);
    }
    this.env.update(this.cheats.freezeTime ? 0 : dt, this._v.set(p.pos.x, p.pos.y, p.pos.z));
    this.updateCamera();
    this.combat.update(dt, input, locked && !this.ui.inventoryOpen && !this.map.open);
    this.map.update(dt);
    this.zombies.update(dt);
    this.building.update(dt);
    this.world.update(dt, this.clock);
    this.crafting.update(dt);
    for (const b of [...this.bags]) if (this.clock > b.expires && this.ui.openTarget !== b) b.remove();

    // Interaction prompt
    this.currentInteract = null;
    if (locked && p.alive && !this.ui.inventoryOpen && !this.map.open) {
      const it = this.findInteractable();
      this.currentInteract = it;
      if (it) {
        this.ui.prompt(`[${this.ui.key('E')}] ${it.label}`);
        if (input.pressed('KeyE')) it.act();
      }
    }

    // Close containers if you walk away from them
    const tgt = this.ui.openTarget;
    if (tgt && this.ui.inventoryOpen) {
      const tp = tgt.pos || tgt.center || (tgt.x !== undefined ? tgt : null);
      if (tp && Math.hypot(tp.x - p.pos.x, tp.z - p.pos.z) > 4) this.ui.closeInventory(false);
    }

    document.getElementById('resume-hint').style.display = this.needsRelock ? 'block' : 'none';
    this._hudT = (this._hudT || 0) - dt;
    if (this._hudT <= 0) {
      this._hudT = 0.1;
      this.ui.updateHUD();
      this.updateObjectives();
      if (this.ui.inventoryOpen && this.ui.openTarget && this.ui.openTarget.on) this.ui.refresh();
    }
    this.saveT -= dt;
    if (this.saveT <= 0 && p.alive) { this.saveT = 60; this.save(); }
  }

  updateCamera() {
    const p = this.player, c = this.combat;
    const cam = this.camera;
    p.eyePos(cam.position);
    cam.rotation.set(p.pitch + c.recoilPitch, p.yaw + c.recoilYaw, 0);
    const def = c.def;
    const adsFov = def && def.gun ? def.gun.adsFov : this.settings.fov;
    const fov = this.settings.fov + (adsFov - this.settings.fov) * c.adsAmount * (p.sprinting ? 0 : 1);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
      this.vmCamera.fov = 60 - c.adsAmount * 8;
      this.vmCamera.updateProjectionMatrix();
    }
  }

  render() {
    const r = this.renderer;
    // Dim the viewmodel lights with the world lighting so guns don't glow at night.
    const dark = this.env.darkness;
    this.vmAmbient.intensity = 0.15 + (1 - dark) * 0.5 + (this.combat.flashlightOn ? 0.25 : 0);
    this.vmSun.intensity = 0.15 + (1 - dark) * 1.1;
    r.info.reset();
    r.clear();
    r.render(this.scene, this.camera);
    if (this.started && this.player.alive) {
      r.clearDepth();
      r.render(this.vmScene, this.vmCamera);
    }
  }

  // ------------------------------------------------------------------ save / load
  hasSave() {
    try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
  }

  save() {
    const p = this.player;
    if (!p.alive) return;
    const data = {
      v: 1,
      clock: this.clock,
      player: { pos: p.pos, yaw: p.yaw, pitch: p.pitch, health: p.health, food: p.food, water: p.water, stamina: p.stamina, bleeding: p.bleeding, infection: p.infection },
      inventory: this.inventory.serialize(),
      env: { hours: this.env.hours, day: this.env.day, hordeDay: this.zombies.hordeDay },
      stats: this.stats,
      building: this.building.serialize(),
      bags: this.bags.map((b) => b.serialize()),
      objectives: [...this.objectivesDone],
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (e) { console.warn('Save failed', e); }
  }

  load() {
    let data;
    try { data = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { data = null; }
    if (!data || data.v !== 1) return false;
    this.zombies.clear();
    for (const b of [...this.bags]) b.remove();
    this.crafting.clear();
    this.clock = data.clock || 0;
    this.building.load(data.building);
    const p = this.player;
    p.reset();
    Object.assign(p, { yaw: data.player.yaw, pitch: data.player.pitch, health: data.player.health, food: data.player.food, water: data.player.water, stamina: data.player.stamina, bleeding: data.player.bleeding, infection: data.player.infection || 0 });
    p.teleport(data.player.pos.x, data.player.pos.z, data.player.pos.y + 0.05);
    this.inventory.load(data.inventory);
    this.env.hours = data.env.hours;
    this.env.day = data.env.day;
    this.zombies.hordeDay = data.env.hordeDay || 0;
    this.stats = Object.assign({ kills: 0 }, data.stats);
    this.objectivesDone = new Set(data.objectives || []);
    for (const b of data.bags || []) {
      const items = (b.slots || []).filter(Boolean);
      if (items.length) this.bags.push(new WorldBag(this, b.x, b.y, b.z, items, b.name, Math.max(30, b.left || 300)));
    }
    this.ui.message('Save loaded.');
    return true;
  }
}

const game = new Game();
window.game = game; // handy for debugging from the console
