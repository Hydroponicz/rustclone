import * as THREE from 'three';
import { makeBox } from './physics.js';
import { MATS } from './world.js';
import { Container } from './inventory.js';
import { ITEMS } from './items.js';

// Rust-style grid building: foundations, walls, doorways, windows, floors and stairs.
export const GRID = 3;
const WALL_H = 3;
const T = 0.2;

export const PIECES = {
  foundation: { name: 'Foundation', mult: 1 },
  wall: { name: 'Wall', mult: 1 },
  doorway: { name: 'Doorway', mult: 0.8 },
  window: { name: 'Window', mult: 0.8 },
  floor: { name: 'Floor', mult: 0.6 },
  stairs: { name: 'Stairs', mult: 1 },
};
export const PIECE_ORDER = ['foundation', 'wall', 'doorway', 'window', 'floor', 'stairs'];
export const TIERS = [
  { id: 'twig', name: 'Twig', hp: 30, cost: { wood: 40 } },
  { id: 'wood', name: 'Wood', hp: 300, cost: { wood: 150 } },
  { id: 'stone', name: 'Stone', hp: 650, cost: { stone: 250 } },
  { id: 'metal', name: 'Sheet Metal', hp: 1300, cost: { metal_frags: 150 } },
];
const DOOR_HP = 220;
const WALL_RECTS = {
  wall: [[0, 3, 0, 3]],
  doorway: [[0, 0.9, 0, 3], [2.1, 3, 0, 3], [0.9, 2.1, 2.2, 3]],
  window: [[0, 1, 0, 3], [2, 3, 0, 3], [1, 2, 0, 1], [1, 2, 2, 3]],
};
const isWallType = (t) => t === 'wall' || t === 'doorway' || t === 'window';
const isCellType = (t) => t === 'foundation' || t === 'floor' || t === 'stairs';

export function scaledCost(cost, mult) {
  const o = {};
  for (const k in cost) o[k] = Math.ceil(cost[k] * mult);
  return o;
}

export function costText(cost) {
  return Object.entries(cost).map(([k, v]) => `${v} ${ITEMS[k].name}`).join(', ');
}

const cellKey = (i, j) => `${i},${j}`;
const edgeKey = (i, j, axis) => `${i},${j},${axis}`;

function wallBoxes(i, j, axis, y, rects, thick = T) {
  const out = [];
  for (const [a0, a1, v0, v1] of rects) {
    if (axis === 'x') out.push([i * GRID + a0, y + v0, j * GRID - thick / 2, i * GRID + a1, y + v1, j * GRID + thick / 2]);
    else out.push([i * GRID - thick / 2, y + v0, j * GRID + a0, i * GRID + thick / 2, y + v1, j * GRID + a1]);
  }
  return out;
}

// Returns list of [minX, minY, minZ, maxX, maxY, maxZ]
export function shapeBoxes(spec) {
  const { type, i, j, axis, y } = spec;
  const x0 = i * GRID, z0 = j * GRID;
  switch (type) {
    case 'foundation': return [[x0, spec.bottom, z0, x0 + GRID, y, z0 + GRID]];
    case 'floor': return [[x0, y - 0.2, z0, x0 + GRID, y, z0 + GRID]];
    case 'stairs': {
      const out = [];
      for (let k = 0; k < 6; k++) {
        const a0 = k * 0.5, a1 = (k + 1) * 0.5, top = y + (k + 1) * 0.5;
        const m = 0.15;
        switch (spec.dir & 3) {
          case 0: out.push([x0 + m, y, z0 + a0, x0 + GRID - m, top, z0 + a1]); break;
          case 1: out.push([x0 + a0, y, z0 + m, x0 + a1, top, z0 + GRID - m]); break;
          case 2: out.push([x0 + m, y, z0 + GRID - a1, x0 + GRID - m, top, z0 + GRID - a0]); break;
          default: out.push([x0 + GRID - a1, y, z0 + m, x0 + GRID - a0, top, z0 + GRID - m]); break;
        }
      }
      return out;
    }
    case 'door': return wallBoxes(i, j, axis, y, [[0.9, 2.1, 0, 2.2]], 0.08);
    default: return wallBoxes(i, j, axis, y, WALL_RECTS[type]);
  }
}

const geoCache = new Map();
function boxGeo(sx, sy, sz) {
  const k = `${sx.toFixed(3)},${sy.toFixed(3)},${sz.toFixed(3)}`;
  let g = geoCache.get(k);
  if (!g) geoCache.set(k, (g = new THREE.BoxGeometry(sx, sy, sz)));
  return g;
}

