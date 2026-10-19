// Controller support (standard Gamepad API layout: Xbox / PlayStation / Switch Pro).
//
// Gameplay mapping
//   Left stick  move            L3  sprint (toggle)      Right stick  look       R3  fire mode
//   RT          fire / use      LT  aim / alt action     LB / RB      prev / next belt slot
//   A           jump            B   crouch (toggle)      X  interact (tap) / reload (hold, or tap with nothing to interact)
//   Y / View    inventory       D-pad ↑ flashlight  ↓ check mag  ← demolish  → reload / cycle piece
//   Menu/Start  pause
//
// Menus and inventory use a virtual cursor: left stick moves it, the D-pad snaps it to the next
// control, A clicks / picks up / drops, X quick-moves (shift-click), Y uses, LT+A splits a stack,
// LB/RB switch crafting tabs, right stick scrolls, B backs out.

export const PAD = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
};

const STICK_DEADZONE = 0.16;
const TRIGGER_THRESHOLD = 0.3;

function radialDeadzone(x, y) {
  const mag = Math.hypot(x, y);
  if (mag < STICK_DEADZONE) return [0, 0];
  const scaled = Math.min(1, (mag - STICK_DEADZONE) / (1 - STICK_DEADZONE));
  return [(x / mag) * scaled, (y / mag) * scaled];
}

// Raw controller state, polled once per frame by Input.
export class PadState {
  constructor() {
    this.connected = false;
    this.id = '';
    this.now = new Array(17).fill(false);
    this.prev = new Array(17).fill(false);
    this.values = new Array(17).fill(0);
    this.lx = 0; this.ly = 0; this.rx = 0; this.ry = 0;
    this.used = false; // any meaningful input this frame
  }

  poll() {
    this.prev = this.now.slice();
    this.used = false;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) if (p && p.connected) { gp = p; break; }
    this.gp = gp;
    if (!gp) {
      this.connected = false;
      this.now.fill(false);
      this.lx = this.ly = this.rx = this.ry = 0;
      return;
    }
    this.connected = true;
    this.id = gp.id;
    for (let i = 0; i < 17; i++) {
      const b = gp.buttons[i];
      const v = b ? b.value : 0;
      this.values[i] = v;
      this.now[i] = !!b && (i === PAD.LT || i === PAD.RT ? v > TRIGGER_THRESHOLD : b.pressed || v > 0.5);
      if (this.now[i]) this.used = true;
    }
    [this.lx, this.ly] = radialDeadzone(gp.axes[0] || 0, gp.axes[1] || 0);
    [this.rx, this.ry] = radialDeadzone(gp.axes[2] || 0, gp.axes[3] || 0);
    if (this.lx || this.ly || this.rx || this.ry) this.used = true;
  }

  down(b) { return this.now[b]; }
  pressed(b) { return this.now[b] && !this.prev[b]; }
  released(b) { return !this.now[b] && this.prev[b]; }

  rumble(strong, weak, ms) {
    const act = this.gp && this.gp.vibrationActuator;
    if (!act || !act.playEffect) return;
    try {
      act.playEffect('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }).catch(() => {});
    } catch { /* not supported */ }
  }
}

// Translates the controller into the virtual keys / mouse buttons the game already understands.
export class PadGameplay {
  constructor(game) {
    this.game = game;
    this.sprintToggle = false;
    this.crouchToggle = false;
    this.xHeld = 0;
    this.xConsumed = false;
  }

