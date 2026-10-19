import * as THREE from 'three';
import { ITEMS } from './items.js';
import { clamp, damp, lerp, randInt } from './util.js';
import { NODE_DEFS } from './world.js';
import { scaledCost, costText, TIERS, PIECES } from './building.js';

const DEG = Math.PI / 180;
const FISTS = { dmg: 6, range: 1.8, rate: 0.55, stamina: 4 };
const FISTS_GATHER = { tree: 1, stone: 1, barrel: 1 };

// Handles whatever is in the active hotbar slot: guns, melee tools, building plan, hammer, consumables, deployables.
export class Combat {
  constructor(game) {
    this.game = game;
    this.slot = 0;
    this.adsAmount = 0;
    this.adsSensMul = 0.7;
    this.fireCd = 0;
    this.reloadT = -1;
    this.reloadDur = 0;
    this.swingT = -1;
    this.swingDur = 0;
    this.swingHitDone = false;
    this.useT = -1;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.pumpT = 0;
    this.autoMode = true;
    this.flashlightOn = false;
    this.bullets = [];
    this.demolishArm = 0;
    this.lastItemRef = null;
    this.sparks = [];
    const sparkGeo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
    this.sparkMats = {
      dust: new THREE.MeshBasicMaterial({ color: 0xb8ab90, transparent: true }),
      blood: new THREE.MeshBasicMaterial({ color: 0x7a1010, transparent: true }),
      wood: new THREE.MeshBasicMaterial({ color: 0x8a6a40, transparent: true }),
    };
    for (let i = 0; i < 60; i++) {
      const m = new THREE.Mesh(sparkGeo, this.sparkMats.dust);
      m.visible = false;
      game.scene.add(m);
      this.sparks.push({ m, vx: 0, vy: 0, vz: 0, t: 0 });
    }
    this.sparkIdx = 0;
    this.muzzleLight = new THREE.PointLight(0xffc070, 0, 12);
    game.scene.add(this.muzzleLight);
    this.flashlight = new THREE.SpotLight(0xfff4dd, 0, 50, 0.42, 0.55, 1.6);
    game.scene.add(this.flashlight);
    game.scene.add(this.flashlight.target);
  }

  get item() {
    return this.game.inventory.slots[this.slot];
  }

  get def() {
    const it = this.item;
    return it ? ITEMS[it.id] : null;
  }

  get using() {
    return this.useT >= 0;
  }

  get reloading() {
    return this.reloadT >= 0;
  }

  selectSlot(i) {
    if (i === this.slot) return;
    this.slot = i;
    this.cancelActions();
  }

  cancelActions() {
    this.reloadT = -1;
    this.useT = -1;
    this.swingT = -1;
    this.demolishArm = 0;
  }

