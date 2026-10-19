import { clamp, damp } from './util.js';
import { STEP_HEIGHT } from './physics.js';
import { WATER_LEVEL } from './world.js';
import { DAY_LENGTH } from './env.js';

const STAND = { height: 1.8, eye: 1.62 };
const CROUCH = { height: 1.15, eye: 1.02 };
const RADIUS = 0.33;
const SATURATION_CAP = 60;

export class Player {
  constructor(game) {
    this.game = game;
    this.pos = { x: 0, y: 0, z: 0 };
    this.vx = 0; this.vz = 0; this.vy = 0;
    this.yaw = 0; this.pitch = 0;
    this.crouching = false;
    this.sprinting = false;
    this.onGround = false;
    this.swimming = false;
    this.eyeH = STAND.eye;
    this.bobPhase = 0;
    this.bob = 0;
    this.stepAcc = 0;
    this.speedNow = 0;
    this._contacts = [];
    this.reset();
  }

  reset() {
    this.health = 100;
    this.food = 70;
    this.water = 70;
    this.stamina = 100;
    this.bleeding = false;
    this.infection = 0; // 0 = healthy, >0 infected (progresses to 1 = death)
    this.saturation = []; // healing-over-time from food: [{ rate (hp/s), left (hp) }]
    this.alive = true;
    this.vx = this.vz = this.vy = 0;
    this.lastHurt = -10;
  }

  get height() {
    return this.crouching ? CROUCH.height : STAND.height;
  }

  eyePos(out) {
    out.set(this.pos.x, this.pos.y + this.eyeH + this.bob, this.pos.z);
    return out;
  }

  teleport(x, z, y = null) {
    this.pos.x = x; this.pos.z = z;
    // Snap to the terrain or a low surface on it (foundations, floors), never on top of trees/roofs.
    const t = this.game.terrain.heightAt(x, z);
    this.pos.y = y !== null ? y : this.game.physics.groundAt(x, z, RADIUS, t + 1) + 0.05;
    this.vx = this.vz = this.vy = 0;
  }

  update(dt, input, locked) {
    const phys = this.game.physics;
    const terrainH = this.game.terrain.heightAt(this.pos.x, this.pos.z);
    this.swimming = terrainH < WATER_LEVEL - 1.25 && this.pos.y < WATER_LEVEL - 0.9;

    // --- look (disabled while the map is open; you can still walk)
    if (locked && !this.game.map.open) {
      const sens = this.game.settings.sensitivity * (this.game.combat.adsAmount > 0.5 ? this.game.combat.adsSensMul : 1);
      this.yaw -= input.mouseDX * 0.0022 * sens;
      this.pitch -= input.mouseDY * 0.0022 * sens;
      this.pitch = clamp(this.pitch, -1.55, 1.55);
    }

    if (this.game.cheats.noclip) { this._fly(dt, input, locked); return; }

    // --- crouch (blocked by ceilings)
    const wantCrouch = locked && input.down('ControlLeft', 'KeyC');
    if (wantCrouch) this.crouching = true;
    else if (this.crouching) {
      const ceil = phys.ceilingAt(this.pos.x, this.pos.z, RADIUS, this.pos.y, this.pos.y + STAND.height);
      if (ceil > this.pos.y + STAND.height) this.crouching = false;
    }
    this.eyeH = damp(this.eyeH, this.crouching ? CROUCH.eye : STAND.eye, 14, dt);

    // --- movement intent
    let mx = 0, mz = 0;
    if (locked) {
      if (input.down('KeyW')) mz -= 1;
      if (input.down('KeyS')) mz += 1;
      if (input.down('KeyA')) mx -= 1;
      if (input.down('KeyD')) mx += 1;
      // Analog stick adds proportional movement (keys still give full speed).
      mx += input.moveX;
      mz += input.moveY;
    }
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    const ads = this.game.combat.adsAmount > 0.3;
    const wantSprint = locked && input.down('ShiftLeft') && mz < 0 && !this.crouching && !ads && !this.swimming;
    this.sprinting = wantSprint && this.stamina > 1 && len > 0.3;
    let speed = this.crouching ? 1.7 : this.sprinting ? 6.2 : 3.6;
    if (ads) speed *= 0.6;
    if (this.swimming) speed = 2.0;
    if (this.health < 30) speed *= 0.85;
    if (this.game.combat.using) speed *= 0.5;
    speed *= this.game.cheats.speed;

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = (mx * cos + mz * sin) * speed;
    const wz = (-mx * sin + mz * cos) * speed;
    const accel = this.onGround || this.swimming ? 14 : 2.5;
    this.vx = damp(this.vx, wx, accel, dt);
    this.vz = damp(this.vz, wz, accel, dt);

    // --- vertical
    if (this.swimming) {
      this.vy = damp(this.vy, (WATER_LEVEL - 1.3 - this.pos.y) * 3, 6, dt);
    } else {
      this.vy -= 19 * dt;
      if (locked && this.onGround && input.pressed('Space') && this.stamina > 8) {
        this.vy = 6.4;
        this.stamina -= 8;
        this.onGround = false;
      }
    }

    // --- integrate horizontal with collision
    const prev = { x: this.pos.x, z: this.pos.z };
    this.pos.x += this.vx * dt;
    this.pos.z += this.vz * dt;
    phys.resolveCircle(this.pos, RADIUS, this.pos.y, this.height, this._contacts);
    const lim = 315;
    this.pos.x = clamp(this.pos.x, -lim, lim);
    this.pos.z = clamp(this.pos.z, -lim, lim);
    this.speedNow = Math.hypot(this.pos.x - prev.x, this.pos.z - prev.z) / Math.max(dt, 1e-4);

    // --- integrate vertical
    const oldY = this.pos.y;
    this.pos.y += this.vy * dt;
    const ground = phys.groundAt(this.pos.x, this.pos.z, RADIUS, Math.max(oldY, this.pos.y));
    if (this.vy > 0) {
      const ceil = phys.ceilingAt(this.pos.x, this.pos.z, RADIUS, oldY, this.pos.y + this.height);
      if (this.pos.y + this.height > ceil) {
        this.pos.y = ceil - this.height;
        this.vy = 0;
      }
    }
    if (this.pos.y <= ground) {
      if (!this.onGround && this.vy < -13) {
        this.game.damagePlayer((-this.vy - 13) * 7, 'fall');
      }
      this.pos.y = ground;
      this.vy = 0;
      this.onGround = true;
    } else if (this.pos.y - ground < 0.08 && this.vy <= 0) {
      this.pos.y = ground;
      this.vy = 0;
      this.onGround = true;
    } else if (!this.swimming && this.pos.y - ground < STEP_HEIGHT && this.onGround && this.vy <= 0) {
      // Snap down slopes/steps instead of floating off them.
      this.pos.y = ground;
      this.vy = 0;
    } else {
      this.onGround = false;
    }

    // --- head bob & footsteps (footsteps make noise zombies can hear)
    const moving = this.speedNow > 0.5 && (this.onGround || this.swimming);
    if (moving) {
      this.bobPhase += dt * this.speedNow * 1.9;
      this.bob = Math.sin(this.bobPhase * 2) * 0.035 * (this.sprinting ? 1.6 : 1);
      this.stepAcc += this.speedNow * dt;
      const stride = this.sprinting ? 1.9 : 1.5;
      if (this.stepAcc > stride) {
        this.stepAcc = 0;
        if (!this.crouching) this.game.audio.play('step');
        const radius = this.crouching ? 1.5 : this.sprinting ? 14 : 6;
        this.game.makeNoise(this.pos.x, this.pos.z, radius, false);
      }
    } else {
      this.bob = damp(this.bob, 0, 8, dt);
    }

    // --- stamina
    if (this.sprinting) this.stamina -= 14 * dt;
    else this.stamina += (this.speedNow < 0.5 ? 16 : 10) * dt * (this.food > 10 ? 1 : 0.5);
    this.stamina = clamp(this.stamina, 0, 100);
  }