  apply(dt) {
    const game = this.game, input = game.input, pad = input.pad;
    if (!pad.connected) return;
    const key = (code) => input.padKeys.add(code);
    const tap = (code) => { input.justPressed.add(code); input.padKeys.add(code); };

    // Movement: analog left stick (forward is negative Y on the stick).
    input.moveX = pad.lx;
    input.moveY = pad.ly;
    const stickMag = Math.hypot(pad.lx, pad.ly);
    if (pad.pressed(PAD.L3)) this.sprintToggle = !this.sprintToggle;
    if (stickMag < 0.25 || pad.ly > -0.2) this.sprintToggle = false;
    if (pad.pressed(PAD.B)) this.crouchToggle = !this.crouchToggle;
    if (this.sprintToggle) { key('ShiftLeft'); this.crouchToggle = false; }
    if (this.crouchToggle) key('KeyC');

    // Look: right stick with a squared response curve, expressed as mouse pixels so the
    // existing mouse look, ADS slowdown and weapon sway all apply unchanged.
    const s = game.settings;
    let rate = 3.1 * s.padSens; // radians/second at full deflection
    if (this._overZombie()) rate *= 0.55; // gentle aim slowdown over targets
    const curve = (v) => Math.sign(v) * v * v;
    const px = 1 / (0.0022 * s.sensitivity);
    input.mouseDX += curve(pad.rx) * rate * dt * px;
    input.mouseDY += curve(pad.ry) * rate * 0.75 * dt * px * (s.invertY ? -1 : 1);

    // Triggers act as mouse buttons.
    if (pad.down(PAD.RT)) input.padButtons.add(0);
    if (pad.pressed(PAD.RT)) input.justClicked.add(0);
    if (pad.down(PAD.LT)) input.padButtons.add(2);
    if (pad.pressed(PAD.LT)) input.justClicked.add(2);

    if (pad.pressed(PAD.A)) tap('Space');
    if (pad.pressed(PAD.Y) || pad.pressed(PAD.BACK)) tap('Tab');
    if (pad.pressed(PAD.LB)) input.wheel -= 1;
    if (pad.pressed(PAD.RB)) input.wheel += 1;
    if (pad.pressed(PAD.R3)) tap('KeyB');
    if (pad.pressed(PAD.UP)) tap('KeyF');
    if (pad.pressed(PAD.DOWN)) tap('KeyT');
    if (pad.pressed(PAD.LEFT)) tap('KeyX');
    if (pad.pressed(PAD.RIGHT)) tap('KeyR');
    if (pad.pressed(PAD.START)) game.pause();

    // X: interact when something is under the crosshair, otherwise reload. Holding X reloads.
    if (pad.pressed(PAD.X)) {
      this.xHeld = 0;
      this.xConsumed = false;
      if (!game.currentInteract) { tap('KeyR'); this.xConsumed = true; }
    }
    if (pad.down(PAD.X) && !this.xConsumed) {
      this.xHeld += dt;
      if (this.xHeld > 0.45) { tap('KeyR'); this.xConsumed = true; }
    }
    if (pad.released(PAD.X) && !this.xConsumed) tap('KeyE');
  }

  _overZombie() {
    const game = this.game;
    const def = game.combat.def;
    if (!def || !def.gun) return false;
    const cam = game.camera;
    const d = this._d || (this._d = cam.position.clone());
    d.set(0, 0, -1).applyQuaternion(cam.quaternion);
    return !!game.zombies.raycast(cam.position, d, 90);
  }

  reset() {
    this.sprintToggle = false;
    this.crouchToggle = false;
  }
}

const FOCUSABLE = 'button, .slot[data-c], .cq[data-k], input[type=range], input[type=checkbox]';

