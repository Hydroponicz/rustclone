import * as THREE from 'three';
import { ITEMS, RECIPES } from './items.js';
import { fmtTime } from './util.js';

// Developer debug panel: press ` (backquote) or F8 (controller: L3+R3). Checkboxes, sliders and
// buttons for cheats, spawning, time and debug views, plus a command line (type `help`).

const HISTORY_KEY = 'rotrust_console_history';
const STATE_COLORS = { idle: 0x8a8a8a, wander: 0x6a9fd9, investigate: 0xe0c040, chase: 0xff3a2a, bash: 0xff8a1a };
const KIND_COLORS = { static: 0x9a9a9a, node: 0x6fd96a, loot: 0xe0c040, build: 0x4ac8ff, deploy: 0xd96ad9, bag: 0xffffff };
const KITS = {
  starter: { hatchet: 1, pickaxe: 1, building_plan: 1, hammer: 1, wood: 1000, stone: 1000, bandage: 5 },
  builder: { building_plan: 1, hammer: 1, wood: 5000, stone: 5000, metal_frags: 3000, door_wood: 5, storage_box: 3, furnace: 2, campfire: 2, sleeping_bag: 2 },
  guns: { pistol: 1, shotgun: 1, rifle: 1, bolt: 1, ammo_9mm: 120, ammo_12g: 60, ammo_762: 240, medkit: 3, bandage: 10 },
  smelt: { furnace: 1, wood: 1000, metal_ore: 1000, sulfur_ore: 1000 },
  survival: { beans: 10, water: 10, medkit: 3, bandage: 10, flashlight: 1 },
};

