import { WORLD_SIZE, HALF } from './world.js';
import { fmtTime } from './util.js';

// Full-screen island map (M / controller View button). The terrain image is rendered once;
// markers are redrawn a few times per second while the map is open.

const GRID = 64; // metres per grid cell -> 10 x 10 grid (A-J, 0-9)
const TIER_COLORS = ['#d8bf8a', '#a8774a', '#a9a9a3', '#7f8c95'];

export class GameMap {
  constructor(game) {
    this.game = game;
    this.open = false;
    this.zoom = 1;
    this.base = null;
    this.showZombies = false; // dev console: `mapzombies`
    this._redrawT = 0;
    this.el = document.getElementById('map');
    this.canvas = document.getElementById('map-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.infoEl = document.getElementById('map-info');
  }

  toggle() {
    if (this.open) this.close();
    else this.show();
  }

  show() {
    if (!this.base) this._renderBase();
    this.open = true;
    this.el.style.display = 'flex';
    this._resize();
    this._redrawT = 0;
    this.draw();
  }

  close() {
    this.open = false;
    this.el.style.display = 'none';
  }

  zoomBy(steps) {
    this.zoom = Math.max(1, Math.min(6, this.zoom * Math.pow(1.35, steps)));
    this.draw();
  }

  update(dt) {
    if (!this.open) return;
    this._redrawT -= dt;
    if (this._redrawT <= 0) {
      this._redrawT = 0.1;
      this.draw();
    }
  }

  _resize() {
    const size = Math.floor(Math.min(window.innerWidth * 0.94, window.innerHeight * 0.86));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.style.width = this.canvas.style.height = `${size}px`;
    this.canvas.width = this.canvas.height = Math.floor(size * dpr);
  }

  // ------------------------------------------------------------------ static terrain image
  _renderBase() {
    const T = this.game.terrain;
    const N = WORLD_SIZE; // 1 px per metre
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d');
    const img = g.createImageData(N, N);
    const d = img.data;
    const lerp = (a, b, t) => a + (b - a) * t;
    const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
    const SHALLOW = [74, 132, 154], DEEP = [26, 58, 80], SAND = [205, 189, 142], GRASS = [104, 136, 70], GRASS2 = [126, 142, 76], ROCK = [138, 133, 122];
    for (let py = 0; py < N; py++) {
      for (let px = 0; px < N; px++) {
        const x = px - HALF + 0.5, z = py - HALF + 0.5;
        const h = T.heightAt(x, z);
        let col;
        if (h < 0) col = mix(SHALLOW, DEEP, Math.min(1, -h / 14));
        else if (h < 2.2) col = mix(SAND, GRASS, Math.max(0, (h - 1.4) / 0.8));
        else {
          col = mix(GRASS, GRASS2, Math.min(1, Math.max(0, (h - 4) / 14)));
          const slope = T.slopeAt(x, z);
          col = mix(col, ROCK, Math.min(1, Math.max(0, (slope - 0.55) / 0.35)) + Math.max(0, Math.min(1, (h - 20) / 6)));
        }
        // Hill shading, light from the north-west
        let shade = 1;
        if (h > -0.5) {
          const dx = T.heightAt(x + 1, z) - T.heightAt(x - 1, z);
          const dz = T.heightAt(x, z + 1) - T.heightAt(x, z - 1);
          shade = Math.max(0.6, Math.min(1.3, 1 - (dx + dz) * 0.18));
        }
        const i = (py * N + px) * 4;
        d[i] = col[0] * shade; d[i + 1] = col[1] * shade; d[i + 2] = col[2] * shade; d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);

    // Forests and rock nodes
    for (const n of this.game.world.nodes) {
      const px = n.x + HALF, py = n.z + HALF;
      if (n.type === 'tree') { g.fillStyle = 'rgba(38, 62, 34, 0.55)'; g.beginPath(); g.arc(px, py, 2.4 * n.scale, 0, Math.PI * 2); g.fill(); }
    }
    // Man-made features recorded by the world generator
    for (const f of this.game.world.mapFeatures) {
      const x0 = f.x - f.w / 2 + HALF, y0 = f.z - f.d / 2 + HALF;
      if (f.type === 'road') { g.fillStyle = '#4a4a48'; g.fillRect(x0, y0, f.w, f.d); }
      else if (f.type === 'pad') { g.fillStyle = '#8c8c86'; g.fillRect(x0, y0, f.w, f.d); }
      else if (f.type === 'sandbag') { g.fillStyle = '#b8a47a'; g.fillRect(x0, y0, f.w, f.d); }
      else if (f.type === 'house') {
        g.fillStyle = '#9a8068'; g.fillRect(x0, y0, f.w, f.d);
        g.strokeStyle = '#3a2e24'; g.lineWidth = 1; g.strokeRect(x0 + 0.5, y0 + 0.5, f.w - 1, f.d - 1);
      }
    }
    this.base = c;
  }

  // ------------------------------------------------------------------ drawing
  _view() {
    const W = this.canvas.width;
    const span = WORLD_SIZE / this.zoom;
    const p = this.game.player.pos;
    const lim = HALF - span / 2;
    const cx = this.zoom > 1 ? Math.max(-lim, Math.min(lim, p.x)) : 0;
    const cz = this.zoom > 1 ? Math.max(-lim, Math.min(lim, p.z)) : 0;
    const s = W / span;
    return { cx, cz, s, W, w2c: (x, z) => [(x - cx) * s + W / 2, (z - cz) * s + W / 2] };
  }

  draw() {
    if (!this.open) return;
    const g = this.ctx, game = this.game;
    const { cx, cz, s, W, w2c } = this._view();
    const dpr = W / parseFloat(this.canvas.style.width);
    g.fillStyle = '#1a3a50';
    g.fillRect(0, 0, W, W);
    g.imageSmoothingEnabled = this.zoom < 3;
    const span = WORLD_SIZE / this.zoom;
    g.drawImage(this.base, cx - span / 2 + HALF, cz - span / 2 + HALF, span, span, 0, 0, W, W);

    // Grid
    g.strokeStyle = 'rgba(0, 0, 0, 0.28)';
    g.lineWidth = 1 * dpr;
    g.font = `${11 * dpr}px ui-monospace, monospace`;
    g.fillStyle = 'rgba(255, 255, 255, 0.75)';
    for (let k = 0; k <= WORLD_SIZE / GRID; k++) {
      const v = -HALF + k * GRID;
      const [x] = w2c(v, 0), [, y] = w2c(0, v);
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, W); g.stroke();
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
      if (k < WORLD_SIZE / GRID) {
        const [lx] = w2c(v + GRID / 2, 0), [, ly] = w2c(0, v + GRID / 2);
        if (lx > 0 && lx < W) g.fillText(String.fromCharCode(65 + k), lx - 4 * dpr, 13 * dpr);
        if (ly > 0 && ly < W) g.fillText(String(k), 4 * dpr, ly + 4 * dpr);
      }
    }

    const label = (text, x, z, size = 13, color = '#fff') => {
      const [px, py] = w2c(x, z);
      g.font = `600 ${size * dpr}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.lineWidth = 3 * dpr;
      g.strokeStyle = 'rgba(0,0,0,0.75)';
      g.strokeText(text, px, py);
      g.fillStyle = color;
      g.fillText(text, px, py);
      g.textAlign = 'start';
    };
    const icon = (glyph, x, z, size = 16) => {
      const [px, py] = w2c(x, z);
      g.font = `${size * dpr}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(glyph, px, py);
      g.textAlign = 'start';
      g.textBaseline = 'alphabetic';
    };
    const t = game.terrain;
    label('Town', t.town.x, t.town.z - t.town.r * 0.55, 15);
    label('Military Checkpoint', t.military.x, t.military.z - t.military.r * 0.75, 13, '#ffd27a');

    // Your base: foundations coloured by tier, with an outline and a label
    const found = game.building.pieces.filter((pc) => pc.type === 'foundation');
    const sz = Math.max(4 * dpr, 3 * s);
    g.lineWidth = 2 * dpr;
    g.strokeStyle = '#4ac8ff';
    for (const pc of found) { const [x0, y0] = w2c(pc.i * 3, pc.j * 3); g.strokeRect(x0, y0, sz, sz); }
    for (const pc of found) { const [x0, y0] = w2c(pc.i * 3, pc.j * 3); g.fillStyle = TIER_COLORS[pc.tier]; g.fillRect(x0, y0, sz, sz); }
    if (found.length) {
      const bx = found.reduce((a, pc) => a + pc.center.x, 0) / found.length, bz = found.reduce((a, pc) => a + pc.center.z, 0) / found.length;
      label('Your base', bx, bz - 6 - 12 / this.zoom, 12, '#8fdcff');
    }
    if (this.zoom >= 2.5) {
      for (const dpl of game.building.deployables) {
        const glyph = { box: '📦', furnace: '🔥', campfire: '🏕️' }[dpl.type];
        if (glyph) icon(glyph, dpl.x, dpl.z, 9 + this.zoom);
      }
    }
    const sb = game.building.spawnBag;
    if (sb) { icon('🛏️', sb.x, sb.z, 18); label('Sleeping bag', sb.x, sb.z + 10, 11, '#bfe0ff'); }
    for (const b of game.bags) {
      if (b.name === 'Your Backpack') { icon('🎒', b.pos.x, b.pos.z, 20); label('Your backpack', b.pos.x, b.pos.z + 11, 11, '#ff9a8a'); }
      else icon('•', b.pos.x, b.pos.z, 18);
    }
    if (this.showZombies) {
      g.fillStyle = '#ff3a2a';
      for (const z of game.zombies.list) {
        if (!z.alive) continue;
        const [px, py] = w2c(z.pos.x, z.pos.z);
        g.fillRect(px - 2 * dpr, py - 2 * dpr, 4 * dpr, 4 * dpr);
      }
    }

    // Player arrow (north = up = -z)
    const p = game.player;
    const [px, py] = w2c(p.pos.x, p.pos.z);
    const ang = Math.atan2(-Math.cos(p.yaw), -Math.sin(p.yaw)); // canvas angle of facing
    g.save();
    g.translate(px, py);
    g.rotate(ang);
    g.beginPath();
    g.moveTo(11 * dpr, 0); g.lineTo(-7 * dpr, 7 * dpr); g.lineTo(-3 * dpr, 0); g.lineTo(-7 * dpr, -7 * dpr); g.closePath();
    g.fillStyle = '#ffffff'; g.fill();
    g.lineWidth = 2 * dpr; g.strokeStyle = '#c0392b'; g.stroke();
    g.restore();

    // North indicator
    g.font = `600 ${12 * dpr}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.fillStyle = '#fff';
    g.fillText('N ▲', W / 2, 16 * dpr);
    g.textAlign = 'start';

    const col = Math.floor((p.pos.x + HALF) / GRID), row = Math.floor((p.pos.z + HALF) / GRID);
    const grid = col >= 0 && col < 10 && row >= 0 && row < 10 ? `${String.fromCharCode(65 + col)}${row}` : 'off-map';
    this.infoEl.innerHTML = `<b>Grid ${grid}</b> · Day ${game.env.day} ${fmtTime(game.env.hours)} · zoom ×${this.zoom.toFixed(1)}` +
      `<span class="map-hint">${game.input.lastDevice === 'pad' ? 'RB / LB zoom in / out · View close' : 'Wheel zoom · M / Esc close'} · you can keep walking</span>` +
      (this.showZombies ? ' <span class="map-dev">[dev: zombies shown]</span>' : '');
  }
}
