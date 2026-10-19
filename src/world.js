import * as THREE from 'three';
import { fbm, valueNoise, smoothstep, mulberry32, randRange, canvasTexture, pick } from './util.js';
import { makeBox } from './physics.js';
import { Container, rollLoot } from './inventory.js';

export const WORLD_SIZE = 640;
export const HALF = WORLD_SIZE / 2;
export const WATER_LEVEL = 0;
const RES = 256;
const SEED = 1337;

// ---------------------------------------------------------------- terrain
export class Terrain {
  constructor() {
    this.zones = [];
    this.heights = new Float32Array((RES + 1) * (RES + 1));
    this.step = WORLD_SIZE / RES;
    this._pickZones();
    for (let iz = 0; iz <= RES; iz++) {
      for (let ix = 0; ix <= RES; ix++) {
        const x = -HALF + ix * this.step, z = -HALF + iz * this.step;
        this.heights[iz * (RES + 1) + ix] = this.shapedHeight(x, z);
      }
    }
  }

  rawHeight(x, z) {
    const d = Math.sqrt(x * x + z * z) / HALF;
    const n = fbm(x * 0.0045 + 3.1, z * 0.0045 - 7.7, 5, SEED);
    const ridge = 1 - Math.abs(fbm(x * 0.009, z * 0.009, 3, SEED + 99) * 2 - 1);
    const mountain = smoothstep(0.45, 0.75, fbm(x * 0.002, z * 0.002, 2, SEED + 5));
    let h = 2.5 + (n - 0.32) * 30 + ridge * ridge * 14 * mountain;
    h += (valueNoise(x * 0.08, z * 0.08, SEED + 3) - 0.5) * 0.6;
    h -= smoothstep(0.62, 0.98, d) * 38;
    return h;
  }

  shapedHeight(x, z) {
    let h = this.rawHeight(x, z);
    for (const zn of this.zones) {
      const d = Math.hypot(x - zn.x, z - zn.z);
      const t = smoothstep(zn.r, zn.r * 0.72, d);
      h = h + (zn.h - h) * t;
    }
    return h;
  }

  _findFlatSpot(cx, cz, r, minH, avoid) {
    for (let ring = 0; ring < 30; ring++) {
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2 + ring;
        const x = cx + Math.cos(ang) * ring * 12, z = cz + Math.sin(ang) * ring * 12;
        if (Math.hypot(x, z) > HALF * 0.55) continue;
        if (avoid && Math.hypot(x - avoid.x, z - avoid.z) < avoid.r + r + 20) continue;
        let ok = true, sum = 0;
        for (let k = 0; k < 16 && ok; k++) {
          const ka = (k / 16) * Math.PI * 2;
          const h = this.rawHeight(x + Math.cos(ka) * r, z + Math.sin(ka) * r);
          if (h < minH) ok = false;
          sum += h;
        }
        if (ok) return { x, z, h: Math.max(sum / 16, minH + 1) };
      }
    }
    return { x: cx, z: cz, h: 6 };
  }

  _pickZones() {
    const town = this._findFlatSpot(60, 40, 72, 2.5);
    this.town = { x: town.x, z: town.z, r: 78, h: town.h };
    this.zones.push(this.town);
    const mil = this._findFlatSpot(-120, -100, 36, 3, this.town);
    this.military = { x: mil.x, z: mil.z, r: 40, h: mil.h };
    this.zones.push(this.military);
  }

  heightAt(x, z) {
    const gx = (x + HALF) / this.step, gz = (z + HALF) / this.step;
    if (gx < 0 || gz < 0 || gx >= RES || gz >= RES) return -30;
    const ix = Math.floor(gx), iz = Math.floor(gz);
    const fx = gx - ix, fz = gz - iz;
    const W = RES + 1, H = this.heights;
    const a = H[iz * W + ix], b = H[iz * W + ix + 1], c = H[(iz + 1) * W + ix], d = H[(iz + 1) * W + ix + 1];
    return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
  }

  slopeAt(x, z) {
    const e = 1.5;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return Math.hypot(dx, dz) / (2 * e);
  }

  buildMesh() {
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, RES, RES);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const col = new THREE.Color();
    const sand = new THREE.Color(0xc2b38a), wetSand = new THREE.Color(0x8d7f5e);
    const grass = new THREE.Color(0x5d7a3a), grass2 = new THREE.Color(0x7a8a45);
    const dirt = new THREE.Color(0x6b5a41), rock = new THREE.Color(0x77736b);
    for (let i = 0; i < pos.count; i++) {
      const ix = i % (RES + 1), iz = Math.floor(i / (RES + 1));
      const h = this.heights[iz * (RES + 1) + ix];
      pos.setY(i, h);
      const x = pos.getX(i), z = pos.getZ(i);
      const n = valueNoise(x * 0.05, z * 0.05, 7);
      const slope = this.slopeAt(x, z);
      if (h < 0.4) col.copy(wetSand);
      else if (h < 2.2) col.copy(sand).lerp(grass, smoothstep(1.4, 2.2, h));
      else col.copy(grass).lerp(grass2, n);
      if (h > 2.2) col.lerp(dirt, smoothstep(0.55, 0.85, valueNoise(x * 0.02, z * 0.02, 9)) * 0.6);
      col.lerp(rock, smoothstep(0.55, 0.9, slope));
      if (h > 20) col.lerp(rock, smoothstep(20, 26, h));
      col.multiplyScalar(0.92 + n * 0.16);
      colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const detail = canvasTexture(THREE, 256, (g, s) => {
      const img = g.createImageData(s, s);
      for (let i = 0; i < s * s; i++) {
        const v = 200 + Math.random() * 55;
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    }, 160);
    detail.colorSpace = THREE.NoColorSpace;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: detail });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    return mesh;
  }

  // A point on the beach, used for fresh spawns.
  beachSpawn(rng = Math.random) {
    for (let tries = 0; tries < 50; tries++) {
      const a = rng() * Math.PI * 2;
      let lastLand = null;
      for (let r = 40; r < HALF; r += 2) {
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const h = this.heightAt(x, z);
        if (h > 1.8) lastLand = { x, z, h };
        if (h < 0.5 && lastLand) {
          const dt = this.town;
          if (Math.hypot(lastLand.x - dt.x, lastLand.z - dt.z) < dt.r) break;
          return lastLand;
        }
      }
    }
    return { x: 0, z: 0, h: this.heightAt(0, 0) };
  }
}

