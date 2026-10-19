import { ITEMS, RECIPES } from './items.js';
import { fmtTime } from './util.js';

const $ = (id) => document.getElementById(id);

// Button names shown in prompts for keyboard/mouse and for controllers.
const KEY_LABELS = { LMB: 'LMB', RMB: 'RMB', E: 'E', R: 'R', T: 'T', B: 'B', F: 'F', X: 'X', Tab: 'Tab' };
const PAD_LABELS = { LMB: 'RT', RMB: 'LT', E: 'Ⓧ', R: 'D-pad →', T: 'D-pad ↓', B: 'R3', F: 'D-pad ↑', X: 'D-pad ←', Tab: 'Ⓨ' };

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export class UI {
  constructor(game) {
    this.game = game;
    this.inventoryOpen = false;
    this.lastClosed = -1e9;
    this.openTarget = null;
    this.openC = null;
    this.drag = null;
    this._buildInfoSet = false;
    this._promptSet = false;
    this.pickups = new Map();
    this.craftCat = 'Tools';

    this.hotbarEl = $('hotbar');
    this.hotbarSlots = [];
    for (let i = 0; i < 6; i++) {
      const s = el('div', 'slot');
      s.dataset.n = String(i + 1);
      this.hotbarEl.appendChild(s);
      this.hotbarSlots.push(s);
    }

    // Inventory panel slots
    this.invGrid = $('inv-grid');
    this.invHot = $('inv-hotbar');
    this.invSlotEls = [];
    for (let i = 0; i < 30; i++) {
      const s = el('div', 'slot');
      s.dataset.c = 'inv';
      s.dataset.i = String(i);
      (i < 6 ? this.invHot : this.invGrid).appendChild(s);
      this.invSlotEls[i] = s;
    }
    this.contPanel = $('container-panel');
    this.contGrid = $('cont-grid');
    this.contTitle = $('cont-title');
    this.contToggle = $('cont-toggle');
    this.contTakeAll = $('cont-takeall');
    this.contToggle.onclick = () => {
      if (this.openTarget && this.openTarget.toggle) this.openTarget.toggle();
      this.refresh();
    };
    this.contTakeAll.onclick = () => this.takeAll();

    this._buildCraftUI();
    this._bindDrag();
    this.ghost = $('drag-ghost');
  }

  key(name) {
    return (this.game.input.lastDevice === 'pad' ? PAD_LABELS : KEY_LABELS)[name] || name;
  }

  // ------------------------------------------------------------------ per-frame helpers
  beginFrame() {
    this._buildInfoSet = false;
    this._promptSet = false;
  }

  endFrame() {
    if (!this._buildInfoSet) $('buildinfo').style.display = 'none';
    if (!this._promptSet) $('prompt').style.display = 'none';
  }

  prompt(text) {
    this._promptSet = true;
    const p = $('prompt');
    p.style.display = 'block';
    p.textContent = text;
  }

  buildInfo(title, error, hint) {
    this._buildInfoSet = true;
    const b = $('buildinfo');
    b.style.display = 'block';
    b.innerHTML = `<div class="bi-title">${title}</div>${error ? `<div class="bi-err">${error}</div>` : ''}<div class="bi-hint">${hint}</div>`;
  }

  progress(frac, text) {
    const p = $('progress');
    if (frac < 0) { p.style.display = 'none'; return; }
    p.style.display = 'block';
    p.querySelector('.fill').style.width = `${Math.min(1, frac) * 100}%`;
    p.querySelector('.label').textContent = text;
  }

  message(text, type = 'info') {
    const box = $('messages');
    const m = el('div', `msg ${type}`, text);
    box.appendChild(m);
    setTimeout(() => m.classList.add('fade'), 3200);
    setTimeout(() => m.remove(), 4000);
    while (box.children.length > 6) box.firstChild.remove();
  }

  pickup(id, qty) {
    if (qty <= 0) return;
    this.game.audio.play('pickup');
    const box = $('pickups');
    let entry = this.pickups.get(id);
    if (!entry) {
      const e = el('div', 'pickup');
      box.appendChild(e);
      entry = { el: e, qty: 0, timer: null };
      this.pickups.set(id, entry);
    }
    entry.qty += qty;
    entry.el.innerHTML = `<span class="ic">${ITEMS[id].icon}</span> +${entry.qty} ${ITEMS[id].name}`;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => { entry.el.remove(); this.pickups.delete(id); }, 2500);
  }

  hitMarker(head, kill) {
    const h = $('hitmarker');
    h.className = kill ? 'kill' : head ? 'head' : 'hit';
    h.style.opacity = '1';
    clearTimeout(this._hmT);
    this._hmT = setTimeout(() => { h.style.opacity = '0'; }, 120);
  }

  damageFlash(amount) {
    const v = $('vignette');
    v.style.opacity = String(Math.min(0.85, 0.25 + amount / 30));
    clearTimeout(this._dfT);
    this._dfT = setTimeout(() => { v.style.opacity = '0'; }, 160);
  }

  // ------------------------------------------------------------------ HUD
  updateHUD() {
    const g = this.game, p = g.player;
    const bar = (id, v) => { $(id).querySelector('.fill').style.width = `${Math.max(0, Math.min(100, v))}%`; $(id).querySelector('.val').textContent = Math.ceil(v); };
    bar('st-health', p.health);
    bar('st-food', p.food);
    bar('st-water', p.water);
    bar('st-stamina', p.stamina);
    $('clock').textContent = `Day ${g.env.day} · ${fmtTime(g.env.hours)}${g.env.isNight ? ' · NIGHT' : ''}`;
    const mood = [];
    if (p.health < 20) mood.push(['❤', 'Critical', 'bad']);
    else if (p.health < 50) mood.push(['❤', 'Injured', 'warn']);
    if (p.bleeding) mood.push(['🩸', 'Bleeding', 'bad']);
    if (p.food < 10) mood.push(['🍴', 'Starving', 'bad']);
    else if (p.food < 30) mood.push(['🍴', 'Hungry', 'warn']);
    if (p.water < 10) mood.push(['💧', 'Parched', 'bad']);
    else if (p.water < 30) mood.push(['💧', 'Thirsty', 'warn']);
    if (p.stamina < 20) mood.push(['💨', 'Exhausted', 'warn']);
    if (p.infection > 0.7) mood.push(['🤒', 'Fever', 'bad']);
    else if (p.infection > 0.4) mood.push(['🤢', 'Nauseous', 'bad']);
    else if (p.infection > 0.12) mood.push(['😣', 'Queasy', 'warn']);
    const near = g.zombies.list.filter((z) => z.alive && z.state === 'chase' && Math.hypot(z.pos.x - p.pos.x, z.pos.z - p.pos.z) < 14).length;
    if (near >= 3) mood.push(['😱', 'Panicked', 'bad']);
    else if (near > 0) mood.push(['😨', 'Anxious', 'warn']);
    if (g.combat.flashlightOn) mood.push(['🔦', 'Light on (visible)', 'info']);
    $('moodles').innerHTML = mood.map(([i, t, c]) => `<div class="moodle ${c}"><span>${i}</span>${t}</div>`).join('');

    // Crafting queue
    const q = g.crafting.queue;
    $('craft-queue').innerHTML = q.slice(0, 6).map((job, k) =>
      `<div class="cq" data-k="${k}"><span class="ic">${ITEMS[job.recipe.id].icon}</span>${k === 0 ? Math.ceil(job.recipe.time - job.t) + 's' : ''}</div>`).join('') + (q.length > 6 ? `<div class="cq">+${q.length - 6}</div>` : '');

    // Hotbar selection + gun fire mode
    this.hotbarSlots.forEach((s, i) => s.classList.toggle('sel', i === g.combat.slot));
    const def = g.combat.def;
    $('firemode').textContent = def && def.gun ? `${def.name}${def.gun.auto ? ' · ' + (g.combat.autoMode ? 'AUTO' : 'SEMI') : ''}` : '';
    $('crosshair').style.opacity = g.combat.adsAmount > 0.5 || (def && def.gun) ? '0' : '0.8';
  }

  _slotHTML(item) {
    if (!item) return '';
    const def = ITEMS[item.id];
    const qty = def.stack > 1 ? `<span class="qty">${item.qty}</span>` : '';
    return `<span class="ic">${def.icon}</span>${qty}<span class="nm">${def.name}</span>`;
  }

  refreshHotbar() {
    const inv = this.game.inventory;
    for (let i = 0; i < 6; i++) this.hotbarSlots[i].innerHTML = this._slotHTML(inv.slots[i]);
  }

  refresh() {
    this.refreshHotbar();
    if (!this.inventoryOpen) return;
    const inv = this.game.inventory;
    for (let i = 0; i < 30; i++) {
      this.invSlotEls[i].innerHTML = this._slotHTML(inv.slots[i]);
      this.invSlotEls[i].title = inv.slots[i] ? ITEMS[inv.slots[i].id].name : '';
    }
    if (this.openC) {
      const c = this.openC;
      if (this.contGrid.children.length !== c.slots.length) {
        this.contGrid.innerHTML = '';
        for (let i = 0; i < c.slots.length; i++) {
          const s = el('div', 'slot');
          s.dataset.c = 'other';
          s.dataset.i = String(i);
          this.contGrid.appendChild(s);
        }
      }
      for (let i = 0; i < c.slots.length; i++) {
        this.contGrid.children[i].innerHTML = this._slotHTML(c.slots[i]);
        this.contGrid.children[i].title = c.slots[i] ? ITEMS[c.slots[i].id].name : '';
      }
      const t = this.openTarget;
      this.contToggle.style.display = t && t.canToggle ? 'inline-block' : 'none';
      if (t && t.canToggle) this.contToggle.textContent = t.on ? 'Extinguish' : 'Light';
      this.contTitle.textContent = c.name + (t && t.canToggle ? (t.type === 'furnace' ? ' — add wood + ore' : ' — add wood') : '');
    }
    this._refreshCraft();
  }

  // ------------------------------------------------------------------ open / close
  openInventory() {
    this.inventoryOpen = true;
    $('inventory').style.display = 'flex';
    this.contPanel.style.display = this.openC ? 'block' : 'none';
    $('craft-panel').style.display = this.openC ? 'none' : 'block';
    if (document.pointerLockElement) document.exitPointerLock();
    this.refresh();
  }

  openContainer(container, target) {
    this.openC = container;
    this.openTarget = target;
    this.contGrid.innerHTML = '';
    container.onChange = () => this.inventoryOpen && this.refresh();
    this.openInventory();
  }

  closeInventory(relock = true) {
    if (!this.inventoryOpen) return;
    this.inventoryOpen = false;
    this.lastClosed = performance.now();
    $('inventory').style.display = 'none';
    if (this.openC) this.openC.onChange = null;
    if (this.openTarget && this.openTarget.onClose) this.openTarget.onClose(this.game);
    this.openC = null;
    this.openTarget = null;
    this._endDrag();
    if (relock) this.game.lock();
  }

  takeAll() {
    const c = this.openC;
    if (!c) return;
    const inv = this.game.inventory;
    for (let i = 0; i < c.slots.length; i++) {
      const s = c.slots[i];
      if (!s) continue;
      const left = inv.addItem(s);
      if (left > 0) s.qty = left;
      else c.slots[i] = null;
    }
    c.changed();
    this.refresh();
  }

  // ------------------------------------------------------------------ drag & drop
  _containerOf(name) {
    return name === 'inv' ? this.game.inventory : this.openC;
  }

  _bindDrag() {
    const root = $('inventory');
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    root.addEventListener('pointerdown', (e) => {
      const slot = e.target.closest('.slot');
      if (!slot || !slot.dataset.c) return;
      const c = this._containerOf(slot.dataset.c);
      const i = Number(slot.dataset.i);
      const item = c && c.slots[i];
      if (!item) return;
      e.preventDefault();
      if (e.button === 2) {
        this._rightClick(c, i);
        return;
      }
      if (e.shiftKey) {
        this._quickMove(slot.dataset.c, i);
        return;
      }
      this.startDrag(slot, e.ctrlKey, e.clientX, e.clientY);
    });
    window.addEventListener('pointermove', (e) => this.drag && this._moveGhost(e));
    window.addEventListener('pointerup', (e) => {
      if (this.drag) this.dropAt(e.clientX, e.clientY);
    });
  }

  startDrag(slot, split, x, y) {
    const item = this._containerOf(slot.dataset.c).slots[Number(slot.dataset.i)];
    if (!item) return;
    this.drag = { c: slot.dataset.c, i: Number(slot.dataset.i), split };
    this.ghost.innerHTML = this._slotHTML(item);
    this.ghost.style.display = 'flex';
    this._moveGhost({ clientX: x, clientY: y });
  }

  // Drop the dragged item onto whatever is at (x, y): a slot, or the ground if outside the panels.
  dropAt(x, y) {
    if (!this.drag) return;
    const target = document.elementFromPoint(x, y);
    const slot = target && target.closest('.slot');
    const src = this._containerOf(this.drag.c);
    if (slot && slot.dataset.c) {
      this._move(src, this.drag.i, this._containerOf(slot.dataset.c), Number(slot.dataset.i), this.drag.split);
    } else if (target && !target.closest('.panel')) {
      const it = src.slots[this.drag.i];
      if (it) {
        src.slots[this.drag.i] = null;
        src.changed();
        this.game.dropItems([it]);
      }
    }
    this._endDrag();
    this.refresh();
  }

  _moveGhost(e) {
    this.ghost.style.left = `${e.clientX - 28}px`;
    this.ghost.style.top = `${e.clientY - 28}px`;
  }

  _endDrag() {
    this.drag = null;
    if (this.ghost) this.ghost.style.display = 'none';
  }

  _move(sc, si, dc, di, split) {
    if (!sc || !dc || (sc === dc && si === di)) return;
    const a = sc.slots[si], b = dc.slots[di];
    if (!a) return;
    const def = ITEMS[a.id];
    if (split && a.qty > 1 && !b) {
      const half = Math.floor(a.qty / 2);
      a.qty -= half;
      dc.slots[di] = { ...a, qty: half };
    } else if (b && b.id === a.id && def.stack > 1) {
      const n = Math.min(def.stack - b.qty, a.qty);
      b.qty += n;
      a.qty -= n;
      if (a.qty <= 0) sc.slots[si] = null;
    } else {
      sc.slots[si] = b;
      dc.slots[di] = a;
    }
    sc.changed();
    if (dc !== sc) dc.changed();
  }

  _quickMove(cname, i) {
    const inv = this.game.inventory;
    const src = this._containerOf(cname);
    const item = src.slots[i];
    let dst;
    if (cname === 'other') dst = inv;
    else if (this.openC) dst = this.openC;
    else {
      // Between hotbar and main inventory
      const toHot = i >= 6;
      const range = toHot ? [0, 6] : [6, 30];
      for (let k = range[0]; k < range[1]; k++) {
        if (!inv.slots[k]) { inv.slots[k] = item; inv.slots[i] = null; inv.changed(); this.refresh(); return; }
      }
      return;
    }
    const left = dst.addItem(item);
    if (left > 0) item.qty = left;
    else src.slots[i] = null;
    src.changed();
    this.refresh();
  }

  _rightClick(c, i) {
    const item = c.slots[i];
    const def = ITEMS[item.id];
    if (def.use && c === this.game.inventory) {
      this.game.consume(item.id, i);
      this.refresh();
    } else if (def.gun && c === this.game.inventory && item.mag > 0) {
      // Unload the magazine back into ammo
      const left = this.game.inventory.add(def.gun.ammo, item.mag);
      item.mag = left;
      this.message(`Unloaded ${def.name}`);
      this.refresh();
    } else {
      this._quickMove(c === this.game.inventory ? 'inv' : 'other', i);
    }
  }

  // ------------------------------------------------------------------ crafting UI
  _buildCraftUI() {
    const cats = [...new Set(RECIPES.map((r) => r.cat))];
    const tabs = $('craft-tabs');
    for (const c of cats) {
      const b = el('button', 'tab', c);
      b.onclick = () => { this.craftCat = c; this._refreshCraft(); };
      b.dataset.cat = c;
      tabs.appendChild(b);
    }
    $('craft-list').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-r]');
      if (!btn) return;
      const r = RECIPES[Number(btn.dataset.r)];
      this.game.crafting.enqueue(r, e.shiftKey ? 5 : 1);
      this.refresh();
    });
    $('craft-queue').addEventListener('click', (e) => {
      const q = e.target.closest('.cq[data-k]');
      if (!q) return;
      this.game.crafting.cancel(Number(q.dataset.k));
      this.refresh();
    });
  }

  cycleCraftTab(dir) {
    const cats = [...new Set(RECIPES.map((r) => r.cat))];
    this.craftCat = cats[(cats.indexOf(this.craftCat) + dir + cats.length) % cats.length];
    this._refreshCraft();
    this.game.audio.play('ui');
  }

  _refreshCraft() {
    const g = this.game;
    document.querySelectorAll('#craft-tabs .tab').forEach((b) => b.classList.toggle('sel', b.dataset.cat === this.craftCat));
    const rows = [];
    RECIPES.forEach((r, idx) => {
      if (r.cat !== this.craftCat) return;
      const def = ITEMS[r.id];
      const ok = g.crafting.canCraft(r);
      const cost = Object.entries(r.cost).map(([k, v]) => {
        const have = g.inventory.count(k) >= v;
        return `<span class="${have ? 'have' : 'need'}">${v} ${ITEMS[k].name}</span>`;
      }).join(', ');
      rows.push(`<div class="recipe ${ok ? '' : 'locked'}"><span class="ic">${def.icon}</span><div class="rinfo"><div class="rname">${def.name}${r.qty > 1 ? ' ×' + r.qty : ''} <span class="rtime">${r.time}s</span></div><div class="rcost">${cost}</div></div><button data-r="${idx}" ${ok ? '' : 'disabled'}>Craft</button></div>`);
    });
    $('craft-list').innerHTML = rows.join('');
  }

  // ------------------------------------------------------------------ menus
  showMenu(mode) {
    const m = $('menu');
    m.style.display = 'flex';
    $('menu-resume').style.display = mode === 'pause' ? 'inline-block' : 'none';
    $('menu-continue').style.display = mode === 'start' && this.game.hasSave() ? 'inline-block' : 'none';
    $('menu-save').style.display = mode === 'pause' ? 'inline-block' : 'none';
  }

  hideMenu() {
    $('menu').style.display = 'none';
  }

  showDeath(info) {
    const d = $('death');
    d.style.display = 'flex';
    $('death-info').textContent = info;
    $('death-bag').style.display = this.game.building.spawnBag ? 'inline-block' : 'none';
  }

  hideDeath() {
    $('death').style.display = 'none';
  }
}
