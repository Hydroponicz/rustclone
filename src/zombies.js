import * as THREE from 'three';
import { clamp, damp, randRange } from './util.js';
import { Container, rollLoot } from './inventory.js';
import { WATER_LEVEL } from './world.js';

const SKIN = [0x8a9a7e, 0x7d8a73, 0x9a9585, 0x6f7d6a, 0xa09a88].map((c) => new THREE.MeshLambertMaterial({ color: c }));
const SHIRT = [0x5a3b32, 0x334b5f, 0x5b5f3a, 0x6d6d6d, 0x2e2e33, 0x7a5a3a, 0x4a2f4f, 0x8a8070].map((c) => new THREE.MeshLambertMaterial({ color: c }));
const PANTS = [0x2d3442, 0x3b3328, 0x2b2b2b, 0x4a4f3a, 0x504535].map((c) => new THREE.MeshLambertMaterial({ color: c }));
const BLOOD = new THREE.MeshLambertMaterial({ color: 0x4a0d0d });
const G = {
  head: new THREE.BoxGeometry(0.24, 0.27, 0.25),
  torso: new THREE.BoxGeometry(0.44, 0.62, 0.26),
  arm: new THREE.BoxGeometry(0.11, 0.62, 0.11).translate(0, -0.29, 0),
  leg: new THREE.BoxGeometry(0.16, 0.86, 0.17).translate(0, -0.43, 0),
  splat: new THREE.CircleGeometry(0.5, 8).rotateX(-Math.PI / 2),
};

const HIT_PARTS = [
  // name, local up, local forward, radius, damage mult
  ['head', 1.62, 0.1, 0.15, 3.5],
  ['thorax', 1.28, 0.04, 0.24, 1.0],
  ['stomach', 0.98, 0.0, 0.23, 0.9],
  ['legs', 0.58, 0.0, 0.2, 0.6],
  ['legs', 0.2, 0.0, 0.18, 0.6],
];
const CRAWL_PARTS = [
  ['head', 0.3, 0.9, 0.15, 3.5],
  ['thorax', 0.25, 0.45, 0.25, 1.0],
  ['stomach', 0.22, 0.05, 0.24, 0.9],
  ['legs', 0.15, -0.5, 0.2, 0.6],
];

let _id = 1;

class Zombie {
  constructor(mgr, x, z) {
    this.id = _id++;
    this.mgr = mgr;
    const rng = Math.random;
    this.pos = { x, y: mgr.game.physics.groundAt(x, z, 0.3, mgr.game.terrain.heightAt(x, z) + 1), z };
    this.yaw = rng() * Math.PI * 2;
    this.hp = 100;
    this.legHp = 55;
    this.alive = true;
    this.crawling = false;
    this.state = 'idle';
    this.stateT = randRange(rng, 1, 5);
    this.target = null;
    this.lastSeen = -100;
    this.seesPlayer = false;
    this.losT = rng() * 0.3;
    this.attackT = 0;
    this.windup = -1;
    this.stagger = 0;
    this.walkPhase = rng() * 10;
    this.speedMul = rng() < 0.15 ? 1.9 : randRange(rng, 0.85, 1.15);
    this.groanT = randRange(rng, 3, 15);
    this.stuckT = 0;
    this.sidestepT = 0;
    this.sidestepDir = 0;
    this.bashTarget = null;
    this.deadT = 0;
    this.loot = null;
    this._contacts = [];
    this._build();
  }