// Virtual cursor for menus, the inventory and crafting.
export class PadCursor {
  constructor(game) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.id = 'pad-cursor';
    document.body.appendChild(this.el);
    this.x = window.innerWidth / 2;
    this.y = window.innerHeight / 2;
    this.active = false;
    this.root = null;
    this.hover = null;
  }

  // Which overlay currently owns the screen, if any.
  currentRoot() {
    const vis = (id) => document.getElementById(id).style.display === 'flex';
    if (vis('death')) return document.getElementById('death');
    if (vis('menu')) return document.getElementById('menu');
    if (this.game.ui.inventoryOpen) return document.getElementById('inventory');
    return null;
  }

  _candidates() {
    const roots = [this.root];
    if (this.root.id === 'inventory') roots.push(document.getElementById('craft-queue'));
    const out = [];
    for (const r of roots) {
      for (const el of r.querySelectorAll(FOCUSABLE)) {
        if (el.disabled) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2 || el.offsetParent === null) continue;
        if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
        out.push({ el, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      }
    }
    return out;
  }

  _moveTo(el) {
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    this.x = r.left + r.width / 2;
    this.y = r.top + r.height / 2;
  }

  _snapInitial() {
    const root = this.root;
    const pref = root.querySelector('.menu-buttons button:not([style*="none"])') || root.querySelector('#inv-hotbar .slot') || root.querySelector('button');
    const c = this._candidates().find((k) => k.el === pref) || this._candidates()[0];
    if (c) this._moveTo(c.el);
  }

  _snapDir(dx, dy) {
    let best = null, bestScore = Infinity;
    for (const c of this._candidates()) {
      if (c.el === this.hover) continue;
      const vx = c.x - this.x, vy = c.y - this.y;
      const along = vx * dx + vy * dy;
      if (along < 6) continue;
      const perp = Math.abs(vx * dy - vy * dx);
      const score = along + perp * 2.5;
      if (score < bestScore) { bestScore = score; best = c; }
    }
    if (best) this._moveTo(best.el);
  }

  _under() {
    const el = document.elementFromPoint(this.x, this.y);
    return el && this.root.contains(el) ? el : el && el.closest('#craft-queue') ? el : null;
  }

  hide() {
    if (this.active) {
      this.active = false;
      this.el.style.display = 'none';
      if (this.hover) this.hover.classList.remove('pad-hover');
      this.hover = null;
    }
  }

  update(dt) {
    const game = this.game, ui = game.ui, pad = game.input.pad;
    const root = this.currentRoot();
    if (!root || !pad.connected || game.input.lastDevice !== 'pad') {
      if (!root) this.root = null;
      this.hide();
      return;
    }
    if (root !== this.root || !this.active) {
      this.root = root;
      this.active = true;
      this.el.style.display = 'block';
      this._snapInitial();
    }

    // Free cursor on the left stick, snapping on the D-pad.
    const speed = 950 * dt;
    const mag = Math.hypot(pad.lx, pad.ly);
    if (mag > 0) {
      const k = speed * Math.pow(mag, 1.6) / mag;
      this.x = Math.max(0, Math.min(window.innerWidth - 1, this.x + pad.lx * k));
      this.y = Math.max(0, Math.min(window.innerHeight - 1, this.y + pad.ly * k));
    }
    const under = this._under();
    const range = under && under.closest('label') ? under.closest('label').querySelector('input[type=range]') : under && under.matches('input[type=range]') ? under : null;
    if (range && (pad.pressed(PAD.LEFT) || pad.pressed(PAD.RIGHT))) {
      const step = Number(range.step) || 1;
      const v = Number(range.value) + (pad.pressed(PAD.RIGHT) ? step : -step) * (range.max - range.min > 20 ? 2 : 1);
      range.value = String(Math.max(Number(range.min), Math.min(Number(range.max), v)));
      range.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      if (pad.pressed(PAD.LEFT)) this._snapDir(-1, 0);
      if (pad.pressed(PAD.RIGHT)) this._snapDir(1, 0);
    }
    if (pad.pressed(PAD.UP)) this._snapDir(0, -1);
    if (pad.pressed(PAD.DOWN)) this._snapDir(0, 1);

    // Right stick scrolls whatever is under the cursor.
    if (pad.ry) {
      let s = this._under();
      while (s && s !== document.body && !(s.scrollHeight > s.clientHeight + 2 && getComputedStyle(s).overflowY !== 'visible')) s = s.parentElement;
      if (s && s !== document.body) s.scrollTop += pad.ry * 900 * dt;
    }

    this.el.style.transform = `translate(${this.x}px, ${this.y}px)`;
    const target = this._under();
    const focus = target ? target.closest(FOCUSABLE) || (target.closest('label') && target.closest('label').querySelector('input')) : null;
    if (focus !== this.hover) {
      if (this.hover) this.hover.classList.remove('pad-hover');
      this.hover = focus;
      if (focus) focus.classList.add('pad-hover');
    }
    if (ui.drag) ui._moveGhost({ clientX: this.x, clientY: this.y });

    const slot = target && target.closest('.slot[data-c]');
    const slotItem = slot ? ui._containerOf(slot.dataset.c)?.slots[Number(slot.dataset.i)] : null;

    if (pad.pressed(PAD.A)) {
      if (ui.drag) ui.dropAt(this.x, this.y);
      else if (slot) { if (slotItem) ui.startDrag(slot, pad.down(PAD.LT), this.x, this.y); }
      else if (focus && focus.matches('input[type=checkbox]')) {
        focus.checked = !focus.checked;
        focus.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (focus && !focus.matches('input')) focus.click();
    }
    if (pad.pressed(PAD.X)) {
      if (slot && slotItem && !ui.drag) ui._quickMove(slot.dataset.c, Number(slot.dataset.i));
      else if (focus && focus.matches('button')) focus.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    }
    if (pad.pressed(PAD.Y) && slot && slotItem && !ui.drag) {
      ui._rightClick(ui._containerOf(slot.dataset.c), Number(slot.dataset.i));
    }
    if (root.id === 'inventory' && (pad.pressed(PAD.LB) || pad.pressed(PAD.RB))) ui.cycleCraftTab(pad.pressed(PAD.RB) ? 1 : -1);

    const back = pad.pressed(PAD.B);
    if (root.id === 'inventory') {
      if (back && ui.drag) ui._endDrag();
      else if (back || (pad.pressed(PAD.Y) && !slotItem) || pad.pressed(PAD.BACK)) ui.closeInventory();
    } else if (root.id === 'menu') {
      const paused = document.getElementById('menu-resume').style.display !== 'none';
      if (paused && (back || pad.pressed(PAD.START))) game.startPlaying();
    }
  }
}