// ---------------------------------------------------------------- shared materials
function plankTex(base, line) {
  return canvasTexture(THREE, 128, (g, s) => {
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 16) {
      g.fillStyle = line; g.fillRect(0, y, s, 2);
      for (let k = 0; k < 6; k++) {
        g.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`;
        g.fillRect(Math.random() * s, y + 2, Math.random() * 60, 14);
      }
    }
  });
}

function noiseTex(base, amt = 30, blocks = false) {
  return canvasTexture(THREE, 128, (g, s) => {
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i++) {
      const v = Math.random() * amt - amt / 2;
      g.fillStyle = v > 0 ? `rgba(255,255,255,${v / 255})` : `rgba(0,0,0,${-v / 255})`;
      g.fillRect(Math.random() * s, Math.random() * s, 3, 3);
    }
    if (blocks) {
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2;
      for (let y = 0; y < s; y += 32) {
        g.beginPath(); g.moveTo(0, y); g.lineTo(s, y); g.stroke();
        const off = (y / 32) % 2 ? 32 : 0;
        for (let x = off; x < s; x += 64) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 32); g.stroke(); }
      }
    }
  });
}

export const MATS = {};
export function initMaterials() {
  MATS.trunk = new THREE.MeshLambertMaterial({ color: 0x5a4030 });
  MATS.pine = new THREE.MeshLambertMaterial({ color: 0x2f4a2a });
  MATS.stone = new THREE.MeshLambertMaterial({ color: 0x8a8780, flatShading: true });
  MATS.ore = new THREE.MeshLambertMaterial({ color: 0x8a6a55, flatShading: true });
  MATS.sulfur = new THREE.MeshLambertMaterial({ color: 0xb5a65a, flatShading: true });
  MATS.barrel = new THREE.MeshLambertMaterial({ color: 0x3f5d7a });
  MATS.hemp = new THREE.MeshLambertMaterial({ color: 0x6fae3e });
  MATS.logs = new THREE.MeshLambertMaterial({ color: 0x7a5232 });
  MATS.siding = [0x8a9aa5, 0xa58f74, 0x9aa58a, 0xb0a99a, 0x7d6b5c].map(
    (c) => new THREE.MeshLambertMaterial({ map: plankTex('#' + c.toString(16).padStart(6, '0'), 'rgba(0,0,0,0.25)') })
  );
  MATS.roof = new THREE.MeshLambertMaterial({ map: plankTex('#4a3a35', 'rgba(0,0,0,0.4)') });
  MATS.floor = new THREE.MeshLambertMaterial({ map: plankTex('#7a6046', 'rgba(0,0,0,0.3)') });
  MATS.concrete = new THREE.MeshLambertMaterial({ map: noiseTex('#8c8c88', 40) });
  MATS.road = new THREE.MeshLambertMaterial({ map: noiseTex('#3b3b3d', 25) });
  MATS.furniture = new THREE.MeshLambertMaterial({ color: 0x6d4f36 });
  MATS.fridge = new THREE.MeshLambertMaterial({ color: 0xd9d6cc });
  MATS.carColors = [0x7a2b22, 0x2b4a7a, 0x5d5d5a, 0x3a5a3a, 0x8a7a3a].map(
    (c) => new THREE.MeshLambertMaterial({ color: c, map: noiseTex('#ffffff', 90) })
  );
  MATS.glass = new THREE.MeshLambertMaterial({ color: 0x223038 });
  MATS.military = new THREE.MeshLambertMaterial({ color: 0x4b5a35, map: noiseTex('#ffffff', 60) });
  MATS.sandbag = new THREE.MeshLambertMaterial({ map: noiseTex('#a39270', 50, true) });
  MATS.tent = new THREE.MeshLambertMaterial({ color: 0x5a6340, side: THREE.DoubleSide });
  MATS.stoneBlocks = noiseTex('#8d8a84', 40, true);
  MATS.woodPlanks = plankTex('#8a6340', 'rgba(0,0,0,0.35)');
  MATS.metalTex = canvasTexture(THREE, 128, (g, s) => {
    g.fillStyle = '#5d6266'; g.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 12) { g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x, 0, 5, s); }
    for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(120,60,20,${Math.random() * 0.3})`; g.fillRect(Math.random() * s, Math.random() * s, 8, 8); }
  });
  MATS.twigTex = canvasTexture(THREE, 128, (g, s) => {
    g.clearRect(0, 0, s, s);
    g.strokeStyle = '#c9a874'; g.lineWidth = 5;
    for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(Math.random() * s, 0); g.lineTo(Math.random() * s, s); g.stroke(); }
    for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(0, Math.random() * s); g.lineTo(s, Math.random() * s); g.stroke(); }
    g.strokeStyle = '#a07f4e'; g.lineWidth = 8; g.strokeRect(0, 0, s, s);
  });
}