  // Dev-console noclip: free flight through everything.
  _fly(dt, input, locked) {
    let f = 0, r = 0, u = 0;
    if (locked) {
      if (input.down('KeyW')) f += 1;
      if (input.down('KeyS')) f -= 1;
      if (input.down('KeyD')) r += 1;
      if (input.down('KeyA')) r -= 1;
      if (input.down('Space')) u += 1;
      if (input.down('ControlLeft', 'KeyC')) u -= 1;
      f -= input.moveY;
      r += input.moveX;
    }
    const speed = 12 * (input.down('ShiftLeft') ? 4 : 1) * this.game.cheats.speed;
    const cp = Math.cos(this.pitch), sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const ox = this.pos.x, oy = this.pos.y, oz = this.pos.z;
    this.pos.x += (-sy * cp * f + cy * r) * speed * dt;
    this.pos.y += (Math.sin(this.pitch) * f + u) * speed * dt;
    this.pos.z += (-cy * cp * f - sy * r) * speed * dt;
    this.speedNow = Math.hypot(this.pos.x - ox, this.pos.y - oy, this.pos.z - oz) / Math.max(dt, 1e-4);
    this.vx = this.vy = this.vz = 0;
    this.onGround = false;
    this.sprinting = false;
    this.crouching = false;
    this.eyeH = STAND.eye;
  }

  // Food heals gradually. Several meals stack (heal faster); the pool is capped.
  addSaturation(hp, seconds) {
    this.saturation.push({ rate: hp / seconds, left: hp });
    let over = this.saturationHP - SATURATION_CAP;
    for (let i = 0; i < this.saturation.length && over > 0; i++) {
      const cut = Math.min(over, this.saturation[i].left);
      this.saturation[i].left -= cut;
      over -= cut;
    }
    this.saturation = this.saturation.filter((e) => e.left > 0.01);
  }

  get saturationHP() {
    return this.saturation.reduce((n, e) => n + e.left, 0);
  }

  _tickSaturation(dt) {
    // Stored healing waits while you're at full health.
    if (!this.saturation.length || this.health >= 100) return;
    let heal = 0;
    for (const e of this.saturation) {
      const h = Math.min(e.left, e.rate * dt);
      e.left -= h;
      heal += h;
    }
    this.saturation = this.saturation.filter((e) => e.left > 0.01);
    this.health = Math.min(100, this.health + heal);
  }

  updateStats(dt) {
    this._tickSaturation(dt);
    if (this.game.cheats.god) {
      this.food = this.water = this.stamina = 100;
      return;
    }
    const exert = this.sprinting ? 1.8 : 1;
    this.food = Math.max(0, this.food - dt * (100 / 2700) * exert);
    this.water = Math.max(0, this.water - dt * (100 / 2000) * exert);
    let dmg = 0;
    if (this.food <= 0) dmg += 0.35 * dt;
    if (this.water <= 0) dmg += 0.5 * dt;
    if (this.bleeding) dmg += 0.55 * dt;
    if (this.infection > 0) {
      this.infection = Math.min(1, this.infection + dt / (DAY_LENGTH * 1.6));
      if (this.infection > 0.35) dmg += (this.infection - 0.35) * 0.6 * dt;
      if (this.infection >= 1) dmg += 100;
    }
    if (dmg > 0) this.game.damagePlayer(dmg, 'status', true);
    else if (this.food > 55 && this.water > 55 && this.health < 100) this.health = Math.min(100, this.health + 0.12 * dt);
  }
}