  _build() {
    const r = Math.random;
    const skin = SKIN[Math.floor(r() * SKIN.length)];
    const shirt = SHIRT[Math.floor(r() * SHIRT.length)];
    const pants = PANTS[Math.floor(r() * PANTS.length)];
    const g = new THREE.Group();
    const body = new THREE.Group();
    g.add(body);
    const torso = new THREE.Mesh(G.torso, shirt); torso.position.y = 1.2; body.add(torso);
    const head = new THREE.Mesh(G.head, skin); head.position.set(0, 1.64, 0.06); body.add(head);
    const armL = new THREE.Mesh(G.arm, r() < 0.5 ? shirt : skin); armL.position.set(-0.28, 1.47, 0); body.add(armL);
    const armR = new THREE.Mesh(G.arm, r() < 0.5 ? shirt : skin); armR.position.set(0.28, 1.47, 0); body.add(armR);
    const legL = new THREE.Mesh(G.leg, pants); legL.position.set(-0.11, 0.88, 0); body.add(legL);
    const legR = new THREE.Mesh(G.leg, pants); legR.position.set(0.11, 0.88, 0); body.add(legR);
    if (r() < 0.6) {
      const blood = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.02), BLOOD);
      blood.position.set(randRange(r, -0.1, 0.1), 1.25, 0.135);
      body.add(blood);
    }
    for (const m of [torso, head, armL, armR, legL, legR]) m.castShadow = true;
    this.parts = { body, torso, head, armL, armR, legL, legR };
    this.group = g;
    const s = randRange(r, 0.92, 1.08);
    g.scale.setScalar(s);
    this.scale = s;
    this.mgr.scene.add(g);
  }

  dispose() {
    this.mgr.scene.remove(this.group);
  }

  hitSpheres() {
    const parts = this.crawling ? CRAWL_PARTS : HIT_PARTS;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    return parts.map(([name, up, fwd, r, mul]) => ({
      name, mul, r: r * this.scale,
      x: this.pos.x + fx * fwd, y: this.pos.y + up * this.scale, z: this.pos.z + fz * fwd,
    }));
  }
}