  // ------------------------------------------------------------------ per-frame
  update(dt, input, locked) {
    const game = this.game;
    const item = this.item;
    const def = this.def;
    if (item !== this.lastItemRef) {
      // Item moved or changed: reset in-progress actions.
      if (this.lastItemRef && (!item || item.id !== this.lastItemRef.id)) this.cancelActions();
      this.lastItemRef = item;
    }
    game.viewmodel.setItem(item ? item.id : null);
    this.fireCd -= dt;
    this.pumpT = Math.max(0, this.pumpT - dt * 2.2);
    const player = game.player;
    const canAct = locked && player.alive && !game.ui.inventoryOpen;

    // Flashlight
    if (canAct && input.pressed('KeyF')) {
      if (game.inventory.count('flashlight') > 0) {
        this.flashlightOn = !this.flashlightOn;
        game.audio.play('ui');
      } else game.ui.message('You need a flashlight.', 'warn');
    }
    if (this.flashlightOn && game.inventory.count('flashlight') === 0) this.flashlightOn = false;

    // ADS
    const wantAds = canAct && def && def.gun && input.mouseDown(2) && !player.sprinting && !this.reloading;
    this.adsAmount = damp(this.adsAmount, wantAds ? 1 : 0, 12, dt);

    // Recoil recovery (camera returns toward the point of aim)
    this.recoilPitch = damp(this.recoilPitch, 0, 7, dt);
    this.recoilYaw = damp(this.recoilYaw, 0, 7, dt);

    if (def && def.gun) this._updateGun(dt, input, canAct, item, def.gun);
    else if (def && def.use) this._updateConsumable(dt, input, canAct, item, def);
    else if (def && def.tool === 'plan') this._updatePlan(input, canAct);
    else if (def && def.tool === 'hammer') this._updateHammer(dt, input, canAct);
    else if (def && def.deploy) this._updateDeploy(input, canAct, def);
    else this._updateMelee(dt, input, canAct, def ? def.melee || FISTS : FISTS, def ? def.gather || FISTS_GATHER : FISTS_GATHER);

    if (!(def && (def.tool === 'plan' || def.deploy))) game.building.hideGhost();
    this._updateBullets(dt);
    this._updateSparks(dt);
    this.muzzleLight.intensity = damp(this.muzzleLight.intensity, 0, 30, dt);

    // Flashlight follows camera
    const cam = game.camera;
    this.flashlight.intensity = this.flashlightOn ? 14 : 0;
    this.flashlight.position.copy(cam.position);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    this.flashlight.target.position.copy(cam.position).addScaledVector(fwd, 10);

    // Viewmodel
    const swing = this.swingT >= 0 ? this.swingT / this.swingDur : -1;
    const reload = this.reloadT >= 0 ? this.reloadT / this.reloadDur : -1;
    game.viewmodel.update(dt, {
      ads: this.adsAmount,
      sprint: player.sprinting,
      bobPhase: player.bobPhase,
      moving: clamp(player.speedNow / 4, 0, 1.5),
      swing, reload,
      using: this.useT,
      mouseDX: locked ? input.mouseDX : 0,
      mouseDY: locked ? input.mouseDY : 0,
      pump: Math.sin(this.pumpT * Math.PI),
      breathe: true,
      time: game.clock,
    });
  }

  // ------------------------------------------------------------------ guns
  _updateGun(dt, input, canAct, item, gun) {
    const game = this.game;
    const inv = game.inventory;
    if (item.mag === undefined) item.mag = 0;

    if (canAct && input.pressed('KeyB') && gun.auto) {
      this.autoMode = !this.autoMode;
      game.ui.message(`Fire mode: ${this.autoMode ? 'AUTO' : 'SEMI'}`);
      game.audio.play('ui');
    }
    if (canAct && input.pressed('KeyT')) this._checkMag(item, gun);

    // Reload
    if (canAct && input.pressed('KeyR') && !this.reloading && item.mag < gun.mag) {
      if (inv.count(gun.ammo) <= 0) game.ui.message(`No ${ITEMS[gun.ammo].name}`, 'warn');
      else {
        this.reloadDur = item.mag === 0 ? gun.reloadEmpty : gun.reload;
        this.reloadT = 0;
        game.audio.play('reload');
      }
    }
    if (this.reloading) {
      this.reloadT += dt;
      if (this.reloadT >= this.reloadDur) {
        const need = gun.tube ? 1 : gun.mag - item.mag;
        const have = inv.count(gun.ammo);
        const n = Math.min(need, have);
        inv.remove(gun.ammo, n);
        item.mag += n;
        this.reloadT = -1;
        if (gun.tube && item.mag < gun.mag && inv.count(gun.ammo) > 0 && !input.mouseDown(0)) {
          this.reloadT = 0;
          this.reloadDur = gun.reload;
          game.audio.play('pump');
        } else if (!gun.tube) game.audio.play('reload');
        game.ui.refreshHotbar();
      }
    }

    const trigger = gun.auto && this.autoMode ? input.mouseDown(0) : input.mousePressed(0);
    if (!canAct || !trigger || this.fireCd > 0 || game.player.sprinting) return;
    if (this.reloading) {
      if (gun.tube && item.mag > 0) this.reloadT = -1; // interrupt shell loading to fire
      else return;
    }
    if (item.mag <= 0) {
      if (input.mousePressed(0)) game.audio.play('dry');
      this.fireCd = 0.25;
      return;
    }
    this._fire(item, gun);
  }

  _checkMag(item, gun) {
    const f = item.mag / gun.mag;
    let txt;
    if (item.mag === 0) txt = 'Empty';
    else if (gun.mag <= 6) txt = `${item.mag} round${item.mag > 1 ? 's' : ''}`; // small mags/tubes you can count
    else if (f > 0.9) txt = 'Full';
    else if (f > 0.6) txt = 'Nearly full';
    else if (f > 0.35) txt = 'About half';
    else if (f > 0.12) txt = 'Less than half';
    else txt = 'Almost empty';
    this.game.ui.message(`Mag check: ${txt}`);
  }