function meshFromBoxes(boxes, mat) {
  const g = new THREE.Group();
  for (const b of boxes) {
    const m = new THREE.Mesh(boxGeo(b[3] - b[0], b[4] - b[1], b[5] - b[2]), mat);
    m.position.set((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

// ------------------------------------------------------------------ deployables
const DEPLOY = {
  box: { name: 'Storage Box', size: [0.95, 0.62, 0.62], slots: 18, item: 'storage_box' },
  furnace: { name: 'Furnace', size: [0.95, 1.25, 0.95], slots: 6, item: 'furnace', burn: 2.2, smelt: true },
  campfire: { name: 'Campfire', size: [0.85, 0.3, 0.85], slots: 3, item: 'campfire', burn: 3.0 },
  bag: { name: 'Sleeping Bag', size: [0.8, 0.14, 1.9], item: 'sleeping_bag' },
};

function deployMesh(type) {
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
  if (type === 'box') {
    add(new THREE.BoxGeometry(0.95, 0.55, 0.62), new THREE.MeshLambertMaterial({ map: MATS.woodPlanks }), 0, 0.275, 0);
    add(new THREE.BoxGeometry(0.98, 0.08, 0.65), new THREE.MeshLambertMaterial({ color: 0x5a4030 }), 0, 0.58, 0);
  } else if (type === 'furnace') {
    add(new THREE.CylinderGeometry(0.4, 0.48, 1.1, 10), new THREE.MeshLambertMaterial({ map: MATS.stoneBlocks }), 0, 0.55, 0);
    add(new THREE.CylinderGeometry(0.15, 0.2, 0.3, 8), new THREE.MeshLambertMaterial({ color: 0x55524d }), 0, 1.2, 0);
    g.userData.glow = add(new THREE.BoxGeometry(0.3, 0.22, 0.05), new THREE.MeshBasicMaterial({ color: 0x220a00 }), 0, 0.3, 0.44);
  } else if (type === 'campfire') {
    const logMat = new THREE.MeshLambertMaterial({ color: 0x4a3322 });
    for (let k = 0; k < 4; k++) {
      const l = add(new THREE.CylinderGeometry(0.06, 0.06, 0.8, 6), logMat, 0, 0.1, 0);
      l.rotation.z = Math.PI / 2 - 0.25; l.rotation.y = (k * Math.PI) / 4;
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      add(new THREE.DodecahedronGeometry(0.09), MATS.stone, Math.cos(a) * 0.38, 0.05, Math.sin(a) * 0.38);
    }
    g.userData.glow = add(new THREE.ConeGeometry(0.22, 0.5, 6), new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.85 }), 0, 0.35, 0);
  } else if (type === 'bag') {
    add(new THREE.BoxGeometry(0.8, 0.12, 1.9), new THREE.MeshLambertMaterial({ color: 0x3c5a7a }), 0, 0.06, 0);
    add(new THREE.BoxGeometry(0.6, 0.12, 0.35), new THREE.MeshLambertMaterial({ color: 0xc8c0b0 }), 0, 0.14, -0.7);
  }
  return g;
}

class Deployable {
  constructor(mgr, type, x, y, z, rot) {
    this.kind = 'deploy';
    this.mgr = mgr;
    this.type = type;
    this.def = DEPLOY[type];
    this.x = x; this.y = y; this.z = z; this.rot = rot & 3;
    this.on = false;
    this.fuelT = 0;
    this.smeltT = 0;
    this.container = this.def.slots ? new Container(this.def.slots, this.def.name) : null;
    this.mesh = deployMesh(type);
    this.mesh.position.set(x, y, z);
    this.mesh.rotation.y = this.rot * Math.PI / 2;
    mgr.scene.add(this.mesh);
    const [sx, sy, sz] = this.def.size;
    const hx = (this.rot & 1 ? sz : sx) / 2, hz = (this.rot & 1 ? sx : sz) / 2;
    this.box = makeBox(x - hx, y, z - hz, x + hx, y + sy, z + hz, 'deploy', this);
    mgr.game.physics.add(this.box);
    this.center = { x, y: y + sy / 2, z };
  }
  get name() { return this.def.name; }
  label() {
    if (this.type === 'bag') return this.mgr.spawnBag === this ? 'Sleeping Bag (respawn point)' : 'Set respawn at Sleeping Bag';
    if (this.def.burn) return `Open ${this.def.name}${this.on ? ' (lit)' : ''}`;
    return `Open ${this.def.name}`;
  }
  interact(game) {
    if (this.type === 'bag') {
      this.mgr.spawnBag = this;
      game.ui.message('Respawn point set.');
      return;
    }
    game.ui.openContainer(this.container, this);
  }
  get canToggle() { return !!this.def.burn; }
  toggle() {
    if (this.on) { this.on = false; return; }
    if (this.fuelT > 0 || this.container.count('wood') > 0) this.on = true;
    else this.mgr.game.ui.message('Needs wood to burn.', 'warn');
  }
  update(dt) {
    if (!this.def.burn) return;
    const glow = this.mesh.userData.glow;
    if (this.on) {
      this.fuelT -= dt;
      if (this.fuelT <= 0) {
        if (this.container.count('wood') > 0) {
          this.container.remove('wood', 1);
          if (Math.random() < 0.75) this.container.add('charcoal', 1);
          this.fuelT = this.def.burn;
        } else {
          this.on = false;
        }
      }
      if (this.def.smelt && this.on) {
        this.smeltT += dt;
        while (this.smeltT >= 0.5) {
          this.smeltT -= 0.5;
          if (this.container.count('metal_ore') > 0) {
            this.container.remove('metal_ore', 1);
            if (this.container.add('metal_frags', 1) > 0) this.container.add('metal_ore', 1);
          } else if (this.container.count('sulfur_ore') > 0) {
            this.container.remove('sulfur_ore', 1);
            if (this.container.add('sulfur', 1) > 0) this.container.add('sulfur_ore', 1);
          }
        }
      }
    }
    if (glow) {
      if (this.type === 'furnace') glow.material.color.setHex(this.on ? 0xff7a1a : 0x220a00);
      else { glow.visible = this.on; glow.scale.y = 0.8 + Math.random() * 0.4; }
    }
  }
  dispose() {
    this.mgr.scene.remove(this.mesh);
    this.mgr.game.physics.remove(this.box);
  }
  serialize() {
    return { type: this.type, x: this.x, y: this.y, z: this.z, rot: this.rot, on: this.on, slots: this.container ? this.container.serialize() : null };
  }
}

// ------------------------------------------------------------------ manager
export class BuildingManager {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.pieces = [];
    this.cells = new Map();
    this.edges = new Map();
    this.deployables = [];
    this.spawnBag = null;
    this.pieceIdx = 0;
    this.ghost = null;
    this.ghostKey = '';
    this.plan = null; // current placement candidate
    this.rotation = 0;
    this.tierMats = [
      new THREE.MeshLambertMaterial({ map: MATS.twigTex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, color: 0xe0c9a0 }),
      new THREE.MeshLambertMaterial({ map: MATS.woodPlanks }),
      new THREE.MeshLambertMaterial({ map: MATS.stoneBlocks }),
      new THREE.MeshLambertMaterial({ map: MATS.metalTex }),
    ];
    this.doorMat = new THREE.MeshLambertMaterial({ map: MATS.woodPlanks, color: 0xb08a60 });
    this.ghostOk = new THREE.MeshBasicMaterial({ color: 0x55ff88, transparent: true, opacity: 0.35, depthWrite: false });
    this.ghostBad = new THREE.MeshBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.22, depthWrite: false });
    this.lightPool = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xff9a40, 0, 14, 1.6);
      this.scene.add(l);
      this.lightPool.push(l);
    }
  }

  get pieceType() {
    return PIECE_ORDER[this.pieceIdx];
  }

  cyclePiece(dir = 1) {
    this.pieceIdx = (this.pieceIdx + dir + PIECE_ORDER.length) % PIECE_ORDER.length;
  }

  // ---------------------------------------------------------------- lookup helpers
  cellPieces(i, j) { return this.cells.get(cellKey(i, j)) || []; }
  edgePieces(i, j, axis) { return this.edges.get(edgeKey(i, j, axis)) || []; }

  _supportsAt(cells, minY, maxY) {
    let best = null;
    for (const [i, j] of cells) {
      for (const p of this.cellPieces(i, j)) {
        if (p.type === 'stairs') continue;
        if (p.y >= minY && p.y <= maxY && (!best || p.y > best.y)) best = p;
      }
    }
    return best;
  }

  _edgeCells(i, j, axis) {
    return axis === 'x' ? [[i, j - 1], [i, j]] : [[i - 1, j], [i, j]];
  }

  _cellEdges(i, j) {
    return [[i, j, 'x'], [i, j + 1, 'x'], [i, j, 'z'], [i + 1, j, 'z']];
  }

  _obstructed(boxes) {
    for (const b of boxes) {
      const hits = this.game.physics.query(b[0] + 0.05, b[2] + 0.05, b[3] - 0.05, b[5] - 0.05);
      for (const h of hits) {
        if (!h.solid || h.kind === 'build') continue;
        if (h.kind === 'deploy' && h.maxY <= b[1] + 0.05) continue;
        if (h.maxY > b[1] + 0.3 && h.minY < b[4] - 0.05) return true;
      }
    }
    return false;
  }

  _playerInside(boxes) {
    const p = this.game.player.pos, r = 0.33, h = this.game.player.height;
    for (const b of boxes) {
      if (p.x + r > b[0] && p.x - r < b[3] && p.z + r > b[2] && p.z - r < b[5] && p.y + h > b[1] && p.y + 0.4 < b[4]) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- placement planning
  planPiece(type, ray) {
    const game = this.game;
    const phys = game.physics;
    const hit = phys.raycast(ray.o.x, ray.o.y, ray.o.z, ray.d.x, ray.d.y, ray.d.z, 9, { filter: (b) => b.kind !== 'node' || b.owner.type !== 'hemp' });
    const dist = hit ? hit.dist : 4.5;
    const px = ray.o.x + ray.d.x * Math.min(dist, 9), py = ray.o.y + ray.d.y * Math.min(dist, 9), pz = ray.o.z + ray.d.z * Math.min(dist, 9);
    let i = Math.floor(px / GRID), j = Math.floor(pz / GRID);
    const fx = px / GRID - i, fz = pz / GRID - j;
    const plan = { type, valid: false, reason: '' };

    if (type === 'foundation') {
      if (!hit) return { ...plan, reason: 'Aim at the ground' };
      if (hit.box && hit.box.kind === 'build' && hit.box.owner.type === 'foundation' && hit.ny > 0.5) {
        // Looking at a foundation top: extend toward the nearest edge.
        const d = [fx, 1 - fx, fz, 1 - fz];
        const m = Math.min(...d);
        if (m === d[0]) i--; else if (m === d[1]) i++; else if (m === d[2]) j--; else j++;
      }
      const corners = [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]].map(([a, b]) => game.terrain.heightAt((i + a) * GRID, (j + b) * GRID));
      const maxT = Math.max(...corners), minT = Math.min(...corners);
      let top = maxT + 0.3;
      for (const [ni, nj] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
        const f = this.cellPieces(ni, nj).find((p) => p.type === 'foundation');
        if (f && f.y >= maxT + 0.05 && Math.abs(f.y - top) < 1.6) { top = f.y; break; }
      }
      Object.assign(plan, { i, j, y: top, bottom: minT - 0.8 });
      plan.boxes = shapeBoxes(plan);
      if (this.cellPieces(i, j).some((p) => p.type === 'foundation' || Math.abs(p.y - top) < 2.5)) return { ...plan, reason: 'Occupied' };
      if (minT < -0.3) return { ...plan, reason: 'Too deep in water' };
      if (top - minT > 3.6) return { ...plan, reason: 'Ground too steep' };
      if (this._obstructed(plan.boxes)) return { ...plan, reason: 'Blocked' };
      plan.valid = true;
      return plan;
    }

    if (isWallType(type)) {
      const d = [fx, 1 - fx, fz, 1 - fz];
      const m = Math.min(...d);
      let ei = i, ej = j, axis;
      if (m === d[0]) axis = 'z';
      else if (m === d[1]) { axis = 'z'; ei = i + 1; }
      else if (m === d[2]) axis = 'x';
      else { axis = 'x'; ej = j + 1; }
      const sup = this._supportsAt(this._edgeCells(ei, ej, axis), py - 3.3, py + 2.0);
      Object.assign(plan, { i: ei, j: ej, axis, y: sup ? sup.y : py });
      plan.boxes = shapeBoxes(plan);
      if (!sup) return { ...plan, noSupport: true, reason: 'Needs a foundation or floor' };
      if (this.edgePieces(ei, ej, axis).some((p) => Math.abs(p.y - sup.y) < 0.5)) return { ...plan, reason: 'Occupied' };
      if (this._obstructed(plan.boxes)) return { ...plan, reason: 'Blocked' };
      if (this._playerInside(plan.boxes)) return { ...plan, reason: 'You are in the way' };
      plan.valid = true;
      return plan;
    }

    if (type === 'floor') {
      // Intersect the view ray with the plane of each nearby wall top and take the
      // closest cell that has a wall supporting it at that height.
      let best = null;
      const tops = new Set();
      for (const w of this.pieces) {
        if (isWallType(w.type) && Math.hypot(w.center.x - ray.o.x, w.center.z - ray.o.z) < 14) tops.add(w.y + WALL_H);
      }
      let bestT = Infinity;
      for (const top of tops) {
        if (Math.abs(ray.d.y) < 1e-4) continue;
        const t = (top - ray.o.y) / ray.d.y;
        if (t <= 0.5 || t > 10 || t >= bestT) continue;
        const ci = Math.floor((ray.o.x + ray.d.x * t) / GRID), cj = Math.floor((ray.o.z + ray.d.z * t) / GRID);
        const ok = this._cellEdges(ci, cj).some(([ei, ej, a]) => this.edgePieces(ei, ej, a).some((w) => Math.abs(w.y + WALL_H - top) < 0.05));
        if (ok) { bestT = t; best = top; i = ci; j = cj; }
      }
      Object.assign(plan, { i, j, y: best ?? py });
      plan.boxes = shapeBoxes(plan);
      if (best === null) return { ...plan, noSupport: true, reason: 'Needs walls underneath' };
      if (this.cellPieces(i, j).some((p) => (p.type === 'stairs' ? Math.abs(p.y + WALL_H - best) < 0.5 : Math.abs(p.y - best) < 0.5))) return { ...plan, reason: 'Occupied' };
      if (this._playerInside(plan.boxes)) return { ...plan, reason: 'You are in the way' };
      plan.valid = true;
      return plan;
    }

    if (type === 'stairs') {
      const sup = this._supportsAt([[i, j]], py - 1.5, py + 0.6);
      const yaw = game.player.yaw;
      // Steps rise in the direction the player is facing.
      const fwdX = -Math.sin(yaw), fwdZ = -Math.cos(yaw);
      const dir = Math.abs(fwdZ) > Math.abs(fwdX) ? (fwdZ > 0 ? 0 : 2) : (fwdX > 0 ? 1 : 3);
      Object.assign(plan, { i, j, y: sup ? sup.y : py, dir });
      plan.boxes = shapeBoxes(plan);
      if (!sup) return { ...plan, noSupport: true, reason: 'Needs a foundation or floor' };
      if (this.cellPieces(i, j).some((p) => (p.type === 'stairs' && Math.abs(p.y - sup.y) < 0.5) || (p.type === 'floor' && Math.abs(p.y - (sup.y + WALL_H)) < 0.5))) return { ...plan, reason: 'Occupied' };
      if (this._obstructed(plan.boxes)) return { ...plan, reason: 'Blocked' };
      if (this._playerInside(plan.boxes)) return { ...plan, reason: 'You are in the way' };
      plan.valid = true;
      return plan;
    }
    return plan;
  }

  planDoor(ray) {
    const plan = { type: 'door', valid: false, reason: 'Aim at a doorway' };
    // The doorway opening is empty space, so intersect the ray with each nearby doorway's plane.
    const hit = this.game.physics.raycast(ray.o.x, ray.o.y, ray.o.z, ray.d.x, ray.d.y, ray.d.z, 5);
    const maxT = hit ? hit.dist + 0.15 : 5;
    let dw = null, bestT = Infinity;
    for (const p of this.pieces) {
      if (p.type !== 'doorway') continue;
      const fixed = p.axis === 'x' ? p.j * GRID : p.i * GRID;
      const o = p.axis === 'x' ? ray.o.z : ray.o.x, d = p.axis === 'x' ? ray.d.z : ray.d.x;
      if (Math.abs(d) < 1e-4) continue;
      const t = (fixed - o) / d;
      if (t <= 0 || t > maxT || t >= bestT) continue;
      const a = (p.axis === 'x' ? ray.o.x + ray.d.x * t - p.i * GRID : ray.o.z + ray.d.z * t - p.j * GRID);
      const v = ray.o.y + ray.d.y * t - p.y;
      if (a < 0 || a > GRID || v < 0 || v > WALL_H) continue;
      bestT = t;
      dw = p;
    }
    if (!dw) return plan;
    Object.assign(plan, { i: dw.i, j: dw.j, axis: dw.axis, y: dw.y, parent: dw });
    plan.boxes = shapeBoxes(plan);
    if (dw.door) return { ...plan, reason: 'Already has a door' };
    if (this._playerInside(plan.boxes)) return { ...plan, reason: 'You are in the way' };
    plan.valid = true;
    plan.reason = '';
    return plan;
  }

  planDeploy(type, ray) {
    const def = DEPLOY[type];
    const phys = this.game.physics;
    const hit = phys.raycast(ray.o.x, ray.o.y, ray.o.z, ray.d.x, ray.d.y, ray.d.z, 5, { filter: (b) => b.kind !== 'node' || b.owner.type !== 'hemp' });
    const yaw = this.game.player.yaw;
    const rot = ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4;
    const plan = { type, deploy: true, rot, valid: false, reason: 'Aim at the ground' };
    if (!hit || hit.ny < 0.5) return plan;
    const [sx, sy, sz] = def.size;
    const hx = (rot & 1 ? sz : sx) / 2, hz = (rot & 1 ? sx : sz) / 2;
    Object.assign(plan, { x: hit.x, y: hit.y, z: hit.z });
    plan.boxes = [[hit.x - hx, hit.y, hit.z - hz, hit.x + hx, hit.y + sy, hit.z + hz]];
    const hits = phys.query(hit.x - hx, hit.z - hz, hit.x + hx, hit.z + hz);
    for (const h of hits) {
      if (!h.solid) continue;
      if (h.maxY <= hit.y + 0.05 || h.minY >= hit.y + sy) continue;
      return { ...plan, reason: 'Blocked' };
    }
    if (hit.y < -0.2) return { ...plan, reason: 'Too wet' };
    if (this._playerInside(plan.boxes) && type !== 'bag') return { ...plan, reason: 'You are in the way' };
    plan.valid = true;
    plan.reason = '';
    return plan;
  }

  // ---------------------------------------------------------------- ghost
  showGhost(plan) {
    // Without anything to snap to, only the reason text is shown (no floating ghost).
    if (!plan || !plan.boxes || plan.noSupport) { this.hideGhost(); return; }
    const key = JSON.stringify(plan.boxes.map((b) => b.map((v) => v.toFixed(2)))) + plan.valid;
    if (key !== this.ghostKey) {
      this.hideGhost();
      this.ghost = meshFromBoxes(plan.boxes, plan.valid ? this.ghostOk : this.ghostBad);
      this.ghost.traverse((o) => { o.castShadow = false; o.receiveShadow = false; o.renderOrder = 5; });
      this.scene.add(this.ghost);
      this.ghostKey = key;
    }
  }

  hideGhost() {
    if (this.ghost) this.scene.remove(this.ghost);
    this.ghost = null;
    this.ghostKey = '';
  }

  // ---------------------------------------------------------------- create / destroy
  addPiece(spec, tier = 0, hp = null) {
    const piece = {
      kind: 'piece', type: spec.type, tier, i: spec.i, j: spec.j, axis: spec.axis, y: spec.y,
      bottom: spec.bottom, dir: spec.dir, destroyed: false, door: null, open: false,
    };
    piece.maxHp = spec.type === 'door' ? DOOR_HP : TIERS[tier].hp;
    piece.hp = hp ?? piece.maxHp;
    this._buildPieceVisual(piece);
    this.pieces.push(piece);
    if (isCellType(piece.type)) {
      const k = cellKey(piece.i, piece.j);
      if (!this.cells.has(k)) this.cells.set(k, []);
      this.cells.get(k).push(piece);
    } else if (isWallType(piece.type)) {
      const k = edgeKey(piece.i, piece.j, piece.axis);
      if (!this.edges.has(k)) this.edges.set(k, []);
      this.edges.get(k).push(piece);
    }
    return piece;
  }

  _buildPieceVisual(piece) {
    const phys = this.game.physics;
    if (piece.mesh) this.scene.remove(piece.mesh);
    for (const b of piece.boxes || []) phys.remove(b);
    const shape = shapeBoxes(piece);
    const mat = piece.type === 'door' ? this.doorMat : this.tierMats[piece.tier];
    piece.mesh = meshFromBoxes(shape, mat);
    this.scene.add(piece.mesh);
    piece.boxes = shape.map((b) => makeBox(b[0], b[1], b[2], b[3], b[4], b[5], 'build', piece));
    let cx = 0, cy = 0, cz = 0;
    for (const b of shape) { cx += (b[0] + b[3]) / 2; cy += (b[1] + b[4]) / 2; cz += (b[2] + b[5]) / 2; }
    piece.center = { x: cx / shape.length, y: cy / shape.length, z: cz / shape.length };
    if (piece.type === 'door' && piece.open) this._applyDoorOpen(piece);
    else for (const b of piece.boxes) phys.add(b);
  }

  _applyDoorOpen(piece) {
    // Swing the door 90 degrees around its hinge; an open door can be walked through.
    const phys = this.game.physics;
    const m = piece.mesh.children[0];
    for (const b of piece.boxes) phys.remove(b);
    // Open doors keep a non-solid box so they can still be targeted to close them.
    for (const b of piece.boxes) { b.solid = !piece.open; phys.add(b); }
    if (piece.open) {
      const hingeA = 0.9;
      if (piece.axis === 'x') {
        const hx = piece.i * GRID + hingeA, hz = piece.j * GRID;
        m.rotation.y = -Math.PI / 2;
        m.position.set(hx, m.position.y, hz + 0.6);
      } else {
        const hx = piece.i * GRID, hz = piece.j * GRID + hingeA;
        m.rotation.y = -Math.PI / 2;
        m.position.set(hx + 0.6, m.position.y, hz);
      }
    } else {
      m.rotation.y = 0;
      const b = piece.boxes[0];
      m.position.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
    }
  }

  toggleDoor(piece) {
    piece.open = !piece.open;
    this._applyDoorOpen(piece);
    this.game.audio.play('door');
  }

  placeFromPlan(plan) {
    if (!plan || !plan.valid) return false;
    const inv = this.game.inventory;
    if (plan.type === 'door') {
      const door = this.addPiece(plan, 0);
      door.parent = plan.parent;
      plan.parent.door = door;
      inv.remove('door_wood', 1);
      this.game.audio.play('build');
      return true;
    }
    if (plan.deploy) {
      const d = new Deployable(this, plan.type, plan.x, plan.y, plan.z, plan.rot);
      this.deployables.push(d);
      if (plan.type === 'bag') this.spawnBag = d;
      inv.remove(d.def.item, 1);
      this.game.audio.play('build');
      return true;
    }
    const cost = scaledCost(TIERS[0].cost, PIECES[plan.type].mult);
    if (!inv.pay(cost)) {
      this.game.ui.message(`Need ${costText(cost)}`, 'warn');
      return false;
    }
    this.addPiece(plan, 0);
    this.game.audio.play('build');
    this.game.makeNoise(plan.boxes[0][0], plan.boxes[0][2], 18);
    return true;
  }

  upgrade(piece) {
    if (piece.type === 'door') return this.game.ui.message('Doors cannot be upgraded.', 'warn');
    if (piece.tier >= TIERS.length - 1) return this.game.ui.message('Already at max tier.');
    const next = piece.tier + 1;
    const cost = scaledCost(TIERS[next].cost, PIECES[piece.type].mult);
    if (!this.game.inventory.pay(cost)) return this.game.ui.message(`Upgrade to ${TIERS[next].name} needs ${costText(cost)}`, 'warn');
    piece.tier = next;
    piece.maxHp = TIERS[next].hp;
    piece.hp = piece.maxHp;
    this._buildPieceVisual(piece);
    this.game.audio.play('build');
    this.game.makeNoise(piece.center.x, piece.center.z, 18);
    this.game.ui.message(`Upgraded to ${TIERS[next].name}`);
  }

  repair(piece) {
    if (piece.hp >= piece.maxHp) return this.game.ui.message('Not damaged.');
    const base = piece.type === 'door' ? { wood: 150 } : scaledCost(TIERS[piece.tier].cost, PIECES[piece.type].mult);
    const frac = Math.min(0.25, (piece.maxHp - piece.hp) / piece.maxHp);
    const cost = scaledCost(base, frac * 0.6);
    if (!this.game.inventory.pay(cost)) return this.game.ui.message(`Repair needs ${costText(cost)}`, 'warn');
    piece.hp = Math.min(piece.maxHp, piece.hp + piece.maxHp * 0.25);
    this.game.audio.play('build');
  }

  demolish(piece) {
    const refund = piece.type === 'door' ? { wood: 75 } : scaledCost(TIERS[piece.tier].cost, PIECES[piece.type].mult * 0.3);
    for (const k in refund) this.game.inventory.add(k, refund[k]);
    this.destroyPiece(piece, true);
  }

  damagePiece(piece, amount) {
    if (piece.destroyed) return;
    piece.hp -= amount;
    if (piece.hp <= 0) {
      this.game.ui.message(`Your ${piece.type === 'door' ? 'door' : PIECES[piece.type].name.toLowerCase()} was destroyed!`, 'warn');
      this.destroyPiece(piece);
    }
  }

  destroyPiece(piece, quiet = false) {
    if (piece.destroyed) return;
    piece.destroyed = true;
    this.scene.remove(piece.mesh);
    for (const b of piece.boxes) this.game.physics.remove(b);
    this.pieces.splice(this.pieces.indexOf(piece), 1);
    const map = isCellType(piece.type) ? this.cells : isWallType(piece.type) ? this.edges : null;
    if (map) {
      const k = isCellType(piece.type) ? cellKey(piece.i, piece.j) : edgeKey(piece.i, piece.j, piece.axis);
      const list = map.get(k);
      if (list) list.splice(list.indexOf(piece), 1);
    }
    if (piece.door) this.destroyPiece(piece.door, true);
    if (piece.parent) piece.parent.door = null;
    if (!quiet) this.game.audio.play('break', 0);
    // Anything that lost its support collapses (Rust-style stability).
    let changed = true;
    while (changed) {
      changed = false;
      for (const p of [...this.pieces]) {
        if (!this._supported(p)) { this.destroyPiece(p, true); changed = true; }
      }
    }
    // Drop deployables that were resting on it.
    for (const d of this.deployables) {
      const g = this.game.physics.groundAt(d.x, d.z, 0.3, d.y + 0.01);
      if (g < d.y - 0.1) {
        this.game.physics.remove(d.box);
        const dy = g - d.y;
        d.y = g; d.mesh.position.y = g;
        d.box.minY += dy; d.box.maxY += dy;
        this.game.physics.add(d.box);
      }
    }
  }

  _supported(p) {
    if (p.type === 'foundation') return true;
    if (p.type === 'door') return p.parent && !p.parent.destroyed;
    if (isWallType(p.type)) return !!this._supportsAt(this._edgeCells(p.i, p.j, p.axis), p.y - 0.05, p.y + 0.05);
    if (p.type === 'stairs') return !!this._supportsAt([[p.i, p.j]], p.y - 0.05, p.y + 0.05);
    if (p.type === 'floor') {
      return this._cellEdges(p.i, p.j).some(([i, j, a]) => this.edgePieces(i, j, a).some((w) => Math.abs(w.y + WALL_H - p.y) < 0.05));
    }
    return true;
  }

  removeDeployable(d) {
    d.dispose();
    this.deployables.splice(this.deployables.indexOf(d), 1);
    if (this.spawnBag === d) this.spawnBag = null;
  }

  update(dt) {
    const p = this.game.player.pos;
    const lit = [];
    for (const d of this.deployables) {
      d.update(dt);
      if (d.on) lit.push(d);
    }
    lit.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    this.lightPool.forEach((l, k) => {
      const d = lit[k];
      if (d) {
        l.position.set(d.x, d.y + 0.9, d.z);
        l.intensity = (d.type === 'campfire' ? 9 : 5) * (0.85 + Math.random() * 0.15);
      } else l.intensity = 0;
    });
  }

  clear() {
    for (const p of [...this.pieces]) { this.scene.remove(p.mesh); for (const b of p.boxes) this.game.physics.remove(b); }
    this.pieces = [];
    this.cells.clear();
    this.edges.clear();
    for (const d of this.deployables) d.dispose();
    this.deployables = [];
    this.spawnBag = null;
  }

  serialize() {
    const doors = [];
    const pieces = this.pieces.filter((p) => p.type !== 'door').map((p) => {
      if (p.door) doors.push({ i: p.i, j: p.j, axis: p.axis, y: p.y, hp: p.door.hp, open: p.door.open });
      return { type: p.type, tier: p.tier, hp: p.hp, i: p.i, j: p.j, axis: p.axis, y: p.y, bottom: p.bottom, dir: p.dir };
    });
    return {
      pieces, doors,
      deployables: this.deployables.map((d) => d.serialize()),
      spawnBag: this.spawnBag ? this.deployables.indexOf(this.spawnBag) : -1,
    };
  }

  load(data) {
    this.clear();
    if (!data) return;
    for (const p of data.pieces || []) {
      if (!PIECES[p.type]) continue;
      this.addPiece(p, p.tier, p.hp);
    }
    for (const d of data.doors || []) {
      const dw = this.edgePieces(d.i, d.j, d.axis).find((p) => p.type === 'doorway' && Math.abs(p.y - d.y) < 0.05);
      if (!dw) continue;
      const door = this.addPiece({ type: 'door', i: d.i, j: d.j, axis: d.axis, y: d.y }, 0, d.hp);
      door.parent = dw;
      dw.door = door;
      if (d.open) { door.open = true; this._applyDoorOpen(door); }
    }
    for (const d of data.deployables || []) {
      if (!DEPLOY[d.type]) continue;
      const dep = new Deployable(this, d.type, d.x, d.y, d.z, d.rot);
      if (dep.container && d.slots) dep.container.load(d.slots);
      dep.on = !!d.on;
      this.deployables.push(dep);
    }
    if (data.spawnBag >= 0) this.spawnBag = this.deployables[data.spawnBag] || null;
  }
}

export { DEPLOY };
