// Axis-aligned box colliders in a spatial hash, plus terrain-aware ray casts
// and circle (capsule-ish) movement resolution for players and zombies.

export const STEP_HEIGHT = 0.55;

export function makeBox(minX, minY, minZ, maxX, maxY, maxZ, kind, owner, solid = true) {
  return { minX, minY, minZ, maxX, maxY, maxZ, kind, owner, solid, _cells: null, _stamp: 0 };
}

export class Physics {
  constructor(terrain, cellSize = 8) {
    this.terrain = terrain;
    this.cell = cellSize;
    this.grid = new Map();
    this.stamp = 1;
    this._out = [];
  }

  _key(ix, iz) {
    return ix * 73856093 ^ iz * 19349663;
  }

  add(box) {
    const c = this.cell;
    const x0 = Math.floor(box.minX / c), x1 = Math.floor(box.maxX / c);
    const z0 = Math.floor(box.minZ / c), z1 = Math.floor(box.maxZ / c);
    box._cells = [];
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = this._key(ix, iz);
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(box);
        box._cells.push(list);
      }
    }
    return box;
  }

  remove(box) {
    if (!box || !box._cells) return;
    for (const list of box._cells) {
      const i = list.indexOf(box);
      if (i >= 0) list.splice(i, 1);
    }
    box._cells = null;
  }

  // Returns a shared array of unique boxes overlapping the XZ rectangle.
  query(minX, minZ, maxX, maxZ) {
    const out = this._out;
    out.length = 0;
    const s = ++this.stamp;
    const c = this.cell;
    const x0 = Math.floor(minX / c), x1 = Math.floor(maxX / c);
    const z0 = Math.floor(minZ / c), z1 = Math.floor(maxZ / c);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const list = this.grid.get(this._key(ix, iz));
        if (!list) continue;
        for (const b of list) {
          if (b._stamp === s) continue;
          b._stamp = s;
          if (b.maxX < minX || b.minX > maxX || b.maxZ < minZ || b.minZ > maxZ) continue;
          out.push(b);
        }
      }
    }
    return out;
  }

  // Ray vs boxes and terrain. dir must be normalized.
  // opts: { terrain: bool, solidOnly: bool, filter: fn(box) }
  raycast(ox, oy, oz, dx, dy, dz, maxDist, opts = {}) {
    const useTerrain = opts.terrain !== false;
    const solidOnly = opts.solidOnly !== false;
    let best = { dist: maxDist, box: null, nx: 0, ny: 0, nz: 0, terrain: false };
    let hit = false;
    const ex = ox + dx * maxDist, ez = oz + dz * maxDist;
    const boxes = this.query(Math.min(ox, ex), Math.min(oz, ez), Math.max(ox, ex), Math.max(oz, ez));
    const ix = 1 / (dx || 1e-9), iy = 1 / (dy || 1e-9), iz = 1 / (dz || 1e-9);
    for (const b of boxes) {
      if (solidOnly && !b.solid) continue;
      if (opts.filter && !opts.filter(b)) continue;
      let t1 = (b.minX - ox) * ix, t2 = (b.maxX - ox) * ix;
      let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
      let nAxis = 0, nSign = t1 < t2 ? -1 : 1;
      t1 = (b.minY - oy) * iy; t2 = (b.maxY - oy) * iy;
      let ty = Math.min(t1, t2);
      if (ty > tmin) { tmin = ty; nAxis = 1; nSign = t1 < t2 ? -1 : 1; }
      tmax = Math.min(tmax, Math.max(t1, t2));
      t1 = (b.minZ - oz) * iz; t2 = (b.maxZ - oz) * iz;
      let tz = Math.min(t1, t2);
      if (tz > tmin) { tmin = tz; nAxis = 2; nSign = t1 < t2 ? -1 : 1; }
      tmax = Math.min(tmax, Math.max(t1, t2));
      if (tmax < 0 || tmin > tmax) continue;
      const t = tmin < 0 ? 0 : tmin;
      if (t < best.dist) {
        best.dist = t;
        best.box = b;
        best.nx = nAxis === 0 ? nSign : 0;
        best.ny = nAxis === 1 ? nSign : 0;
        best.nz = nAxis === 2 ? nSign : 0;
        hit = true;
      }
    }
    if (useTerrain) {
      const t = this.terrainRay(ox, oy, oz, dx, dy, dz, best.dist);
      if (t !== null) {
        best.dist = t;
        best.box = null;
        best.terrain = true;
        best.nx = 0; best.ny = 1; best.nz = 0;
        hit = true;
      }
    }
    if (!hit) return null;
    best.x = ox + dx * best.dist;
    best.y = oy + dy * best.dist;
    best.z = oz + dz * best.dist;
    return best;
  }

  terrainRay(ox, oy, oz, dx, dy, dz, maxDist) {
    const h = this.terrain;
    const step = 0.75;
    let prevT = 0;
    if (oy < h.heightAt(ox, oz)) return 0;
    for (let t = step; t <= maxDist + step; t += step) {
      const tt = Math.min(t, maxDist);
      const x = ox + dx * tt, y = oy + dy * tt, z = oz + dz * tt;
      if (y < h.heightAt(x, z)) {
        let a = prevT, b = tt;
        for (let i = 0; i < 8; i++) {
          const m = (a + b) * 0.5;
          if (oy + dy * m < h.heightAt(ox + dx * m, oz + dz * m)) b = m;
          else a = m;
        }
        return b;
      }
      prevT = tt;
      if (tt >= maxDist) break;
    }
    return null;
  }

  // Move a vertical cylinder (radius r, from feetY to feetY+height) out of solid boxes.
  // Mutates pos {x, z}. Returns array of boxes it was pushed by (shared array).
  resolveCircle(pos, r, feetY, height, contacts) {
    if (contacts) contacts.length = 0;
    const boxes = this.query(pos.x - r - 0.1, pos.z - r - 0.1, pos.x + r + 0.1, pos.z + r + 0.1);
    for (let pass = 0; pass < 2; pass++) {
      for (const b of boxes) {
        if (!b.solid) continue;
        if (b.maxY <= feetY + STEP_HEIGHT || b.minY >= feetY + height) continue;
        const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
        const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
        let dx = pos.x - cx, dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const push = r - d;
          pos.x += (dx / d) * push;
          pos.z += (dz / d) * push;
        } else {
          // Center inside box: push out along the shallowest axis.
          const l = pos.x - b.minX, rr = b.maxX - pos.x, n = pos.z - b.minZ, f = b.maxZ - pos.z;
          const m = Math.min(l, rr, n, f);
          if (m === l) pos.x = b.minX - r;
          else if (m === rr) pos.x = b.maxX + r;
          else if (m === n) pos.z = b.minZ - r;
          else pos.z = b.maxZ + r;
        }
        if (contacts && !contacts.includes(b)) contacts.push(b);
      }
    }
    return contacts;
  }

  // Highest walkable surface under (x, z) that is not above feetY + step.
  groundAt(x, z, r, feetY) {
    let g = this.terrain.heightAt(x, z);
    const rr = r * 0.7;
    const boxes = this.query(x - rr, z - rr, x + rr, z + rr);
    for (const b of boxes) {
      if (!b.solid) continue;
      if (b.maxY > feetY + STEP_HEIGHT + 0.01) continue;
      if (b.maxY > g) g = b.maxY;
    }
    return g;
  }

  // Lowest box bottom above headY-range, used to stop jumps at ceilings.
  ceilingAt(x, z, r, feetY, headY) {
    let c = Infinity;
    const rr = r * 0.7;
    const boxes = this.query(x - rr, z - rr, x + rr, z + rr);
    for (const b of boxes) {
      if (!b.solid) continue;
      if (b.minY >= feetY + STEP_HEIGHT && b.minY < c && b.minY < headY + 0.5) c = b.minY;
    }
    return c;
  }
}