// ---------------------------------------------------------------- resource nodes
// amount: resources held; perScale: amount scales with the node's size; fellBonus: extra share on the last hit.
const NODE_DEFS = {
  tree: { yield: 'wood', amount: 300, perScale: true, fellBonus: 0.15, respawn: 300 },
  woodpile: { yield: 'wood', amount: 200, respawn: 480 },
  stone: { yield: 'stone', amount: 160, respawn: 360 },
  ore: { yield: 'metal_ore', amount: 120, bonus: 'stone', respawn: 420 },
  sulfur: { yield: 'sulfur_ore', amount: 110, bonus: 'stone', respawn: 420 },
  barrel: { hp: 30, respawn: 420 },
  hemp: { yield: 'cloth', amount: 10, respawn: 200 },
};

// Merge indexed geometries that share position/normal/uv attributes into one.
function mergeGeometries(geos) {
  let nv = 0, ni = 0;
  for (const g of geos) { nv += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  const idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const g of geos) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    uv.set(g.attributes.uv.array, vo * 2);
    const gi = g.index.array;
    for (let k = 0; k < gi.length; k++) idx[io + k] = gi[k] + vo;
    vo += n;
    io += gi.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();

class NodeSet {
  constructor(scene, geo, mat, count, castShadow = true) {
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.castShadow = castShadow;
    this.mesh.receiveShadow = true;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }
  set(i, x, y, z, scale, rotY, visible = true) {
    _q.setFromAxisAngle(_p.set(0, 1, 0), rotY);
    _s.set(scale, scale, scale);
    if (!visible) _s.set(0.0001, 0.0001, 0.0001);
    _m.compose(_p.set(x, y, z), _q, _s);
    this.mesh.setMatrixAt(i, _m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- loot containers & world objects
export class LootSpot {
  constructor(name, table, size = 6) {
    this.kind = 'loot';
    this.name = name;
    this.table = table;
    this.container = new Container(size, name);
    this.respawnAt = 0;
    this.searched = false;
    rollLoot(this.container, table);
  }
  label() {
    return `Search ${this.name}`;
  }
  interact(game) {
    this.searched = true;
    game.ui.openContainer(this.container, this);
  }
  onClose(game) {
    if (this.container.isEmpty()) this.respawnAt = game.clock + randRange(Math.random, 420, 720);
  }
  refill() {
    this.container.clear();
    rollLoot(this.container, this.table);
    this.respawnAt = 0;
  }
  update(game) {
    if (this.respawnAt && game.clock > this.respawnAt && game.ui.openTarget !== this) {
      const p = this.pos;
      if (!p || Math.hypot(p.x - game.player.pos.x, p.z - game.player.pos.z) > 40) this.refill();
    }
  }
}

export class World {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.physics = game.physics;
    this.terrain = game.terrain;
    this.nodes = [];
    this.lootSpots = [];
    this.rng = mulberry32(SEED);
    this.staticBuckets = new Map();
    this.mapFeatures = []; // footprints for the map: { type, x, z, w, d }
  }

  build() {
    const scene = this.scene;
    scene.add(this.terrain.buildMesh());

    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshPhongMaterial({ color: 0x2b5568, transparent: true, opacity: 0.82, shininess: 80, specular: 0x557788 })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = WATER_LEVEL;
    scene.add(water);
    this.water = water;

    const seabed = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshLambertMaterial({ color: 0x3d4a3f }));
    seabed.rotation.x = -Math.PI / 2;
    seabed.position.y = -30;
    scene.add(seabed);

    this._buildTown();
    this._buildMilitary();
    this._flushStatic();
    this._scatterNodes();
  }

  // --- generic static box helpers
  // Static boxes are batched per material and map chunk, then merged into a few meshes in
  // _flushStatic() to keep draw calls low.
  addStatic(cx, cy, cz, sx, sy, sz, mat, opts = {}) {
    const geo = new THREE.BoxGeometry(sx, sy, sz).translate(cx, cy, cz);
    const shadow = opts.shadow !== false;
    const key = `${mat.uuid}|${shadow}|${Math.floor(cx / 48)},${Math.floor(cz / 48)}`;
    let bucket = this.staticBuckets.get(key);
    if (!bucket) this.staticBuckets.set(key, (bucket = { mat, shadow, geos: [] }));
    bucket.geos.push(geo);
    const handle = { position: new THREE.Vector3(cx, cy, cz), box: null };
    if (opts.collide !== false) {
      const box = makeBox(cx - sx / 2, cy - sy / 2, cz - sz / 2, cx + sx / 2, cy + sy / 2, cz + sz / 2, opts.kind || 'static', opts.owner || null, opts.solid !== false);
      this.physics.add(box);
      handle.box = box;
    }
    return handle;
  }

  _flushStatic() {
    for (const { mat, shadow, geos } of this.staticBuckets.values()) {
      const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      for (const g of geos) g.dispose();
    }
    this.staticBuckets.clear();
  }

  // Box defined in a rotated local frame (rot = quarter turns), base y given.
  _localBox(frame, lx, ly, lz, sx, sy, sz, mat, opts) {
    const { x, z, rot } = frame;
    let wx, wz;
    switch (rot & 3) {
      case 0: wx = lx; wz = lz; break;
      case 1: wx = lz; wz = -lx; break;
      case 2: wx = -lx; wz = -lz; break;
      default: wx = -lz; wz = lx; break;
    }
    const swap = rot & 1;
    return this.addStatic(x + wx, frame.y + ly, z + wz, swap ? sz : sx, sy, swap ? sx : sz, mat, opts);
  }

  // Wall along local X (axis 'x', at local z = c) or along local Z (axis 'z', at local x = c).
  _wall(frame, axis, c, from, to, H, T, mat, openings = []) {
    const seg = (a, b, y0, y1) => {
      if (b - a < 0.01 || y1 - y0 < 0.01) return;
      const mid = (a + b) / 2, len = b - a, h = y1 - y0;
      if (axis === 'x') this._localBox(frame, mid, y0 + h / 2, c, len, h, T, mat);
      else this._localBox(frame, c, y0 + h / 2, mid, T, h, len, mat);
    };
    let cur = from;
    openings.sort((p, q) => p.a - q.a);
    for (const o of openings) {
      seg(cur, o.a, 0, H);
      seg(o.a, o.b, 0, o.bottom);
      seg(o.a, o.b, o.top, H);
      cur = o.b;
    }
    seg(cur, to, 0, H);
  }

  _lootBox(frame, lx, lz, sx, sy, sz, mat, name, table) {
    const spot = new LootSpot(name, table);
    const mesh = this._localBox(frame, lx, sy / 2, lz, sx, sy, sz, mat, { owner: spot, kind: 'loot' });
    spot.pos = mesh.position.clone();
    this.lootSpots.push(spot);
    return spot;
  }

  _house(x, z, rot, rng) {
    const W = 9, D = 7.5, H = 2.9, T = 0.2;
    this.mapFeatures.push({ type: 'house', x, z, w: rot & 1 ? D : W, d: rot & 1 ? W : D });
    const base = this.terrain.town.h + 0.3;
    const frame = { x, z, rot, y: base };
    const siding = pick(rng, MATS.siding);
    // Foundation slab (walkable)
    this._localBox({ ...frame, y: base - 0.6 }, 0, 0.3, 0, W, 0.6, D, MATS.concrete);
    this._localBox({ ...frame, y: base - 0.6 }, 0, 0.301, 0, W - 0.4, 0.6, D - 0.4, MATS.floor, { collide: false, shadow: false });
    const hw = W / 2, hd = D / 2;
    const win = (a) => ({ a, b: a + 1.2, bottom: 0.95, top: 2.0 });
    const door = (a) => ({ a, b: a + 1.25, bottom: 0, top: 2.2 });
    // Front (+z) with door, back (-z), sides
    this._wall(frame, 'x', hd - T / 2, -hw, hw, H, T, siding, [door(-2.8), win(1.2)]);
    this._wall(frame, 'x', -hd + T / 2, -hw, hw, H, T, siding, [win(-3), win(1.6)]);
    this._wall(frame, 'z', -hw + T / 2, -hd + T, hd - T, H, T, siding, [win(-0.6)]);
    this._wall(frame, 'z', hw - T / 2, -hd + T, hd - T, H, T, siding, [rng() < 0.5 ? door(-0.6) : win(-0.6)]);
    // Interior partition with doorway
    this._wall(frame, 'z', 0.3, -hd + T, hd - T, H, 0.12, MATS.floor, [door(-0.8)]);
    // Ceiling / flat roof (walkable) + pitched visual roof
    this._localBox(frame, 0, H + 0.12, 0, W + 0.5, 0.25, D + 0.5, MATS.roof);
    const shape = new THREE.Shape();
    shape.moveTo(-hd - 0.4, 0); shape.lineTo(hd + 0.4, 0); shape.lineTo(0, 1.7); shape.closePath();
    const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: W + 0.6, bevelEnabled: false });
    roofGeo.translate(0, 0, -(W + 0.6) / 2);
    roofGeo.rotateY(Math.PI / 2);
    const roof = new THREE.Mesh(roofGeo, MATS.roof);
    roof.position.set(x, base + H + 0.24, z);
    roof.rotation.y = rot * Math.PI / 2;
    roof.castShadow = true;
    this.scene.add(roof);
    // Furniture + loot
    this._lootBox(frame, -hw + 1.4, -hd + 0.55, 2.2, 0.9, 0.7, MATS.furniture, 'Kitchen Cabinet', 'kitchen');
    this._lootBox(frame, -hw + 0.6, -hd + 2.0, 0.75, 1.8, 0.75, MATS.fridge, 'Fridge', 'kitchen');
    this._lootBox(frame, hw - 0.5, -hd + 1.4, 0.6, 2.0, 1.4, MATS.furniture, 'Wardrobe', 'closet');
    if (rng() < 0.6) this._lootBox(frame, hw - 2.4, hd - 0.6, 1.4, 0.8, 0.6, MATS.furniture, 'Dresser', 'closet');
  }

  _car(x, z, rot, rng) {
    const y = this.terrain.heightAt(x, z);
    const frame = { x, z, rot, y };
    const mat = pick(rng, MATS.carColors);
    const spot = new LootSpot('Car Wreck', 'car');
    const body = this._localBox(frame, 0, 0.7, 0, 1.9, 0.9, 4.3, mat, { owner: spot, kind: 'loot' });
    this._localBox(frame, 0, 1.45, -0.2, 1.7, 0.6, 2.2, MATS.glass, { owner: spot, kind: 'loot' });
    for (const [wx, wz] of [[-0.9, 1.3], [0.9, 1.3], [-0.9, -1.3], [0.9, -1.3]]) {
      this._localBox(frame, wx, 0.3, wz, 0.3, 0.6, 0.6, MATS.road, { collide: false });
    }
    spot.pos = body.position.clone();
    this.lootSpots.push(spot);
  }

  _buildTown() {
    const t = this.terrain.town, rng = this.rng;
    const y = t.h + 0.02;
    // Roads (visual only)
    this.addStatic(t.x, y, t.z, 120, 0.04, 8, MATS.road, { collide: false, shadow: false });
    this.mapFeatures.push({ type: 'road', x: t.x, z: t.z, w: 120, d: 8 }, { type: 'road', x: t.x, z: t.z, w: 8, d: 120 });
    this.addStatic(t.x, y + 0.005, t.z, 8, 0.04, 120, MATS.road, { collide: false, shadow: false });
    const lots = [];
    for (const k of [-3, -2, -1, 1, 2, 3]) {
      lots.push([t.x + k * 15, t.z + 12, 2], [t.x + k * 15, t.z - 12, 0]);
    }
    for (const k of [-3, -2, 2, 3]) {
      lots.push([t.x + 12, t.z + k * 14, 3], [t.x - 12, t.z + k * 14, 1]);
    }
    for (const [hx, hz, r] of lots) {
      // Leave room near the crossroads
      if (Math.abs(hx - t.x) < 14 && Math.abs(hz - t.z) < 14) continue;
      if (rng() < 0.12) continue;
      this._house(hx, hz, r, rng);
    }
    for (let i = 0; i < 9; i++) {
      const alongX = rng() < 0.5;
      const off = randRange(rng, -50, 50);
      const lane = randRange(rng, -2.5, 2.5);
      const cx = alongX ? t.x + off : t.x + lane, cz = alongX ? t.z + lane : t.z + off;
      if (Math.abs(off) < 6) continue;
      this._car(cx, cz, alongX ? (rng() < 0.5 ? 1 : 3) : (rng() < 0.5 ? 0 : 2), rng);
    }
  }

  _buildMilitary() {
    const m = this.terrain.military, rng = this.rng;
    const y = m.h;
    this.addStatic(m.x, y + 0.02, m.z, 34, 0.04, 34, MATS.concrete, { collide: false, shadow: false });
    this.mapFeatures.push({ type: 'pad', x: m.x, z: m.z, w: 34, d: 34 });
    // Sandbag perimeter with gaps
    const bag = (cx, cz, sx, sz) => {
      this.mapFeatures.push({ type: 'sandbag', x: cx, z: cz, w: sx, d: sz });
      return this.addStatic(cx, y + 0.55, cz, sx, 1.1, sz, MATS.sandbag);
    };
    bag(m.x - 9, m.z - 16, 14, 1); bag(m.x + 9, m.z - 16, 14, 1);
    bag(m.x - 9, m.z + 16, 14, 1); bag(m.x + 9, m.z + 16, 14, 1);
    bag(m.x - 16, m.z - 9, 1, 14); bag(m.x - 16, m.z + 9, 1, 14);
    bag(m.x + 16, m.z - 9, 1, 14); bag(m.x + 16, m.z + 9, 1, 14);
    // Tents
    for (const [tx, tz] of [[-7, -7], [7, -7], [-7, 7]]) {
      const tent = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 3.4, 6, 4, 1, true), MATS.tent);
      tent.position.set(m.x + tx, y + 1.5, m.z + tz);
      tent.rotation.y = Math.PI / 4;
      tent.scale.set(1, 0.5, 1);
      tent.castShadow = true;
      this.scene.add(tent);
    }
    // Watchtower
    const tx = m.x + 8, tz = m.z + 8;
    for (const [ox, oz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) {
      this.addStatic(tx + ox, y + 2.5, tz + oz, 0.25, 5, 0.25, MATS.furniture);
    }
    this.addStatic(tx, y + 5.1, tz, 3.2, 0.2, 3.2, MATS.floor);
    // Steep stairs up the -z side
    for (let i = 0; i < 10; i++) {
      const top = y + 0.52 * (i + 1);
      this.addStatic(tx, top - 0.06, tz - 1.8 - (9 - i) * 0.42, 1.0, 0.12, 0.42, MATS.furniture);
    }
    // Military crates
    const crates = [[-7, -3.5], [7, -3.5], [-7, 10.5], [0, 0], [3, -12]];
    for (const [cx, cz] of crates) {
      const spot = new LootSpot('Military Crate', 'military', 8);
      const mesh = this.addStatic(m.x + cx, y + 0.45, m.z + cz, 1.6, 0.9, 0.9, MATS.military, { owner: spot, kind: 'loot' });
      spot.pos = mesh.position.clone();
      this.lootSpots.push(spot);
    }
    for (let i = 0; i < 3; i++) this._car(m.x + randRange(rng, -12, 12), m.z + 22 + i * 6, rng() < 0.5 ? 1 : 3, rng);
  }

  _scatterNodes() {
    const rng = this.rng, T = this.terrain;
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 4.2, 6).translate(0, 2.1, 0);
    const leafGeo = new THREE.ConeGeometry(2.1, 6.5, 7).translate(0, 6.2, 0);
    const rockGeo = new THREE.DodecahedronGeometry(1.1, 0);
    const barrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.15, 12).translate(0, 0.575, 0);
    const hempGeo = new THREE.ConeGeometry(0.35, 1.3, 5).translate(0, 0.65, 0);
    // Wood pile: a 3-2-1 stack of logs lying along X
    const logs = [];
    for (const [ly, lz] of [[0.17, -0.36], [0.17, 0], [0.17, 0.36], [0.46, -0.18], [0.46, 0.18], [0.75, 0]]) {
      logs.push(new THREE.CylinderGeometry(0.17, 0.17, 1.5, 8).rotateZ(Math.PI / 2).translate(0, ly, lz));
    }
    const pileGeo = mergeGeometries(logs);
    const counts = { tree: 900, stone: 140, ore: 110, sulfur: 80, barrel: 70, hemp: 120, woodpile: 60 };
    this.sets = {
      trunk: new NodeSet(this.scene, trunkGeo, MATS.trunk, counts.tree),
      leaf: new NodeSet(this.scene, leafGeo, MATS.pine, counts.tree),
      stone: new NodeSet(this.scene, rockGeo, MATS.stone, counts.stone),
      ore: new NodeSet(this.scene, rockGeo, MATS.ore, counts.ore),
      sulfur: new NodeSet(this.scene, rockGeo, MATS.sulfur, counts.sulfur),
      barrel: new NodeSet(this.scene, barrelGeo, MATS.barrel, counts.barrel),
      hemp: new NodeSet(this.scene, hempGeo, MATS.hemp, counts.hemp, false),
      woodpile: new NodeSet(this.scene, pileGeo, MATS.logs, counts.woodpile),
    };
    const inZone = (x, z, pad) => this.terrain.zones.some((zn) => Math.hypot(x - zn.x, z - zn.z) < zn.r + pad);

    const place = (type, n, accept) => {
      let placed = 0, tries = 0;
      while (placed < n && tries < n * 40) {
        tries++;
        const x = randRange(rng, -HALF * 0.95, HALF * 0.95), z = randRange(rng, -HALF * 0.95, HALF * 0.95);
        const h = T.heightAt(x, z);
        if (!accept(x, z, h)) continue;
        this._addNode(type, x, h, z, rng);
        placed++;
      }
    };
    place('tree', counts.tree, (x, z, h) => {
      if (h < 2.4 || T.slopeAt(x, z) > 0.7 || inZone(x, z, -8)) return false;
      const forest = fbm(x * 0.01, z * 0.01, 3, 51);
      return rng() < smoothstep(0.38, 0.6, forest) + 0.04;
    });
    for (const type of ['stone', 'ore', 'sulfur']) {
      place(type, counts[type], (x, z, h) => h > 1.6 && !inZone(x, z, 0) && (h > 9 || rng() < 0.4));
    }
    place('hemp', counts.hemp, (x, z, h) => h > 2 && h < 14 && !inZone(x, z, 0) && T.slopeAt(x, z) < 0.4);
    // Barrels cluster near town roads and the military base, plus some in the wild
    let b = 0;
    while (b < counts.barrel) {
      let x, z;
      if (b < 35) {
        const t = this.terrain.town;
        const alongX = rng() < 0.5, off = randRange(rng, -58, 58), lane = (rng() < 0.5 ? -1 : 1) * randRange(rng, 4.6, 6);
        x = alongX ? t.x + off : t.x + lane; z = alongX ? t.z + lane : t.z + off;
      } else if (b < 45) {
        const m = this.terrain.military;
        x = m.x + randRange(rng, -14, 14); z = m.z + randRange(rng, -14, 14);
      } else {
        x = randRange(rng, -HALF * 0.8, HALF * 0.8); z = randRange(rng, -HALF * 0.8, HALF * 0.8);
      }
      const h = T.heightAt(x, z);
      if (h < 1.5) continue;
      const near = this.physics.query(x - 0.6, z - 0.6, x + 0.6, z + 0.6);
      if (near.length) continue;
      this._addNode('barrel', x, h, z, rng);
      b++;
    }
    // Wood piles (placed last so every other node keeps its seeded position): forest edges,
    // the outskirts of town and the checkpoint.
    let w = 0, tries = 0;
    while (w < counts.woodpile && tries++ < 6000) {
      let x, z;
      if (w < 40) {
        x = randRange(rng, -HALF * 0.85, HALF * 0.85); z = randRange(rng, -HALF * 0.85, HALF * 0.85);
        const forest = fbm(x * 0.01, z * 0.01, 3, 51);
        if (forest < 0.36 || forest > 0.55 || inZone(x, z, 0)) continue;
      } else if (w < 54) {
        const t = this.terrain.town, a = rng() * Math.PI * 2, r = randRange(rng, 30, 64);
        x = t.x + Math.cos(a) * r; z = t.z + Math.sin(a) * r;
      } else {
        const m = this.terrain.military;
        x = m.x + randRange(rng, -13, 13); z = m.z + randRange(rng, -13, 13);
      }
      const h = T.heightAt(x, z);
      if (h < 2 || T.slopeAt(x, z) > 0.35) continue;
      if (this.physics.query(x - 1.4, z - 1.4, x + 1.4, z + 1.4).length) continue;
      this._addNode('woodpile', x, h, z, rng);
      w++;
    }
  }

  _addNode(type, x, y, z, rng) {
    const def = NODE_DEFS[type];
    const node = { kind: 'node', type, x, y, z, rot: rng() * Math.PI * 2, alive: true, respawnAt: 0, box: null };
    if (type === 'tree') {
      node.scale = randRange(rng, 0.75, 1.45);
      node.index = this.sets.trunk.mesh.count++;
      this.sets.leaf.mesh.count++;
      const r = 0.38 * node.scale;
      node.box = makeBox(x - r, y - 1, z - r, x + r, y + 9 * node.scale, z + r, 'node', node);
    } else if (type === 'barrel') {
      node.scale = 1;
      node.index = this.sets.barrel.mesh.count++;
      node.box = makeBox(x - 0.42, y - 0.2, z - 0.42, x + 0.42, y + 1.15, z + 0.42, 'node', node);
    } else if (type === 'woodpile') {
      node.scale = 1;
      node.rot = rng() < 0.5 ? 0 : Math.PI / 2; // quarter turns keep the box axis-aligned
      node.index = this.sets.woodpile.mesh.count++;
      const hx = node.rot ? 0.5 : 0.78, hz = node.rot ? 0.78 : 0.5;
      node.box = makeBox(x - hx, y - 0.2, z - hz, x + hx, y + 0.92, z + hz, 'node', node);
    } else if (type === 'hemp') {
      node.scale = randRange(rng, 0.8, 1.2);
      node.index = this.sets.hemp.mesh.count++;
      node.box = makeBox(x - 0.35, y, z - 0.35, x + 0.35, y + 1.3, z + 0.35, 'node', node, false);
    } else {
      node.scale = randRange(rng, 0.8, 1.35);
      node.index = this.sets[type].mesh.count++;
      const r = 0.95 * node.scale;
      node.y = y - 0.25 * node.scale;
      node.box = makeBox(x - r, y - 1, z - r, x + r, node.y + 1.0 * node.scale, z + r, 'node', node);
    }
    node.amount = def.amount || 0;
    node.hp = def.hp || 0;
    this._showNode(node, true);
    this.nodes.push(node);
  }

  _showNode(node, visible) {
    const { x, y, z, scale, rot, index } = node;
    if (node.type === 'tree') {
      this.sets.trunk.set(index, x, y, z, scale, rot, visible);
      this.sets.leaf.set(index, x, y, z, scale, rot, visible);
    } else {
      this.sets[node.type].set(index, x, y, z, scale, rot, visible);
    }
    node.alive = visible;
    if (visible) {
      this.physics.add(node.box);
      const def = NODE_DEFS[node.type];
      node.amount = Math.round((def.amount || 0) * (def.perScale ? node.scale : 1));
      node.maxAmount = node.amount;
      node.hp = def.hp || 0;
    } else {
      this.physics.remove(node.box);
    }
  }

  // Is something the player built (or placed) sitting on this node's spot?
  nodeBlocked(node, margin = 1) {
    const b = node.box;
    for (const o of this.physics.query(b.minX - margin, b.minZ - margin, b.maxX + margin, b.maxZ + margin)) {
      if ((o.kind === 'build' || o.kind === 'deploy') && o.maxY > b.minY - 1 && o.minY < b.maxY + 1) return true;
    }
    return false;
  }

  // Remove live nodes that overlap player structures (after loading a save, or after building).
  clearNodesUnderBuildings(clock) {
    let n = 0;
    for (const node of this.nodes) {
      if (node.alive && this.nodeBlocked(node)) { this.depleteNode(node, clock); n++; }
    }
    return n;
  }

  depleteNode(node, clock) {
    this._showNode(node, false);
    node.respawnAt = clock + NODE_DEFS[node.type].respawn * randRange(Math.random, 0.8, 1.3);
  }

  update(dt, clock) {
    // Respawn nodes and loot slowly; spread work across frames.
    this._updIdx = ((this._updIdx || 0) + 1) % 30;
    const p = this.game.player.pos;
    for (let i = this._updIdx; i < this.nodes.length; i += 30) {
      const n = this.nodes[i];
      if (!n.alive && clock > n.respawnAt && Math.hypot(n.x - p.x, n.z - p.z) > 30) {
        // Never regrow inside a base; try again later in case it gets torn down.
        if (this.nodeBlocked(n)) n.respawnAt = clock + 120;
        else this._showNode(n, true);
      }
    }
    for (let i = this._updIdx; i < this.lootSpots.length; i += 30) this.lootSpots[i].update(this.game);
  }
}

export { NODE_DEFS };