export class DevConsole {
  constructor(game) {
    this.game = game;
    this.open = false;
    this.lines = [];
    this.errorCount = 0;
    this.statsOn = false;
    this.timing = { update: 0, render: 0, frame: 0, fps: 0 };
    this._fpsFrames = 0;
    this._fpsT = 0;
    this._statsT = 0;
    try { this.history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { this.history = []; }
    this.histIdx = this.history.length;
    this.commands = new Map();
    this.debug = new DebugDraw(game);
    this._buildDom();
    this._registerCommands();
    this._buildGui();
    this._captureErrors();
    this.log('Command line: type "help" for commands, Tab to autocomplete, ↑/↓ for history.', 'info');
  }

  // ------------------------------------------------------------------ DOM
  _buildDom() {
    const root = document.createElement('div');
    root.id = 'devconsole';
    root.innerHTML = `
      <div id="dp-head"><b>Debug panel</b><span class="dp-keys">\` / F8 · pad L3+R3</span><button id="dp-close" title="Close">✕</button></div>
      <div id="dp-body"></div>`;
    document.body.appendChild(root);
    this.root = root;
    this.body = root.querySelector('#dp-body');
    root.querySelector('#dp-close').onclick = () => this.toggle(false);
    this.statsEl = document.createElement('div');
    this.statsEl.id = 'devstats';
    document.body.appendChild(this.statsEl);
    this.badge = document.createElement('div');
    this.badge.id = 'dc-badge';
    document.body.appendChild(this.badge);
    this.syncers = [];

    // Command line lives in its own (collapsed) section at the bottom of the panel.
    const cl = this._section('Command line', false, 'dp-console');
    cl.innerHTML = '<div id="dc-log"></div><div id="dc-row"><span>&gt;</span><input id="dc-input" spellcheck="false" autocomplete="off" placeholder="type help…" /></div><div id="dc-suggest"></div>';
    this.consoleSection = cl.parentElement;
    this.logEl = cl.querySelector('#dc-log');
    this.inputEl = cl.querySelector('#dc-input');
    this.suggestEl = cl.querySelector('#dc-suggest');

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Backquote' || e.code === 'F8') {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.toggle();
      } else if (e.code === 'F3') {
        e.preventDefault();
        this._run('stats');
      } else if (this.open && e.code === 'Escape' && document.activeElement !== this.inputEl) {
        this.toggle(false);
      }
    }, true);
    // Keep typing out of the game's key handlers.
    root.addEventListener('keydown', (e) => { if (e.code !== 'Backquote' && e.code !== 'F8') e.stopPropagation(); });
    root.addEventListener('keyup', (e) => e.stopPropagation());
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.code === 'Backquote' || e.code === 'F8') return;
      if (e.key === 'Enter') {
        const text = this.inputEl.value.trim();
        this.inputEl.value = '';
        this._suggest('');
        if (text) this.exec(text);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.toggle(false);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        this.histIdx = Math.max(0, Math.min(this.history.length, this.histIdx + (e.key === 'ArrowUp' ? -1 : 1)));
        this.inputEl.value = this.history[this.histIdx] || '';
      } else if (e.key === 'Tab') {
        e.preventDefault();
        this._complete();
      }
    });
    this.inputEl.addEventListener('input', () => this._suggest(this.inputEl.value));
    root.addEventListener('mousedown', (e) => e.stopPropagation());
    root.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
  }

  // ------------------------------------------------------------------ GUI widgets
  _section(title, open = true, id = '') {
    const d = document.createElement('details');
    d.className = 'dp-sec';
    if (id) d.id = id;
    d.open = open;
    d.innerHTML = `<summary>${title}</summary><div class="dp-sec-body"></div>`;
    // Keep the command line pinned last.
    if (this.consoleSection) this.body.insertBefore(d, this.consoleSection);
    else this.body.appendChild(d);
    return d.querySelector('.dp-sec-body');
  }

  _el(parent, html, cls = '') {
    const e = document.createElement('div');
    if (cls) e.className = cls;
    e.innerHTML = html;
    parent.appendChild(e);
    return e;
  }

  _toggle(parent, label, get, set, hint = '') {
    const row = this._el(parent, `<label class="dp-check"><input type="checkbox" /> <span>${label}</span>${hint ? `<small>${hint}</small>` : ''}</label>`);
    const cb = row.querySelector('input');
    const apply = () => set(cb.checked);
    cb.addEventListener('change', apply);
    cb.addEventListener('input', apply);
    this.syncers.push(() => { cb.checked = !!get(); });
    return cb;
  }

  _slider(parent, label, min, max, step, get, set, fmt = (v) => v) {
    const row = this._el(parent, `<label class="dp-slider"><span>${label}</span><b></b><input type="range" min="${min}" max="${max}" step="${step}" /></label>`);
    const r = row.querySelector('input'), out = row.querySelector('b');
    let dragging = false;
    r.addEventListener('pointerdown', () => { dragging = true; });
    window.addEventListener('pointerup', () => { dragging = false; });
    r.addEventListener('input', () => { set(Number(r.value)); out.textContent = fmt(Number(r.value)); });
    this.syncers.push(() => {
      if (dragging || document.activeElement === r) return;
      const v = get();
      r.value = String(v);
      out.textContent = fmt(Number(v));
    });
    return r;
  }

  _buttons(parent, list) {
    const row = this._el(parent, '', 'dp-btns');
    for (const [label, fn, cls] of list) {
      const b = document.createElement('button');
      b.textContent = label;
      if (cls) b.className = cls;
      b.onclick = () => { fn(); this._sync(); };
      row.appendChild(b);
    }
    return row;
  }

  _readout(parent, fn, cls = 'dp-readout') {
    const e = this._el(parent, '', cls);
    this.syncers.push(() => { e.textContent = fn(); });
    return e;
  }

  _sync() {
    for (const s of this.syncers) s();
  }

  _buildGui() {
    const g = this.game, c = g.cheats, p = () => g.player, dbg = this.debug;
    const run = (cmd) => () => this._run(cmd);
    const pct = (v) => `${Math.round(v)}`;

    // --- live info
    let s = this._section('Live info');
    this._readout(s, () => this.statsText(), 'dp-stats');
    this._toggle(s, 'Show stats overlay in game', () => this.statsOn, (v) => this._run(`stats ${v ? 'on' : 'off'}`), 'F3');
    this.lookOut = this._el(s, 'Look result appears here.', 'dp-readout dp-small');
    this._buttons(s, [['Inspect crosshair target', () => { this.lookOut.textContent = this.commands.get('look').run([]); }]]);

    // --- player
    s = this._section('Player');
    this._toggle(s, 'God mode', () => c.god, (v) => { c.god = v; }, 'no damage, bleeding or hunger');
    this._toggle(s, 'Noclip / fly', () => c.noclip, (v) => { c.noclip = v; }, 'WASD, Space up, Ctrl down, Shift fast');
    this._toggle(s, 'Infinite ammo', () => c.infiniteAmmo, (v) => { c.infiniteAmmo = v; });
    this._slider(s, 'Move speed', 0.25, 5, 0.25, () => c.speed, (v) => { c.speed = v; }, (v) => `×${v}`);
    this._slider(s, 'Health', 1, 100, 1, () => p().health, (v) => { p().health = v; }, pct);
    this._slider(s, 'Food', 0, 100, 1, () => p().food, (v) => { p().food = v; }, pct);
    this._slider(s, 'Water', 0, 100, 1, () => p().water, (v) => { p().water = v; }, pct);
    this._slider(s, 'Stamina', 0, 100, 1, () => p().stamina, (v) => { p().stamina = v; }, pct);
    this._slider(s, 'Infection', 0, 100, 1, () => p().infection * 100, (v) => { p().infection = v / 100; }, (v) => (v > 0 ? `${Math.round(v)}%` : 'none'));
    this._toggle(s, 'Bleeding', () => p().bleeding, (v) => { p().bleeding = v; });
    this._buttons(s, [['Heal fully', run('heal')], ['Cure infection', run('cure')], ['Clear inventory', run('clearinv'), 'warn'], ['Kill me', run('kill'), 'danger']]);

    // --- teleport
    s = this._section('Teleport', false);
    this._buttons(s, [['Town', run('tp town')], ['Military', run('tp military')], ['Beach', run('tp beach')], ['Sleeping bag', run('tp bag')], ['My base', run('tp base')]]);
    const tp = this._el(s, '<input type="number" placeholder="x" step="1" /> <input type="number" placeholder="z" step="1" /> <button>Go</button>', 'dp-inline');
    const [tx, tz] = tp.querySelectorAll('input');
    tp.querySelector('button').onclick = () => this._run(`tp ${Number(tx.value) || 0} ${Number(tz.value) || 0}`);
    this._readout(s, () => { const q = p().pos; return `You are at x ${q.x.toFixed(1)}, z ${q.z.toFixed(1)} (${this.zoneName()})`; }, 'dp-readout dp-small');

    // --- items
    s = this._section('Items', false);
    const giver = this._el(s, `<select></select><input type="number" min="1" value="1" /><button>Give</button>`, 'dp-inline');
    const sel = giver.querySelector('select'), qty = giver.querySelector('input');
    const groups = { Resources: [], Weapons: [], Tools: [], Ammo: [], Medical: [], Food: [], Deployables: [] };
    for (const [id, def] of Object.entries(ITEMS)) {
      const grp = def.gun ? 'Weapons' : def.deploy ? 'Deployables' : id.startsWith('ammo') ? 'Ammo' : def.use && (def.use.heal || def.use.stopBleed) ? 'Medical' : def.use ? 'Food' : def.melee || def.tool || id === 'flashlight' ? 'Tools' : 'Resources';
      groups[grp].push(`<option value="${id}">${def.icon} ${def.name}</option>`);
    }
    sel.innerHTML = Object.entries(groups).map(([k, v]) => `<optgroup label="${k}">${v.join('')}</optgroup>`).join('');
    giver.querySelector('button').onclick = () => this._run(`give ${sel.value} ${Math.max(1, Number(qty.value) || 1)}`);
    this._el(s, 'Kits', 'dp-label');
    this._buttons(s, Object.keys(KITS).map((k) => [k[0].toUpperCase() + k.slice(1), run(`kit ${k}`)]));
    this._el(s, 'Quick resources (×1000)', 'dp-label');
    this._buttons(s, ['wood', 'stone', 'metal_frags', 'scrap', 'cloth', 'gunpowder'].map((id) => [`${ITEMS[id].icon} ${ITEMS[id].name}`, run(`give ${id} 1000`)]));
    this._toggle(s, 'Free building & crafting', () => c.freeBuild, (v) => { c.freeBuild = v; }, 'no resource cost');
    this._toggle(s, 'Instant crafting', () => c.instaCraft, (v) => { c.instaCraft = v; });

    // --- world & time
    s = this._section('World & time', false);
    this._slider(s, 'Time of day', 0, 23.99, 0.25, () => g.env.hours, (v) => { g.env.hours = v; }, (v) => fmtTime(v));
    this._buttons(s, [['Dawn', run('time 5.5')], ['Noon', run('time 12')], ['Dusk', run('time 20')], ['Night', run('time 23')], ['Horde time', run('time 21.95')]]);
    this._slider(s, 'Day', 1, 30, 1, () => g.env.day, (v) => { g.env.day = v; }, (v) => `day ${v}`);
    this._slider(s, 'Game speed', 0.1, 10, 0.1, () => c.timeScale, (v) => { c.timeScale = v; }, (v) => `×${Number(v).toFixed(1)}`);
    this._toggle(s, 'Freeze clock', () => c.freezeTime, (v) => { c.freezeTime = v; });
    this._buttons(s, [['Respawn trees & rocks', run('respawnnodes')], ['Refill all loot', run('refillloot')]]);
    this._buttons(s, [['Save', run('save')], ['Load', run('load')], ['Delete save', () => { if (window.confirm('Delete the saved game?')) this._run('wipesave'); }, 'danger']]);

    // --- zombies
    s = this._section('Zombies', false);
    this._toggle(s, "Zombies ignore me", () => c.noTarget, (v) => { c.noTarget = v; }, "can't see or hear you");
    this._toggle(s, 'Freeze all zombies', () => c.freezeAI, (v) => { c.freezeAI = v; });
    this._toggle(s, 'Disable natural spawns & hordes', () => c.noSpawn, (v) => { c.noSpawn = v; });
    this._toggle(s, 'Show zombies on map', () => g.map.showZombies, (v) => { g.map.showZombies = v; });
    this._slider(s, 'Max zombies', 0, 120, 5, () => g.settings.maxZombies, (v) => { g.settings.maxZombies = v; }, (v) => v);
    let spawnN = 5, spawnD = 12, hordeN = 15;
    this._slider(s, 'Spawn count', 1, 40, 1, () => spawnN, (v) => { spawnN = v; });
    this._slider(s, 'Spawn distance', 3, 60, 1, () => spawnD, (v) => { spawnD = v; }, (v) => `${v} m`);
    this._slider(s, 'Horde size', 5, 80, 5, () => hordeN, (v) => { hordeN = v; });
    this._buttons(s, [['Spawn in front', () => this._run(`spawn ${spawnN} ${spawnD}`)], ['Send horde', () => this._run(`horde ${hordeN}`)], ['Make noise (60 m)', run('noise 60')]]);
    this._buttons(s, [['Kill all', run('killall'), 'warn'], ['Remove all + corpses', run('clearzombies'), 'warn']]);
    this._readout(s, () => this.commands.get('zombies').run(['8']), 'dp-readout dp-small dp-pre');

    // --- debug views
    s = this._section('Debug views', false);
    const view = (label, key, hint) => this._toggle(s, label, () => dbg[key], (v) => { dbg[key] = v; if (!v) dbg.clear(key); }, hint);
    view('Physics colliders', 'colliders', 'grey static · green nodes · yellow loot · blue base · pink deployables');
    view('Zombie hitboxes', 'hitboxes', 'red head · orange thorax · yellow stomach · blue legs');
    view('Zombie AI state & targets', 'ai', 'grey idle · blue wander · yellow investigate · red chase · orange bash');
    view('Noise rings', 'noise', 'green quiet · yellow loud · red gunshots');
    view('Bullet paths', 'bullets');
    this._buttons(s, [['All on', run('debugall on')], ['All off', run('debugall off')]]);
  }

  toggle(force) {
    this.open = force !== undefined ? force : !this.open;
    this.root.style.display = this.open ? 'flex' : 'none';
    if (this.open) {
      if (document.pointerLockElement) document.exitPointerLock();
      if (this.errorCount) this.consoleSection.open = true; // show new errors
      this.errorCount = 0;
      this._renderBadge();
      this._sync();
      this.logEl.scrollTop = this.logEl.scrollHeight;
    } else {
      if (this.root.contains(document.activeElement)) document.activeElement.blur();
      const g = this.game;
      if (g.running && !g.ui.inventoryOpen && g.player.alive && !g.input.padActive) g.lock();
    }
  }

  log(text, cls = 'out') {
    this.lines.push({ text: String(text), cls });
    if (this.lines.length > 400) this.lines.shift();
    const d = document.createElement('div');
    d.className = `dc-${cls}`;
    d.textContent = String(text);
    this.logEl.appendChild(d);
    while (this.logEl.children.length > 400) this.logEl.firstChild.remove();
    this.logEl.scrollTop = this.logEl.scrollHeight;
    if ((cls === 'err' || cls === 'warn') && !this.open) {
      this.errorCount++;
      this._renderBadge();
    }
  }

  _renderBadge() {
    this.badge.style.display = this.errorCount ? 'block' : 'none';
    this.badge.textContent = `${this.errorCount} error${this.errorCount > 1 ? 's' : ''}/warning${this.errorCount > 1 ? 's' : ''} — press \` to view`;
  }

  _captureErrors() {
    const orig = { error: console.error.bind(console), warn: console.warn.bind(console) };
    console.error = (...a) => { orig.error(...a); this.log(a.map(String).join(' '), 'err'); };
    console.warn = (...a) => { orig.warn(...a); this.log(a.map(String).join(' '), 'warn'); };
    window.addEventListener('error', (e) => this.log(`${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`, 'err'));
    window.addEventListener('unhandledrejection', (e) => this.log(`Unhandled promise rejection: ${e.reason}`, 'err'));
  }

  // ------------------------------------------------------------------ commands
  cmd(name, args, help, run, complete = null) {
    this.commands.set(name, { name, args, help, run, complete });
  }

  exec(text) {
    this.log(`> ${text}`, 'cmd');
    if (this.history[this.history.length - 1] !== text) this.history.push(text);
    if (this.history.length > 100) this.history.shift();
    this.histIdx = this.history.length;
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(this.history)); } catch { /* ignore */ }
    // Allow several commands separated by ';'
    if (!text.startsWith('js ') && text.includes(';')) {
      for (const part of text.split(';').map((s) => s.trim()).filter(Boolean)) this._run(part);
      return;
    }
    this._run(text);
  }

  _run(text) {
    const [name, ...args] = text.split(/\s+/);
    const c = this.commands.get(name.toLowerCase());
    if (!c) { this.log(`Unknown command "${name}". Type "help".`, 'err'); return; }
    try {
      const res = c.run(args, text.slice(name.length).trim());
      if (res !== undefined && res !== null) this.log(res);
    } catch (e) {
      this.log(`${name}: ${e.message}`, 'err');
    }
  }

  _candidates(value) {
    const parts = value.split(/\s+/);
    if (parts.length <= 1) return [...this.commands.keys()].filter((k) => k.startsWith(parts[0].toLowerCase())).sort();
    const c = this.commands.get(parts[0].toLowerCase());
    if (!c || !c.complete) return [];
    const list = c.complete(parts.length - 2) || [];
    const partial = parts[parts.length - 1].toLowerCase();
    return list.filter((x) => x.toLowerCase().startsWith(partial));
  }

  _complete() {
    const v = this.inputEl.value;
    const cands = this._candidates(v);
    if (!cands.length) return;
    const parts = v.split(/\s+/);
    // Longest common prefix
    let pre = cands[0];
    for (const c of cands) while (!c.startsWith(pre)) pre = pre.slice(0, -1);
    parts[parts.length - 1] = cands.length === 1 ? cands[0] + ' ' : pre;
    this.inputEl.value = parts.join(' ');
    this._suggest(this.inputEl.value);
  }

  _suggest(v) {
    if (!v) { this.suggestEl.textContent = ''; return; }
    const parts = v.split(/\s+/);
    const c = this.commands.get(parts[0].toLowerCase());
    if (c && parts.length > 1) {
      const cands = this._candidates(v);
      this.suggestEl.textContent = `${c.name} ${c.args}  —  ${c.help}${cands.length ? '   [' + cands.slice(0, 12).join(', ') + (cands.length > 12 ? ', …' : '') + ']' : ''}`;
    } else {
      this.suggestEl.textContent = this._candidates(v).slice(0, 16).join('  ');
    }
  }

  _registerCommands() {
    const g = this.game;
    const num = (v, d) => (v === undefined || v === '' || isNaN(Number(v)) ? d : Number(v));
    const onOff = (v, cur) => (v === undefined ? !cur : ['1', 'on', 'true', 'yes'].includes(String(v).toLowerCase()));
    const cheat = (key, label) => (a) => { g.cheats[key] = onOff(a[0], g.cheats[key]); return `${label}: ${g.cheats[key] ? 'ON' : 'OFF'}`; };
    const itemIds = () => Object.keys(ITEMS);
    const p = () => g.player;
    const give = (id, qty) => {
      const def = ITEMS[id];
      if (!def) throw new Error(`no item "${id}" (try "items")`);
      const left = g.inventory.add(id, qty, def.gun ? { mag: def.gun.mag } : null);
      if (left > 0) g.dropItems([{ id, qty: left }]);
      return `Gave ${qty} × ${def.name}${left ? ` (${left} dropped, inventory full)` : ''}`;
    };

    // --- general
    this.cmd('help', '[command]', 'List commands or show help for one', (a) => {
      if (a[0]) {
        const c = this.commands.get(a[0]);
        return c ? `${c.name} ${c.args}\n  ${c.help}` : `No command "${a[0]}"`;
      }
      const groups = {};
      for (const c of this.commands.values()) (groups[c.group] = groups[c.group] || []).push(c);
      for (const [grp, cmds] of Object.entries(groups)) {
        this.log(`— ${grp} —`, 'info');
        for (const c of cmds) this.log(`  ${(c.name + ' ' + c.args).padEnd(30)} ${c.help}`);
      }
      return null;
    }, () => [...this.commands.keys()]);
    this.cmd('clear', '', 'Clear the console', () => { this.logEl.innerHTML = ''; this.lines = []; });
    this.cmd('stats', '[on|off]', 'Toggle the live stats overlay (also F3)', (a) => { this.statsOn = onOff(a[0], this.statsOn); this.statsEl.style.display = this.statsOn ? 'block' : 'none'; return `Stats overlay ${this.statsOn ? 'on' : 'off'}`; });
    this.cmd('info', '', 'Print a snapshot of game state', () => this.statsText());
    this.cmd('js', '<code>', 'Evaluate JavaScript (game is in scope)', (a, raw) => {
      const r = new Function('game', 'THREE', `return (${raw});`)(g, THREE);
      try { return typeof r === 'object' ? JSON.stringify(r, null, 1).slice(0, 2000) : String(r); } catch { return String(r); }
    });

    // --- player
    this.cmd('god', '[on|off]', 'Invulnerability (no damage, no hunger/thirst loss)', cheat('god', 'God mode'));
    this.cmd('noclip', '[on|off]', 'Fly through everything (WASD, Space up, Ctrl down, Shift fast)', cheat('noclip', 'Noclip'));
    this.cmd('speed', '<mult>', 'Movement speed multiplier (default 1)', (a) => { g.cheats.speed = num(a[0], 1); return `Speed ×${g.cheats.speed}`; });
    this.cmd('heal', '', 'Full health, food, water and stamina; stop bleeding', () => {
      Object.assign(p(), { health: 100, food: 100, water: 100, stamina: 100, bleeding: false });
      return 'Healed.';
    });
    this.cmd('cure', '', 'Remove the zombie infection', () => { p().infection = 0; return 'Infection cured.'; });
    this.cmd('infect', '[0-1]', 'Set infection progress (0.4 = nauseous, 0.7 = fever, 1 = death)', (a) => { p().infection = Math.max(0.0001, Math.min(1, num(a[0], 0.0001))); return `Infection ${(p().infection * 100).toFixed(0)}%`; });
    this.cmd('bleed', '', 'Start bleeding', () => { p().bleeding = true; return 'Bleeding.'; });
    this.cmd('sethp', '<0-100>', 'Set health', (a) => { p().health = num(a[0], 100); return `Health ${p().health}`; });
    this.cmd('setstat', '<food|water|stamina> <0-100>', 'Set a survival stat', (a) => {
      if (!['food', 'water', 'stamina'].includes(a[0])) throw new Error('stat must be food, water or stamina');
      p()[a[0]] = num(a[1], 100); return `${a[0]} = ${p()[a[0]]}`;
    }, (i) => (i === 0 ? ['food', 'water', 'stamina'] : []));
    this.cmd('kill', '', 'Kill yourself (tests death/backpack/respawn)', () => { g.damagePlayer(9999, 'status'); return 'You died.'; });
    this.cmd('pos', '', 'Print position, facing and terrain height', () => {
      const pp = p().pos;
      return `x ${pp.x.toFixed(1)}  y ${pp.y.toFixed(2)}  z ${pp.z.toFixed(1)}  yaw ${(p().yaw * 57.3 % 360).toFixed(0)}°  terrain ${g.terrain.heightAt(pp.x, pp.z).toFixed(2)}  zone ${this.zoneName()}`;
    });
    this.cmd('tp', '<x z | town | military | beach | bag | base>', 'Teleport', (a) => {
      let x, z;
      const where = (a[0] || '').toLowerCase();
      if (where === 'town') ({ x, z } = g.terrain.town);
      else if (where === 'military') ({ x, z } = g.terrain.military);
      else if (where === 'beach') ({ x, z } = g.terrain.beachSpawn());
      else if (where === 'bag') {
        const b = g.building.spawnBag;
        if (!b) throw new Error('no sleeping bag placed');
        ({ x, z } = b);
      } else if (where === 'base') {
        const pc = g.building.pieces.find((q) => q.type === 'foundation');
        if (!pc) throw new Error('no foundations built');
        x = pc.center.x; z = pc.center.z - 4;
      } else if (a.length >= 2) { x = num(a[0]); z = num(a[1]); }
      else throw new Error('usage: tp <x> <z> | town | military | beach | bag | base');
      p().teleport(x, z);
      return `Teleported to ${x.toFixed(1)}, ${z.toFixed(1)}`;
    }, (i) => (i === 0 ? ['town', 'military', 'beach', 'bag', 'base'] : []));

    // --- items
    this.cmd('give', '<item> [qty]', 'Give an item (guns come loaded)', (a) => give(a[0], Math.max(1, Math.floor(num(a[1], 1)))), (i) => (i === 0 ? itemIds() : []));
    this.cmd('kit', '<starter|builder|guns|smelt|survival>', 'Give a bundle of items', (a) => {
      const kit = KITS[a[0]];
      if (!kit) throw new Error(`kits: ${Object.keys(KITS).join(', ')}`);
      for (const [id, n] of Object.entries(kit)) give(id, n);
      return `Kit "${a[0]}" given.`;
    }, (i) => (i === 0 ? Object.keys(KITS) : []));
    this.cmd('items', '[filter]', 'List item ids', (a) => itemIds().filter((k) => !a[0] || k.includes(a[0]) || ITEMS[k].name.toLowerCase().includes(a[0].toLowerCase())).map((k) => `${k.padEnd(14)} ${ITEMS[k].name}`).join('\n'));
    this.cmd('clearinv', '', 'Empty your inventory', () => { g.inventory.clear(); return 'Inventory cleared.'; });
    this.cmd('ammo', '[on|off]', 'Infinite ammo (magazine never empties)', cheat('infiniteAmmo', 'Infinite ammo'));
    this.cmd('freebuild', '[on|off]', 'Build, upgrade, repair and craft without paying resources', cheat('freeBuild', 'Free build'));
    this.cmd('instacraft', '[on|off]', 'Crafting completes instantly', cheat('instaCraft', 'Instant crafting'));

    // --- world & time
    this.cmd('time', '<hour>', 'Set time of day (0-24, e.g. 22 for night)', (a) => { g.env.hours = ((num(a[0], 12) % 24) + 24) % 24; return `Time ${fmtTime(g.env.hours)}`; });
    this.cmd('day', '<n>', 'Set day number (affects zombie counts and horde size)', (a) => { g.env.day = Math.max(1, Math.floor(num(a[0], 1))); return `Day ${g.env.day}`; });
    this.cmd('timescale', '<x>', 'Game speed multiplier (0.1 – 10)', (a) => { g.cheats.timeScale = Math.max(0.05, Math.min(10, num(a[0], 1))); return `Timescale ×${g.cheats.timeScale}`; });
    this.cmd('freezetime', '[on|off]', 'Stop the day/night clock', cheat('freezeTime', 'Time frozen'));
    this.cmd('respawnnodes', '', 'Respawn all trees, rocks, barrels and hemp', () => {
      let n = 0;
      for (const node of g.world.nodes) if (!node.alive) { g.world._showNode(node, true); n++; }
      return `Respawned ${n} nodes.`;
    });
    this.cmd('refillloot', '', 'Re-roll every loot container in the world', () => {
      for (const s of g.world.lootSpots) s.refill();
      return `Refilled ${g.world.lootSpots.length} containers.`;
    });
    this.cmd('save', '', 'Save now', () => { g.save(); return 'Saved.'; });
    this.cmd('load', '', 'Load the last save', () => (g.load() ? 'Loaded.' : 'No save found.'));
    this.cmd('wipesave', '', 'Delete the saved game from this browser', () => { localStorage.removeItem('rotrust_save_v1'); return 'Save deleted.'; });

    // --- zombies
    this.cmd('spawn', '[count] [distance]', 'Spawn zombies in front of you', (a) => {
      const n = Math.max(1, Math.floor(num(a[0], 1))), d = num(a[1], 10);
      const fx = -Math.sin(p().yaw), fz = -Math.cos(p().yaw);
      const c = { x: p().pos.x + fx * d, z: p().pos.z + fz * d };
      return `Spawned ${g.zombies.trySpawn(c, n)} zombie(s).`;
    });
    this.cmd('horde', '[size]', 'Send a horde at you from ~70 m away', (a) => {
      const ang = Math.random() * Math.PI * 2;
      const c = { x: p().pos.x + Math.cos(ang) * 70, z: p().pos.z + Math.sin(ang) * 70 };
      return `Horde of ${g.zombies.trySpawn(c, Math.floor(num(a[0], 15)), p().pos)} incoming.`;
    });
    this.cmd('killall', '[radius]', 'Kill all zombies (optionally within radius)', (a) => {
      const r = num(a[0], Infinity);
      let n = 0;
      for (const z of g.zombies.list) if (z.alive && Math.hypot(z.pos.x - p().pos.x, z.pos.z - p().pos.z) <= r) { g.zombies.kill(z); n++; }
      return `Killed ${n}.`;
    });
    this.cmd('clearzombies', '', 'Remove all zombies and corpses', () => { const n = g.zombies.list.length; g.zombies.clear(); return `Removed ${n}.`; });
    this.cmd('notarget', '[on|off]', 'Zombies cannot see or hear you', cheat('noTarget', 'No target'));
    this.cmd('freezeai', '[on|off]', 'Freeze all zombies in place', cheat('freezeAI', 'AI frozen'));
    this.cmd('nospawn', '[on|off]', 'Stop natural zombie spawning and hordes', cheat('noSpawn', 'Natural spawning disabled'));
    this.cmd('zombies', '[n]', 'List the nearest zombies with state, HP and distance', (a) => {
      const pp = p().pos;
      const list = g.zombies.list.filter((z) => z.alive).map((z) => ({ z, d: Math.hypot(z.pos.x - pp.x, z.pos.z - pp.z) })).sort((x, y) => x.d - y.d).slice(0, num(a[0], 10));
      if (!list.length) return 'No zombies alive.';
      return list.map(({ z, d }) => `#${z.id} ${z.state.padEnd(11)} ${d.toFixed(1).padStart(6)} m  hp ${Math.round(z.hp)}  legs ${Math.round(z.legHp)}${z.crawling ? ' crawling' : ''}${z.speedMul > 1.5 ? ' FAST' : ''}${z.seesPlayer ? ' sees-you' : ''}`).join('\n');
    });
    this.cmd('noise', '<radius>', 'Make a noise at your position (attracts zombies)', (a) => { g.makeNoise(p().pos.x, p().pos.z, num(a[0], 50)); return `Noise radius ${num(a[0], 50)} m`; });

    // --- inspection & visualisation
    this.cmd('look', '', 'Describe what is under the crosshair', () => {
      const cam = g.camera, d = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion), o = cam.position;
      const zh = g.zombies.raycast(o, d, 200, true);
      const hit = g.physics.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 200, { solidOnly: false });
      if (zh && (!hit || zh.t < hit.dist)) return `Zombie #${zh.zombie.id} ${zh.zombie.alive ? `part ${zh.part}, state ${zh.zombie.state}, hp ${Math.round(zh.zombie.hp)}` : '(corpse)'} at ${zh.t.toFixed(1)} m`;
      if (!hit) return 'Nothing within 200 m.';
      if (hit.terrain) return `Terrain at ${hit.dist.toFixed(1)} m (x ${hit.x.toFixed(1)}, y ${hit.y.toFixed(2)}, z ${hit.z.toFixed(1)})`;
      const b = hit.box, o2 = b.owner || {};
      let desc = `${b.kind}${b.solid ? '' : ' (non-solid)'} at ${hit.dist.toFixed(1)} m`;
      if (o2.kind === 'node') desc += ` — ${o2.type}, amount ${o2.amount}${o2.hp ? `, hp ${o2.hp}` : ''}`;
      if (o2.kind === 'piece') desc += ` — ${o2.type} tier ${o2.tier}, hp ${Math.ceil(o2.hp)}/${o2.maxHp}, cell ${o2.i},${o2.j}${o2.axis ? ' ' + o2.axis : ''}, y ${o2.y.toFixed(2)}`;
      if (o2.kind === 'loot') desc += ` — ${o2.name} (${o2.table}), ${o2.container.slots.filter(Boolean).length} stacks`;
      if (o2.kind === 'deploy') desc += ` — ${o2.name}${o2.on ? ' (lit)' : ''}`;
      return desc + `  box [${[b.minX, b.minY, b.minZ].map((v) => v.toFixed(1))}]–[${[b.maxX, b.maxY, b.maxZ].map((v) => v.toFixed(1))}]`;
    });
    const vis = (key, label) => (a) => { this.debug[key] = onOff(a[0], this.debug[key]); if (!this.debug[key]) this.debug.clear(key); return `${label}: ${this.debug[key] ? 'ON' : 'OFF'}`; };
    this.cmd('showcolliders', '[on|off]', 'Draw physics boxes near you (colour = kind)', vis('colliders', 'Collider debug'));
    this.cmd('showhitboxes', '[on|off]', 'Draw zombie hit spheres (head/thorax/stomach/legs)', vis('hitboxes', 'Hitbox debug'));
    this.cmd('showai', '[on|off]', 'Draw zombie state markers and lines to their targets', vis('ai', 'AI debug'));
    this.cmd('shownoise', '[on|off]', 'Draw rings for every noise zombies can hear', vis('noise', 'Noise debug'));
    this.cmd('showbullets', '[on|off]', 'Draw bullet trajectories', vis('bullets', 'Bullet debug'));
    this.cmd('debugall', '[on|off]', 'Toggle every visualisation and the stats overlay', (a) => {
      const on = onOff(a[0], !this.debug.colliders);
      for (const k of ['colliders', 'hitboxes', 'ai', 'noise', 'bullets']) { this.debug[k] = on; if (!on) this.debug.clear(k); }
      this.statsOn = on; this.statsEl.style.display = on ? 'block' : 'none';
      return `All debug views ${on ? 'ON' : 'OFF'}`;
    });
    this.cmd('mapzombies', '[on|off]', 'Show zombies on the map (M)', (a) => { g.map.showZombies = onOff(a[0], g.map.showZombies); g.map.draw(); return `Zombies on map: ${g.map.showZombies ? 'ON' : 'OFF'}`; });
    this.cmd('recipes', '', 'List crafting recipes', () => RECIPES.map((r) => `${r.id.padEnd(14)} ×${r.qty}  ${r.time}s  ${Object.entries(r.cost).map(([k, v]) => `${v} ${k}`).join(', ')}`).join('\n'));

    // Assign groups for help output
    const groups = {
      General: ['help', 'clear', 'stats', 'info', 'js'],
      Player: ['god', 'noclip', 'speed', 'heal', 'cure', 'infect', 'bleed', 'sethp', 'setstat', 'kill', 'pos', 'tp'],
      Items: ['give', 'kit', 'items', 'recipes', 'clearinv', 'ammo', 'freebuild', 'instacraft'],
      'World & time': ['time', 'day', 'timescale', 'freezetime', 'respawnnodes', 'refillloot', 'save', 'load', 'wipesave'],
      Zombies: ['spawn', 'horde', 'killall', 'clearzombies', 'notarget', 'freezeai', 'nospawn', 'zombies', 'noise'],
      Debug: ['look', 'mapzombies', 'showcolliders', 'showhitboxes', 'showai', 'shownoise', 'showbullets', 'debugall'],
    };
    for (const [grp, names] of Object.entries(groups)) for (const n of names) if (this.commands.has(n)) this.commands.get(n).group = grp;
    for (const c of this.commands.values()) c.group = c.group || 'Other';
  }

  // ------------------------------------------------------------------ stats
  zoneName() {
    const pp = this.game.player.pos, t = this.game.terrain;
    if (Math.hypot(pp.x - t.town.x, pp.z - t.town.z) < t.town.r) return 'town';
    if (Math.hypot(pp.x - t.military.x, pp.z - t.military.z) < t.military.r) return 'military';
    return t.heightAt(pp.x, pp.z) < 0 ? 'water' : 'wilderness';
  }

  statsText() {
    const g = this.game, p = g.player, t = this.timing, info = g.renderer.info;
    const z = g.zombies.list;
    const alive = z.filter((q) => q.alive);
    const by = {};
    for (const q of alive) by[q.state] = (by[q.state] || 0) + 1;
    const nearest = alive.reduce((m, q) => Math.min(m, Math.hypot(q.pos.x - p.pos.x, q.pos.z - p.pos.z)), Infinity);
    const tiers = [0, 0, 0, 0];
    for (const pc of g.building.pieces) if (pc.type !== 'door') tiers[pc.tier]++;
    const cheats = Object.entries(g.cheats).filter(([k, v]) => v && !(k === 'speed' && v === 1) && !(k === 'timeScale' && v === 1)).map(([k, v]) => (v === true ? k : `${k}=${v}`));
    const mem = performance.memory ? `  heap ${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)} MB` : '';
    return [
      `FPS ${t.fps.toFixed(0)}  frame ${t.frame.toFixed(1)} ms  update ${t.update.toFixed(2)} ms  render ${t.render.toFixed(1)} ms${mem}`,
      `draw calls ${info.render.calls}  triangles ${(info.render.triangles / 1000).toFixed(0)}k  geometries ${info.memory.geometries}  textures ${info.memory.textures}`,
      `pos ${p.pos.x.toFixed(1)}, ${p.pos.y.toFixed(1)}, ${p.pos.z.toFixed(1)}  zone ${this.zoneName()}  speed ${p.speedNow.toFixed(1)} m/s${p.onGround ? '' : ' (air)'}${p.swimming ? ' (swim)' : ''}`,
      `Day ${g.env.day} ${fmtTime(g.env.hours)}${g.env.isNight ? ' NIGHT' : ''}  timescale ×${g.cheats.timeScale}`,
      `HP ${p.health.toFixed(0)}  food ${p.food.toFixed(0)}  water ${p.water.toFixed(0)}  stam ${p.stamina.toFixed(0)}${p.bleeding ? '  BLEEDING' : ''}${p.infection > 0 ? `  infection ${(p.infection * 100).toFixed(0)}%` : ''}`,
      `zombies ${alive.length}/${g.zombies.targetCount()} target  ${Object.entries(by).map(([k, v]) => `${k} ${v}`).join('  ')}  corpses ${z.length - alive.length}  nearest ${isFinite(nearest) ? nearest.toFixed(0) + ' m' : '—'}  kills ${g.stats.kills}`,
      `build pieces ${g.building.pieces.length} (twig ${tiers[0]} wood ${tiers[1]} stone ${tiers[2]} metal ${tiers[3]})  deployables ${g.building.deployables.length}  bags ${g.bags.length}`,
      `bullets ${g.combat.bullets.length}  craft queue ${g.crafting.queue.length}  held ${g.combat.def ? g.combat.def.name : 'hands'}${g.combat.item && g.combat.item.mag !== undefined ? ` (mag ${g.combat.item.mag})` : ''}`,
      `input ${g.input.lastDevice}${g.input.pad.connected ? `  pad "${g.input.pad.id.slice(0, 32)}"` : ''}  pointer lock ${document.pointerLockElement ? 'yes' : 'no'}`,
      cheats.length ? `cheats: ${cheats.join(', ')}` : 'cheats: none',
    ].join('\n');
  }

  // Called once per real frame by the game loop.
  frame(dt, updateMs, renderMs) {
    const t = this.timing;
    t.update = t.update * 0.9 + updateMs * 0.1;
    t.render = t.render * 0.9 + renderMs * 0.1;
    t.frame = t.frame * 0.9 + dt * 1000 * 0.1;
    this._fpsFrames++;
    this._fpsT += dt;
    if (this._fpsT >= 0.5) { t.fps = this._fpsFrames / this._fpsT; this._fpsFrames = 0; this._fpsT = 0; }
    this._statsT -= dt;
    if (this.statsOn && this._statsT <= 0) {
      this._statsT = 0.25;
      this.statsEl.textContent = this.statsText();
    }
    this._guiT = (this._guiT || 0) - dt;
    if (this.open && this._guiT <= 0) {
      this._guiT = 0.25;
      this._sync();
    }
    this.debug.update(dt);
  }
}