  _fire(item, gun) {
    const game = this.game;
    const player = game.player;
    item.mag--;
    this.fireCd = 60 / gun.rpm;
    if (gun.tube || gun.model === 'bolt') this.pumpT = 1;

    const cam = game.camera;
    const origin = cam.position.clone();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    let spread = lerp(gun.spread, gun.adsSpread, this.adsAmount);
    spread += clamp(player.speedNow / 6, 0, 1) * (1.6 - this.adsAmount);
    if (!player.onGround) spread += 3;
    if (player.crouching) spread *= 0.8;
    for (let k = 0; k < gun.pellets; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * spread * DEG;
      const d = fwd.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
      this.bullets.push({
        x: origin.x, y: origin.y, z: origin.z,
        vx: d.x * gun.velocity, vy: d.y * gun.velocity, vz: d.z * gun.velocity,
        life: 2.5, dmg: gun.dmg, travelled: 0,
      });
    }

    // Recoil: part is a camera kick that recovers, part permanently climbs your aim.
    const crouchMul = player.crouching ? 0.8 : 1;
    const adsMul = lerp(1.15, 0.85, this.adsAmount);
    const v = gun.recoilV * (0.85 + Math.random() * 0.3) * crouchMul * adsMul;
    const h = (Math.random() * 2 - 1) * gun.recoilH * crouchMul;
    this.recoilPitch += v * 0.65 * DEG;
    this.recoilYaw += h * 0.6 * DEG;
    player.pitch += v * 0.35 * DEG;
    player.yaw += h * 0.3 * DEG;
    game.viewmodel.addKick(gun.recoilV * 0.25);
    game.input.rumble(Math.min(1, gun.recoilV / 7), 0.5, gun.pellets > 1 || gun.model === 'bolt' ? 140 : 70);
    game.viewmodel.muzzleFlash();
    this.muzzleLight.position.copy(origin).addScaledVector(fwd, 1);
    this.muzzleLight.intensity = 8;
    game.audio.play(gun.model);
    game.makeNoise(player.pos.x, player.pos.z, gun.noise, true);
    game.ui.refreshHotbar();
  }