export class ZombieManager {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.list = [];
    this.spawnT = 0;
    this.kills = 0;
    this.hordeDay = 0;
    this.splats = [];
  }

  get alive() {
    return this.list.filter((z) => z.alive);
  }

  clear() {
    for (const z of this.list) z.dispose();
    this.list = [];
  }

  inZone(x, z) {
    const t = this.game.terrain;
    return [t.town, t.military].some((zn) => Math.hypot(x - zn.x, z - zn.z) < zn.r);
  }

  targetCount() {
    const p = this.game.player.pos;
    const env = this.game.env;
    let n = env.isNight ? 30 : 16;
    if (this.inZone(p.x, p.z)) n += 14;
    n += Math.min(12, (env.day - 1) * 2); // the apocalypse gets worse every day
    return Math.min(n, this.game.settings.maxZombies);
  }

  trySpawn(near = null, count = 1, investigate = null) {
    const game = this.game;
    const p = game.player.pos;
    const cam = game.camera;
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    let spawned = 0;
    for (let tries = 0; tries < 20 * count && spawned < count; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = near ? randRange(Math.random, 0, 8) : randRange(Math.random, 38, 85);
      const cx = near ? near.x : p.x, cz = near ? near.z : p.z;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (Math.abs(x) > 300 || Math.abs(z) > 300) continue;
      const h = game.terrain.heightAt(x, z);
      if (h < 0.8) continue;
      if (!near) {
        const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
        if ((dx * fwd.x + dz * fwd.z) / d > 0.45 && d < 70) continue; // avoid popping in on screen
      }
      // Not inside walls
      const hits = game.physics.query(x - 0.4, z - 0.4, x + 0.4, z + 0.4);
      if (hits.some((b) => b.solid && b.maxY > h + 0.6)) continue;
      const zb = new Zombie(this, x, z);
      if (investigate) {
        zb.state = 'investigate';
        zb.target = { x: investigate.x + randRange(Math.random, -6, 6), z: investigate.z + randRange(Math.random, -6, 6) };
        zb.stateT = 60;
      }
      this.list.push(zb);
      spawned++;
    }
    return spawned;
  }

  // Sound attracts zombies within radius (Project Zomboid style).
  noise(x, z, radius) {
    for (const zb of this.list) {
      if (!zb.alive) continue;
      const d = Math.hypot(zb.pos.x - x, zb.pos.z - z);
      if (d > radius) continue;
      if (zb.state === 'chase' && zb.seesPlayer) continue;
      zb.state = 'investigate';
      const err = d * 0.15;
      zb.target = { x: x + randRange(Math.random, -err, err), z: z + randRange(Math.random, -err, err) };
      zb.stateT = 25;
    }
  }

  // Ray vs zombie hit spheres. Returns nearest { zombie, part, mul, t }.
  raycast(o, d, maxDist, includeDead = false) {
    let best = null;
    for (const zb of this.list) {
      if (!zb.alive && !includeDead) continue;
      const dx = zb.pos.x - o.x, dz = zb.pos.z - o.z;
      if (dx * dx + dz * dz > (maxDist + 3) ** 2) continue;
      const spheres = zb.alive ? zb.hitSpheres() : [{ name: 'corpse', mul: 0, r: 0.6, x: zb.pos.x, y: zb.pos.y + 0.25, z: zb.pos.z }];
      for (const s of spheres) {
        const ox = o.x - s.x, oy = o.y - s.y, oz = o.z - s.z;
        const b = ox * d.x + oy * d.y + oz * d.z;
        const c = ox * ox + oy * oy + oz * oz - s.r * s.r;
        const disc = b * b - c;
        if (disc < 0) continue;
        const t = -b - Math.sqrt(disc);
        if (t < 0 || t > maxDist) continue;
        if (!best || t < best.t) best = { zombie: zb, part: s.name, mul: s.mul, t };
      }
    }
    return best;
  }

  damage(zb, amount, part, dir, source = 'bullet') {
    if (!zb.alive) return;
    const game = this.game;
    zb.hp -= amount;
    if (part === 'legs') {
      zb.legHp -= amount;
      if (zb.legHp <= 0 && !zb.crawling) {
        zb.crawling = true;
        zb.parts.body.rotation.x = 0;
      }
    }
    zb.stagger = source === 'melee' ? 0.7 : part === 'head' ? 0.25 : 0.12;
    zb.windup = -1;
    if (dir) {
      zb.pos.x += dir.x * (source === 'melee' ? 0.35 : 0.08);
      zb.pos.z += dir.z * (source === 'melee' ? 0.35 : 0.08);
    }
    // Getting hit makes them aggro on you.
    zb.state = 'chase';
    zb.lastSeen = game.clock;
    this._splat(zb.pos.x, zb.pos.y, zb.pos.z, 0.4);
    if (zb.hp <= 0) this.kill(zb);
  }

  kill(zb) {
    zb.alive = false;
    zb.deadT = 0;
    zb.loot = new Container(6, 'Zombie');
    rollLoot(zb.loot, 'zombie');
    this.kills++;
    this.game.stats.kills++;
    this._splat(zb.pos.x, zb.pos.y, zb.pos.z, 0.8);
  }

  _splat(x, feetY, z, size) {
    const y = this.game.physics.groundAt(x, z, 0.3, feetY + 0.3) + 0.02;
    const m = new THREE.Mesh(G.splat, BLOOD);
    m.position.set(x + randRange(Math.random, -0.3, 0.3), y, z + randRange(Math.random, -0.3, 0.3));
    m.scale.setScalar(size * randRange(Math.random, 0.6, 1.3));
    this.scene.add(m);
    this.splats.push({ m, t: 90 });
    if (this.splats.length > 60) this.scene.remove(this.splats.shift().m);
  }

  _los(zb, p, eyeY) {
    const ox = zb.pos.x, oy = zb.pos.y + 1.6, oz = zb.pos.z;
    let dx = p.x - ox, dy = eyeY - oy, dz = p.z - oz;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return true;
    dx /= d; dy /= d; dz /= d;
    const hit = this.game.physics.raycast(ox, oy, oz, dx, dy, dz, d, { filter: (b) => b.kind !== 'node' || b.owner.type !== 'hemp' });
    return !hit;
  }

  update(dt) {
    const game = this.game;
    const player = game.player;
    const p = player.pos;
    const env = game.env;
    const night = env.isNight;

    // Population management
    this.spawnT -= dt;
    const aliveCount = this.list.reduce((n, z) => n + (z.alive ? 1 : 0), 0);
    if (this.spawnT <= 0 && !game.cheats.noSpawn) {
      this.spawnT = 1.2;
      if (aliveCount < this.targetCount()) this.trySpawn(null, 2);
    }
    // Nightly horde
    if (night && env.hours >= 22 && this.hordeDay !== env.day && player.alive && !game.cheats.noSpawn) {
      this.hordeDay = env.day;
      const a = Math.random() * Math.PI * 2;
      const c = { x: p.x + Math.cos(a) * 75, z: p.z + Math.sin(a) * 75 };
      const n = this.trySpawn(c, 6 + env.day * 3, p);
      if (n > 0) game.ui.message('⚠ You hear a horde shambling closer...', 'warn');
    }

    const sightBase = night ? (game.combat.flashlightOn ? 34 : 13) : 34;
    const sight = player.crouching ? sightBase * 0.55 : sightBase;
    const eyeY = p.y + player.eyeH;

    for (let i = this.list.length - 1; i >= 0; i--) {
      const zb = this.list[i];
      const dx = p.x - zb.pos.x, dz = p.z - zb.pos.z;
      const dist = Math.hypot(dx, dz);

      if (!zb.alive) {
        zb.deadT += dt;
        const k = clamp(zb.deadT / 0.6, 0, 1);
        zb.parts.body.rotation.x = -k * Math.PI / 2 * (zb.crawling ? 0 : 1);
        if (zb.crawling) zb.parts.body.rotation.x = Math.PI / 2;
        zb.parts.body.position.y = k * 0.15;
        if (zb.deadT > 150 || dist > 160) { zb.dispose(); this.list.splice(i, 1); }
        continue;
      }
      if (dist > 135 && zb.state !== 'chase') { zb.dispose(); this.list.splice(i, 1); continue; }
      if (game.cheats.freezeAI) { this._animate(zb, dt, 0); continue; }

      // --- perception
      zb.losT -= dt;
      if (game.cheats.noTarget) {
        zb.seesPlayer = false;
        if (zb.state === 'chase') { zb.state = 'idle'; zb.stateT = 2; zb.windup = -1; }
      } else if (zb.losT <= 0 && player.alive) {
        zb.losT = 0.25 + Math.random() * 0.15;
        let sees = false;
        if (dist < sight) {
          const fx = Math.sin(zb.yaw), fz = Math.cos(zb.yaw);
          const dot = (dx * fx + dz * fz) / Math.max(dist, 0.01);
          if (dot > -0.2 || dist < 3.5) sees = this._los(zb, p, eyeY);
        }
        zb.seesPlayer = sees;
        if (sees) {
          if (zb.state !== 'chase' && zb.state !== 'bash') game.audio.play('groan', dist, 0);
          if (zb.state !== 'bash' || dist < 6) zb.state = 'chase';
          zb.lastSeen = game.clock;
          zb.target = { x: p.x, z: p.z };
        }
      }
      if (zb.state === 'chase') {
        if (zb.seesPlayer) zb.target = { x: p.x, z: p.z };
        else if (game.clock - zb.lastSeen > 6) { zb.state = 'investigate'; zb.stateT = 12; }
        if (!player.alive) { zb.state = 'idle'; zb.stateT = 3; }
      }

      // --- groans
      zb.groanT -= dt;
      if (zb.groanT <= 0) {
        zb.groanT = randRange(Math.random, 6, 18);
        if (dist < 45) game.audio.play('groan', dist, this._pan(zb));
      }

      // --- behaviour
      let moveTo = null;
      let speed = 0;
      const chaseSpeed = (night ? 2.5 : 1.55) * zb.speedMul;
      zb.stagger -= dt;
      if (zb.stagger > 0) {
        speed = 0;
      } else if (zb.state === 'chase') {
        moveTo = zb.target;
        speed = chaseSpeed;
        const dy = Math.abs(p.y - zb.pos.y);
        if (dist < 1.3 && dy < 1.7 && player.alive) {
          speed = 0.3;
          zb.attackT -= dt;
          if (zb.windup < 0 && zb.attackT <= 0) zb.windup = 0;
        }
      } else if (zb.state === 'investigate') {
        moveTo = zb.target;
        speed = 1.25 * zb.speedMul;
        zb.stateT -= dt;
        if (!moveTo || Math.hypot(moveTo.x - zb.pos.x, moveTo.z - zb.pos.z) < 1.5 || zb.stateT <= 0) {
          zb.state = 'idle'; zb.stateT = randRange(Math.random, 3, 8);
        }
      } else if (zb.state === 'bash') {
        const piece = zb.bashTarget;
        if (!piece || piece.destroyed) { zb.state = zb.seesPlayer ? 'chase' : 'investigate'; zb.stateT = 10; }
        else {
          zb.attackT -= dt;
          if (zb.attackT <= 0) {
            zb.attackT = 1.5;
            zb.windup = 0.0001;
            game.building.damagePiece(piece, night ? 9 : 6, 'zombie');
            game.audio.play('bash', dist, this._pan(zb));
          }
          const c = piece.center;
          zb.yaw = Math.atan2(c.x - zb.pos.x, c.z - zb.pos.z);
        }
      } else if (zb.state === 'wander') {
        moveTo = zb.target;
        speed = 0.7 * zb.speedMul;
        zb.stateT -= dt;
        if (!moveTo || zb.stateT <= 0 || Math.hypot(moveTo.x - zb.pos.x, moveTo.z - zb.pos.z) < 1) { zb.state = 'idle'; zb.stateT = randRange(Math.random, 2, 7); }
      } else {
        zb.stateT -= dt;
        if (zb.stateT <= 0) {
          zb.state = 'wander';
          zb.stateT = randRange(Math.random, 6, 14);
          const a = Math.random() * Math.PI * 2, r = randRange(Math.random, 5, 20);
          zb.target = { x: zb.pos.x + Math.cos(a) * r, z: zb.pos.z + Math.sin(a) * r };
        }
      }
      if (zb.crawling) speed *= 0.35;

      // --- attack windup -> hit
      if (zb.windup >= 0 && zb.state !== 'bash') {
        zb.windup += dt;
        if (zb.windup > 0.45) {
          zb.windup = -1;
          zb.attackT = 1.3;
          const dy = Math.abs(p.y - zb.pos.y);
          if (dist < 1.65 && dy < 1.8 && player.alive) game.zombieHitsPlayer();
        }
      } else if (zb.windup >= 0) {
        zb.windup += dt;
        if (zb.windup > 0.5) zb.windup = -1;
      }

      // --- movement with obstacle handling
      let moving = false;
      if (moveTo && speed > 0) {
        let mx = moveTo.x - zb.pos.x, mz = moveTo.z - zb.pos.z;
        const ml = Math.hypot(mx, mz);
        if (ml > 0.6 || (zb.state === 'chase' && ml > 0.9)) {
          mx /= ml; mz /= ml;
          if (zb.sidestepT > 0) {
            zb.sidestepT -= dt;
            const sx = -mz * zb.sidestepDir, sz = mx * zb.sidestepDir;
            mx = mx * 0.3 + sx; mz = mz * 0.3 + sz;
            const l2 = Math.hypot(mx, mz); mx /= l2; mz /= l2;
          }
          const wantYaw = Math.atan2(mx, mz);
          let dyaw = wantYaw - zb.yaw;
          while (dyaw > Math.PI) dyaw -= Math.PI * 2;
          while (dyaw < -Math.PI) dyaw += Math.PI * 2;
          zb.yaw += dyaw * Math.min(1, dt * 5);
          const ox = zb.pos.x, oz = zb.pos.z;
          zb.pos.x += mx * speed * dt;
          zb.pos.z += mz * speed * dt;
          // Avoid wading into the sea
          if (game.terrain.heightAt(zb.pos.x, zb.pos.z) < WATER_LEVEL - 0.6) { zb.pos.x = ox; zb.pos.z = oz; }
          game.physics.resolveCircle(zb.pos, 0.3, zb.pos.y, 1.75, zb._contacts);
          const moved = Math.hypot(zb.pos.x - ox, zb.pos.z - oz);
          moving = moved > speed * dt * 0.3;
          if (!moving) zb.stuckT += dt;
          else zb.stuckT = Math.max(0, zb.stuckT - dt);
          if (zb.stuckT > 0.7) {
            zb.stuckT = 0;
            const piece = zb._contacts.map((b) => b.kind === 'build' && b.owner).find(Boolean);
            if (piece && (zb.state === 'chase' || zb.state === 'investigate')) {
              zb.state = 'bash';
              zb.bashTarget = piece;
              zb.attackT = 0.6;
            } else {
              zb.sidestepT = randRange(Math.random, 0.8, 2);
              zb.sidestepDir = Math.random() < 0.5 ? -1 : 1;
            }
          }
        }
      }
      // separation
      for (let j = 0; j < this.list.length; j++) {
        const o = this.list[j];
        if (o === zb || !o.alive) continue;
        const sx = zb.pos.x - o.pos.x, sz = zb.pos.z - o.pos.z;
        const d2 = sx * sx + sz * sz;
        if (d2 < 0.36 && d2 > 1e-6) {
          const d = Math.sqrt(d2), push = (0.6 - d) * 0.5;
          zb.pos.x += (sx / d) * push; zb.pos.z += (sz / d) * push;
        }
      }
      // don't stand inside the player
      if (dist < 0.62 && dist > 1e-4 && player.alive) {
        zb.pos.x -= (dx / dist) * (0.62 - dist);
        zb.pos.z -= (dz / dist) * (0.62 - dist);
      }
      const ground = game.physics.groundAt(zb.pos.x, zb.pos.z, 0.3, zb.pos.y);
      zb.pos.y = damp(zb.pos.y, ground, 18, dt);
      if (zb.pos.y < ground - 0.6 || zb.pos.y > ground + 2) zb.pos.y = ground;

      this._animate(zb, dt, moving ? speed : 0);
    }

    for (let i = this.splats.length - 1; i >= 0; i--) {
      const s = this.splats[i];
      s.t -= dt;
      if (s.t <= 0) { this.scene.remove(s.m); this.splats.splice(i, 1); }
    }
  }

  _pan(zb) {
    const cam = this.game.camera;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const dx = zb.pos.x - cam.position.x, dz = zb.pos.z - cam.position.z;
    const d = Math.hypot(dx, dz) || 1;
    return (dx * right.x + dz * right.z) / d;
  }

  _animate(zb, dt, speed) {
    const P = zb.parts;
    zb.group.position.set(zb.pos.x, zb.pos.y, zb.pos.z);
    zb.group.rotation.y = zb.yaw;
    zb.walkPhase += dt * (1.5 + speed * 2.6);
    const sw = Math.sin(zb.walkPhase);
    if (zb.crawling) {
      P.body.rotation.x = Math.PI / 2 - 0.15;
      P.body.position.set(0, 0.32, -0.9);
      P.armL.rotation.x = -2.6 + sw * 0.5;
      P.armR.rotation.x = -2.6 - sw * 0.5;
      P.legL.rotation.x = 0.1; P.legR.rotation.x = -0.1;
      return;
    }
    const amp = speed > 0 ? 0.55 : 0.05;
    P.legL.rotation.x = sw * amp;
    P.legR.rotation.x = -sw * amp;
    let reach = -1.35 + Math.sin(zb.walkPhase * 0.5) * 0.12;
    if (zb.windup >= 0) {
      const k = zb.windup / 0.45;
      reach = k < 0.6 ? -1.35 - k * 1.2 : -2.0 + (k - 0.6) * 3;
    }
    P.armL.rotation.x = reach + sw * 0.1;
    P.armR.rotation.x = reach - sw * 0.1;
    P.armL.rotation.z = 0.1; P.armR.rotation.z = -0.1;
    P.body.rotation.x = 0.12 + (zb.stagger > 0 ? -0.25 : 0);
    P.body.rotation.z = Math.sin(zb.walkPhase * 0.5) * 0.05;
    P.head.rotation.z = Math.sin(zb.walkPhase * 0.3 + zb.id) * 0.2;
  }

  serialize() {
    return null; // zombies respawn dynamically
  }
}