// ------------------------------------------------------------------ debug drawing
class DebugDraw {
  constructor(game) {
    this.game = game;
    this.colliders = false;
    this.hitboxes = false;
    this.ai = false;
    this.noise = false;
    this.bullets = false;
    const mk = (max) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
      geo.setDrawRange(0, 0);
      const l = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }));
      l.frustumCulled = false;
      l.renderOrder = 999;
      game.scene.add(l);
      return { line: l, max, n: 0 };
    };
    this.layers = { colliders: mk(24 * 1500), hitboxes: mk(64 * 400), ai: mk(8 * 200), noise: mk(64 * 30), bullets: mk(2 * 3000) };
    this.noiseRings = [];
    this.trails = [];
    this._collT = 0;
    this._c = new THREE.Color();
  }

  clear(key) {
    const L = this.layers[key];
    if (!L) return;
    L.n = 0;
    L.line.geometry.setDrawRange(0, 0);
    if (key === 'noise') this.noiseRings = [];
    if (key === 'bullets') this.trails = [];
  }

  _begin(key) { const L = this.layers[key]; L.n = 0; return L; }
  _seg(L, x1, y1, z1, x2, y2, z2, color) {
    if (L.n + 2 > L.max) return;
    const p = L.line.geometry.attributes.position.array, c = L.line.geometry.attributes.color.array;
    this._c.setHex(color);
    const i = L.n * 3;
    p[i] = x1; p[i + 1] = y1; p[i + 2] = z1; p[i + 3] = x2; p[i + 4] = y2; p[i + 5] = z2;
    c[i] = c[i + 3] = this._c.r; c[i + 1] = c[i + 4] = this._c.g; c[i + 2] = c[i + 5] = this._c.b;
    L.n += 2;
  }
  _end(L) {
    L.line.geometry.setDrawRange(0, L.n);
    L.line.geometry.attributes.position.needsUpdate = true;
    L.line.geometry.attributes.color.needsUpdate = true;
  }
  _box(L, b, color) {
    const xs = [b.minX, b.maxX], ys = [b.minY, b.maxY], zs = [b.minZ, b.maxZ];
    for (const y of ys) for (const z of zs) this._seg(L, xs[0], y, z, xs[1], y, z, color);
    for (const x of xs) for (const z of zs) this._seg(L, x, ys[0], z, x, ys[1], z, color);
    for (const x of xs) for (const y of ys) this._seg(L, x, y, zs[0], x, y, zs[1], color);
  }
  _circle(L, x, y, z, r, color, axis = 'y', segs = 16) {
    for (let k = 0; k < segs; k++) {
      const a0 = (k / segs) * Math.PI * 2, a1 = ((k + 1) / segs) * Math.PI * 2;
      if (axis === 'y') this._seg(L, x + Math.cos(a0) * r, y, z + Math.sin(a0) * r, x + Math.cos(a1) * r, y, z + Math.sin(a1) * r, color);
      else this._seg(L, x + Math.cos(a0) * r, y + Math.sin(a0) * r, z, x + Math.cos(a1) * r, y + Math.sin(a1) * r, z, color);
    }
  }

  onNoise(x, z, radius) {
    if (!this.noise) return;
    const y = this.game.player.pos.y + 0.2;
    this.noiseRings.push({ x, y, z, r: radius, t: 1.6 });
    if (this.noiseRings.length > 25) this.noiseRings.shift();
  }

  onBullet(x1, y1, z1, x2, y2, z2) {
    if (!this.bullets) return;
    this.trails.push({ a: [x1, y1, z1], b: [x2, y2, z2], t: 3 });
    if (this.trails.length > 2500) this.trails.shift();
  }

  update(dt) {
    const g = this.game, pp = g.player.pos;
    if (this.colliders) {
      this._collT -= dt;
      if (this._collT <= 0) {
        this._collT = 0.2;
        const L = this._begin('colliders');
        const R = 22;
        for (const b of g.physics.query(pp.x - R, pp.z - R, pp.x + R, pp.z + R)) {
          let col = KIND_COLORS[b.kind] || 0xffffff;
          if (!b.solid) col = 0x406040;
          this._box(L, b, col);
        }
        this._end(L);
      }
    }
    if (this.hitboxes) {
      const L = this._begin('hitboxes');
      const colors = { head: 0xff4040, thorax: 0xffa040, stomach: 0xffe040, legs: 0x40c0ff };
      for (const z of g.zombies.list) {
        if (!z.alive || Math.hypot(z.pos.x - pp.x, z.pos.z - pp.z) > 45) continue;
        for (const s of z.hitSpheres()) {
          this._circle(L, s.x, s.y, s.z, s.r, colors[s.name], 'y', 10);
          this._circle(L, s.x, s.y, s.z, s.r, colors[s.name], 'z', 10);
        }
      }
      this._end(L);
    }
    if (this.ai) {
      const L = this._begin('ai');
      for (const z of g.zombies.list) {
        if (!z.alive || Math.hypot(z.pos.x - pp.x, z.pos.z - pp.z) > 90) continue;
        const col = STATE_COLORS[z.state] || 0xffffff;
        const top = z.pos.y + 2.1;
        this._seg(L, z.pos.x, top, z.pos.z, z.pos.x, top + 0.6, z.pos.z, col);
        if (z.seesPlayer) this._seg(L, z.pos.x, z.pos.y + 1.6, z.pos.z, pp.x, pp.y + 1.5, pp.z, 0xff0000);
        const tgt = z.state === 'bash' && z.bashTarget ? z.bashTarget.center : z.target;
        if (tgt && z.state !== 'idle') this._seg(L, z.pos.x, top, z.pos.z, tgt.x, (tgt.y ?? z.pos.y) + 0.3, tgt.z, col);
      }
      this._end(L);
    }
    if (this.noise) {
      const L = this._begin('noise');
      for (let i = this.noiseRings.length - 1; i >= 0; i--) {
        const r = this.noiseRings[i];
        r.t -= dt;
        if (r.t <= 0) { this.noiseRings.splice(i, 1); continue; }
        this._circle(L, r.x, r.y, r.z, r.r, r.r > 60 ? 0xff5050 : r.r > 12 ? 0xffd050 : 0x80ff80, 'y', 48);
      }
      this._end(L);
    }
    if (this.bullets) {
      const L = this._begin('bullets');
      for (let i = this.trails.length - 1; i >= 0; i--) {
        const tr = this.trails[i];
        tr.t -= dt;
        if (tr.t <= 0) { this.trails.splice(i, 1); continue; }
        this._seg(L, ...tr.a, ...tr.b, 0xffe080);
      }
      this._end(L);
    }
  }
}