  _updateBullets(dt) {
    const game = this.game;
    const phys = game.physics;
    const zm = game.zombies;
    const o = new THREE.Vector3(), d = new THREE.Vector3();
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      b.vy -= 9.81 * dt;
      const sx = b.vx * dt, sy = b.vy * dt, sz = b.vz * dt;
      const len = Math.hypot(sx, sy, sz);
      o.set(b.x, b.y, b.z);
      d.set(sx / len, sy / len, sz / len);
      const wh = phys.raycast(b.x, b.y, b.z, d.x, d.y, d.z, len, { filter: (bx) => bx.kind !== 'node' || bx.owner.type !== 'hemp' });
      const zh = zm.raycast(o, d, wh ? wh.dist : len);
      if (zh) {
        // Damage falls off a little with distance travelled.
        const falloff = clamp(1 - (b.travelled + zh.t) / 600, 0.55, 1);
        const dmg = b.dmg * zh.mul * falloff;
        zm.damage(zh.zombie, dmg, zh.part, d, 'bullet');
        const p = o.clone().addScaledVector(d, zh.t);
        this._burst(p, 'blood', 6);
        game.audio.play('flesh', p.distanceTo(game.camera.position));
        game.ui.hitMarker(zh.part === 'head', !zh.zombie.alive);
        this.bullets.splice(i, 1);
        continue;
      }
      if (wh) {
        const p = new THREE.Vector3(wh.x, wh.y, wh.z);
        this._burst(p, wh.box && (wh.box.kind === 'node' && wh.box.owner.type === 'tree') ? 'wood' : 'dust', 5);
        game.audio.play('impact', p.distanceTo(game.camera.position));
        if (wh.box && wh.box.kind === 'build') game.building.damagePiece(wh.box.owner, b.dmg * 0.15);
        if (wh.box && wh.box.kind === 'node' && wh.box.owner.type === 'barrel') this._hitBarrel(wh.box.owner, b.dmg * 0.5);
        this.bullets.splice(i, 1);
        continue;
      }
      b.x += sx; b.y += sy; b.z += sz;
      b.travelled += len;
      if (b.life <= 0 || b.y < -40) this.bullets.splice(i, 1);
    }
  }

  _burst(p, kind, n) {
    for (let k = 0; k < n; k++) {
      const s = this.sparks[this.sparkIdx];
      this.sparkIdx = (this.sparkIdx + 1) % this.sparks.length;
      s.m.material = this.sparkMats[kind];
      s.m.position.copy(p);
      s.m.visible = true;
      s.vx = (Math.random() - 0.5) * 3; s.vy = Math.random() * 3; s.vz = (Math.random() - 0.5) * 3;
      s.t = 0.5;
    }
  }

  _updateSparks(dt) {
    for (const s of this.sparks) {
      if (s.t <= 0) continue;
      s.t -= dt;
      s.vy -= 9 * dt;
      s.m.position.x += s.vx * dt; s.m.position.y += s.vy * dt; s.m.position.z += s.vz * dt;
      if (s.t <= 0) s.m.visible = false;
    }
  }

  // ------------------------------------------------------------------ melee & gathering
  _updateMelee(dt, input, canAct, melee, gather) {
    const game = this.game;
    const player = game.player;
    if (this.swingT >= 0) {
      this.swingT += dt;
      if (!this.swingHitDone && this.swingT >= this.swingDur * 0.42) {
        this.swingHitDone = true;
        this._meleeHit(melee, gather);
      }
      if (this.swingT >= this.swingDur) this.swingT = -1;
      return;
    }
    if (canAct && input.mouseDown(0) && player.stamina > 3) {
      this.swingT = 0;
      this.swingDur = melee.rate;
      this.swingHitDone = false;
      player.stamina -= melee.stamina;
      game.audio.play('swing');
    }
  }

  _aim() {
    const cam = this.game.camera;
    return { o: cam.position.clone(), d: new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion) };
  }

  _meleeHit(melee, gather) {
    const game = this.game;
    const { o, d } = this._aim();
    const wh = game.physics.raycast(o.x, o.y, o.z, d.x, d.y, d.z, melee.range, { filter: (b) => b.kind !== 'node' || b.owner.type !== 'hemp' });
    const zh = game.zombies.raycast(o, d, wh ? wh.dist : melee.range);
    if (zh) {
      const mul = zh.part === 'head' ? 2 : zh.part === 'legs' ? 0.8 : 1;
      game.zombies.damage(zh.zombie, melee.dmg * mul, zh.part, d, 'melee');
      this._burst(o.clone().addScaledVector(d, zh.t), 'blood', 6);
      game.audio.play('zhit');
      game.input.rumble(0.5, 0.3, 90);
      game.makeNoise(game.player.pos.x, game.player.pos.z, 8);
      return;
    }
    if (!wh) return;
    const p = new THREE.Vector3(wh.x, wh.y, wh.z);
    if (wh.box && wh.box.kind === 'node') {
      const node = wh.box.owner;
      if (node.type === 'barrel') {
        this._hitBarrel(node, melee.dmg);
        return;
      }
      const def = NODE_DEFS[node.type];
      const per = node.type === 'tree' ? gather.tree : gather.stone;
      const n = Math.min(per, node.amount);
      node.amount -= n;
      this._give(def.yield, n);
      if (def.bonus) this._give(def.bonus, Math.ceil(n / 2));
      this._burst(p, node.type === 'tree' ? 'wood' : 'dust', 5);
      game.audio.play(node.type === 'tree' ? 'chop' : 'mine');
      game.makeNoise(game.player.pos.x, game.player.pos.z, 14);
      if (node.amount <= 0) {
        game.world.depleteNode(node, game.clock);
        if (node.type === 'tree') game.audio.play('break');
      }
      return;
    }
    this._burst(p, 'dust', 3);
    game.audio.play('impact');
  }

  _hitBarrel(node, dmg) {
    const game = this.game;
    if (!node.alive) return;
    node.hp -= dmg;
    game.audio.play('metal');
    if (node.hp <= 0) {
      this._give('scrap', randInt(Math.random, 2, 5));
      if (Math.random() < 0.6) this._give('metal_frags', randInt(Math.random, 5, 15));
      if (Math.random() < 0.15) this._give('ammo_9mm', randInt(Math.random, 3, 8));
      if (Math.random() < 0.2) this._give('cloth', randInt(Math.random, 2, 5));
      game.world.depleteNode(node, game.clock);
      game.audio.play('break');
    }
  }

  _give(id, qty) {
    if (qty <= 0) return;
    const left = this.game.inventory.add(id, qty);
    this.game.ui.pickup(id, qty - left);
    if (left > 0) {
      this.game.dropItems([{ id, qty: left }]);
      this.game.ui.message('Inventory full', 'warn');
    }
  }

  // ------------------------------------------------------------------ consumables
  _updateConsumable(dt, input, canAct, item, def) {
    const game = this.game;
    if (this.useT >= 0) {
      this.useT += dt;
      game.ui.progress(this.useT / def.use.time, `Using ${def.name}`);
      if (this.useT >= def.use.time) {
        this.useT = -1;
        game.ui.progress(-1);
        game.consume(item.id);
      }
      return;
    }
    if (canAct && input.mousePressed(0)) {
      this.useT = 0;
      game.audio.play('eat');
    }
  }

  // ------------------------------------------------------------------ building
  _updatePlan(input, canAct) {
    const game = this.game;
    const bm = game.building;
    if (canAct && (input.pressed('KeyR') || input.mousePressed(2))) {
      bm.cyclePiece(1);
      game.audio.play('ui');
    }
    const type = bm.pieceType;
    const plan = bm.planPiece(type, this._aim());
    bm.showGhost(plan);
    const cost = scaledCost(TIERS[0].cost, PIECES[type].mult);
    const afford = game.inventory.has(cost);
    const k = (n) => game.ui.key(n);
    game.ui.buildInfo(`${PIECES[type].name} — ${costText(cost)}`, plan.valid ? (afford ? '' : 'Not enough resources') : plan.reason, `[${k('RMB')}/${k('R')}] change piece  [${k('LMB')}] place`);
    if (canAct && input.mousePressed(0) && plan.valid) bm.placeFromPlan(plan);
  }

  _updateDeploy(input, canAct, def) {
    const game = this.game;
    const bm = game.building;
    const { o, d } = this._aim();
    const plan = def.deploy === 'door' ? bm.planDoor({ o, d }) : bm.planDeploy(def.deploy, { o, d });
    bm.showGhost(plan);
    game.ui.buildInfo(`Place ${def.name}`, plan.valid ? '' : plan.reason, `[${game.ui.key('LMB')}] place`);
    if (canAct && input.mousePressed(0) && plan.valid) bm.placeFromPlan(plan);
  }

  _updateHammer(dt, input, canAct) {
    const game = this.game;
    const bm = game.building;
    const { o, d } = this._aim();
    const hit = game.physics.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 4);
    const piece = hit && hit.box && hit.box.kind === 'build' ? hit.box.owner : null;
    this.demolishArm = Math.max(0, this.demolishArm - dt);
    if (piece) {
      const name = piece.type === 'door' ? 'Wooden Door' : `${TIERS[piece.tier].name} ${PIECES[piece.type].name}`;
      const next = piece.type !== 'door' && piece.tier < TIERS.length - 1 ? TIERS[piece.tier + 1] : null;
      const k = (n) => game.ui.key(n);
      const upCost = next ? `[${k('RMB')}] upgrade to ${next.name}: ${costText(scaledCost(next.cost, PIECES[piece.type].mult))}` : '';
      game.ui.buildInfo(`${name}  ${Math.ceil(piece.hp)}/${piece.maxHp} HP`, '', `[${k('LMB')}] repair  ${upCost}  [${k('X')}] demolish`);
    } else game.ui.buildInfo('Hammer', '', 'Aim at a building piece');
    if (this.swingT >= 0) {
      this.swingT += dt;
      if (this.swingT >= this.swingDur) this.swingT = -1;
    }
    if (!canAct || !piece) return;
    if (input.mousePressed(0)) {
      this.swingT = 0; this.swingDur = 0.6;
      bm.repair(piece);
    }
    if (input.mousePressed(2)) {
      this.swingT = 0; this.swingDur = 0.6;
      bm.upgrade(piece);
    }
    if (input.pressed('KeyX')) {
      if (this.demolishArm > 0) { bm.demolish(piece); this.demolishArm = 0; }
      else { this.demolishArm = 1.5; game.ui.message(`Press ${game.ui.key('X')} again to demolish`); }
    }
  }
}
