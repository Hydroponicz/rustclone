import * as THREE from 'three';
import { damp, lerp } from './util.js';
import { ITEMS } from './items.js';

const M = {
  steel: new THREE.MeshStandardMaterial({ color: 0x2b2d30, metalness: 0.7, roughness: 0.45 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x18191a, metalness: 0.3, roughness: 0.7 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x6b4428, roughness: 0.8 }),
  polymer: new THREE.MeshStandardMaterial({ color: 0x2a2c26, roughness: 0.9 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xc69a7a, roughness: 0.8 }),
  sleeve: new THREE.MeshStandardMaterial({ color: 0x3d4434, roughness: 0.95 }),
  rock: new THREE.MeshStandardMaterial({ color: 0x8a8780, roughness: 1, flatShading: true }),
  blade: new THREE.MeshStandardMaterial({ color: 0xa9adb0, metalness: 0.9, roughness: 0.3 }),
  paper: new THREE.MeshStandardMaterial({ color: 0x3a6fb0, roughness: 1 }),
  misc: new THREE.MeshStandardMaterial({ color: 0x9a8a6a, roughness: 0.9 }),
  flash: new THREE.MeshBasicMaterial({ color: 0xffd38a, transparent: true, opacity: 0.9, depthWrite: false }),
};

function box(g, sx, sy, sz, x, y, z, mat, rx = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.position.set(x, y, z);
  m.rotation.x = rx;
  g.add(m);
  return m;
}

function cyl(g, r, len, x, y, z, mat) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  g.add(m);
  return m;
}

function arms(g, rightAt, leftAt) {
  const r = box(g, 0.07, 0.07, 0.34, rightAt[0] + 0.03, rightAt[1] - 0.05, rightAt[2] + 0.2, M.sleeve, 0.35);
  box(g, 0.065, 0.075, 0.09, rightAt[0], rightAt[1], rightAt[2], M.skin);
  if (leftAt) {
    box(g, 0.07, 0.07, 0.36, leftAt[0] - 0.06, leftAt[1] - 0.07, leftAt[2] + 0.2, M.sleeve, 0.3);
    box(g, 0.075, 0.06, 0.1, leftAt[0], leftAt[1] - 0.02, leftAt[2], M.skin);
  }
  return r;
}

// Each builder returns { group, sightY, muzzleZ, mag }
const BUILDERS = {
  pistol() {
    const g = new THREE.Group();
    box(g, 0.035, 0.035, 0.19, 0, 0, -0.06, M.steel); // slide
    box(g, 0.03, 0.03, 0.16, 0, -0.03, -0.05, M.dark); // frame
    const grip = box(g, 0.032, 0.11, 0.045, 0, -0.085, 0.02, M.polymer, -0.25);
    box(g, 0.006, 0.012, 0.006, 0, 0.022, -0.14, M.dark); // front sight
    box(g, 0.02, 0.012, 0.006, 0, 0.022, 0.025, M.dark); // rear sight
    const mag = box(g, 0.026, 0.09, 0.035, 0, -0.12, 0.025, M.dark, -0.25);
    arms(g, [0, -0.1, 0.04], [-0.01, -0.12, -0.0]);
    void grip;
    return { group: g, sightY: 0.024, muzzleZ: -0.16, mag };
  },
  rifle() {
    const g = new THREE.Group();
    box(g, 0.05, 0.06, 0.32, 0, 0, -0.05, M.steel); // receiver
    box(g, 0.045, 0.05, 0.2, 0, -0.005, -0.3, M.wood); // handguard
    cyl(g, 0.011, 0.2, 0, 0.005, -0.48, M.dark); // barrel
    box(g, 0.012, 0.035, 0.012, 0, 0.035, -0.52, M.dark); // front sight
    box(g, 0.02, 0.018, 0.03, 0, 0.038, -0.12, M.dark); // rear sight
    box(g, 0.045, 0.07, 0.22, 0, -0.05, 0.2, M.wood, 0.22); // stock (angled down to the shoulder)
    box(g, 0.03, 0.09, 0.04, 0, -0.07, 0.06, M.wood, -0.3); // grip
    const mag = box(g, 0.035, 0.16, 0.06, 0, -0.1, -0.13, M.steel, 0.3);
    arms(g, [0, -0.1, 0.08], [-0.02, -0.06, -0.3]);
    return { group: g, sightY: 0.052, muzzleZ: -0.58, mag };
  },
  shotgun() {
    const g = new THREE.Group();
    box(g, 0.05, 0.06, 0.24, 0, 0, 0, M.steel);
    cyl(g, 0.014, 0.5, 0, 0.012, -0.36, M.dark);
    cyl(g, 0.014, 0.4, 0, -0.02, -0.3, M.dark); // tube
    const pump = box(g, 0.05, 0.05, 0.14, 0, -0.025, -0.3, M.wood);
    box(g, 0.008, 0.012, 0.008, 0, 0.032, -0.6, M.blade); // bead
    box(g, 0.045, 0.075, 0.26, 0, -0.05, 0.24, M.wood, 0.2);
    arms(g, [0, -0.09, 0.12], [-0.02, -0.07, -0.3]);
    return { group: g, sightY: 0.034, muzzleZ: -0.62, mag: pump, pump };
  },
  bolt() {
    const g = new THREE.Group();
    box(g, 0.045, 0.05, 0.3, 0, 0, -0.02, M.steel);
    cyl(g, 0.012, 0.5, 0, 0.005, -0.42, M.dark);
    box(g, 0.05, 0.06, 0.62, 0, -0.03, -0.05, M.wood); // full stock
    cyl(g, 0.022, 0.26, 0, 0.065, -0.04, M.dark); // scope tube
    cyl(g, 0.03, 0.04, 0, 0.065, -0.17, M.dark);
    cyl(g, 0.028, 0.04, 0, 0.065, 0.08, M.dark);
    box(g, 0.012, 0.012, 0.05, 0.035, 0.02, 0.05, M.blade); // bolt handle
    const mag = box(g, 0.03, 0.04, 0.06, 0, -0.07, -0.05, M.steel);
    arms(g, [0, -0.09, 0.12], [-0.02, -0.07, -0.28]);
    return { group: g, sightY: 0.065, muzzleZ: -0.68, mag, scope: true };
  },
  rock() {
    const g = new THREE.Group();
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.08, 0), M.rock);
    r.position.set(0, 0.02, -0.05);
    g.add(r);
    arms(g, [0, -0.04, 0.02]);
    return { group: g, melee: true };
  },
  hatchet() {
    const g = new THREE.Group();
    box(g, 0.025, 0.025, 0.4, 0, 0, -0.1, M.wood, -1.2);
    box(g, 0.015, 0.09, 0.11, 0, 0.17, -0.18, M.rock, -1.2);
    arms(g, [0, -0.06, 0.04]);
    return { group: g, melee: true };
  },
  pickaxe() {
    const g = new THREE.Group();
    box(g, 0.025, 0.025, 0.45, 0, 0, -0.1, M.wood, -1.2);
    box(g, 0.025, 0.03, 0.3, 0, 0.19, -0.2, M.rock, 0.35);
    arms(g, [0, -0.06, 0.04]);
    return { group: g, melee: true };
  },
  machete() {
    const g = new THREE.Group();
    box(g, 0.03, 0.03, 0.1, 0, 0, 0, M.dark, -1.2);
    box(g, 0.006, 0.05, 0.42, 0, 0.17, -0.12, M.blade, -1.2);
    arms(g, [0, -0.04, 0.03]);
    return { group: g, melee: true };
  },
  spear() {
    const g = new THREE.Group();
    box(g, 0.025, 0.025, 1.4, 0, 0, -0.35, M.wood);
    box(g, 0.02, 0.02, 0.12, 0, 0, -1.08, M.misc);
    arms(g, [0, -0.04, 0.1], [-0.03, -0.04, -0.3]);
    return { group: g, melee: true, thrust: true };
  },
  hammer() {
    const g = new THREE.Group();
    box(g, 0.025, 0.025, 0.32, 0, 0, -0.08, M.wood, -1.2);
    box(g, 0.04, 0.05, 0.12, 0, 0.13, -0.14, M.steel, -1.2 + Math.PI / 2);
    arms(g, [0, -0.05, 0.03]);
    return { group: g, melee: true };
  },
  building_plan() {
    const g = new THREE.Group();
    box(g, 0.18, 0.005, 0.24, 0, 0, -0.05, M.paper, -0.6);
    arms(g, [0.06, -0.05, 0.05], [-0.06, -0.05, 0.05]);
    return { group: g };
  },
  generic() {
    const g = new THREE.Group();
    box(g, 0.09, 0.09, 0.09, 0, 0, -0.04, M.misc);
    arms(g, [0, -0.06, 0.03]);
    return { group: g };
  },
  hands() {
    const g = new THREE.Group();
    arms(g, [0.02, -0.1, 0.0]);
    return { group: g, melee: true };
  },
};

export class ViewModel {
  constructor(scene) {
    this.root = new THREE.Group();
    scene.add(this.root);
    this.cache = {};
    this.current = null;
    this.currentId = null;
    this.swayX = 0; this.swayY = 0;
    this.kick = 0;
    this.drawT = 1;
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), M.flash);
    this.flash.visible = false;
    this.flashLight = new THREE.PointLight(0xffc070, 0, 4);
    this.root.add(this.flashLight);
    this.flashT = 0;
    this.pos = new THREE.Vector3(0.2, -0.2, -0.45);
  }

  setItem(id) {
    if (id === this.currentId) return;
    this.currentId = id;
    if (this.current) this.root.remove(this.current.group);
    let key = 'hands';
    if (id) {
      const def = ITEMS[id];
      if (def.gun) key = def.gun.model;
      else if (BUILDERS[id]) key = id;
      else key = 'generic';
    }
    if (!this.cache[key]) {
      this.cache[key] = BUILDERS[key]();
      this.cache[key].group.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    }
    this.current = this.cache[key];
    this.root.add(this.current.group);
    this.current.group.add(this.flash);
    this.flash.position.set(0, 0.005, (this.current.muzzleZ || -0.3) - 0.05);
    this.drawT = 0;
  }

  muzzleFlash() {
    this.flashT = 0.05;
    this.flash.visible = true;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flashLight.intensity = 6;
  }

  addKick(amount) {
    this.kick += amount;
  }

  // s: { ads, sprint, bob, moving, swing (0..1 or -1), reload (0..1 or -1), mouseDX, mouseDY, pump }
  update(dt, s) {
    const c = this.current;
    if (!c) return;
    this.drawT = Math.min(1, this.drawT + dt * 3);
    const hip = c.melee ? new THREE.Vector3(0.24, -0.24, -0.46) : new THREE.Vector3(0.15, -0.16, -0.52);
    const adsPos = new THREE.Vector3(0, -(c.sightY || 0), c.scope ? -0.22 : -0.4);
    const target = hip.clone().lerp(adsPos, s.ads);
    if (s.sprint && !c.melee) target.add(new THREE.Vector3(-0.05, -0.06, 0.04));

    // Sway lags behind mouse movement; less when aiming.
    const swayAmt = lerp(1, 0.25, s.ads);
    this.swayX = damp(this.swayX, -s.mouseDX * 0.0004 * swayAmt, 10, dt);
    this.swayY = damp(this.swayY, s.mouseDY * 0.0004 * swayAmt, 10, dt);
    this.kick = damp(this.kick, 0, 14, dt);

    this.pos.lerp(target, 1 - Math.exp(-14 * dt));
    const g = c.group;
    const bobX = Math.cos(s.bobPhase) * 0.012 * s.moving * (1 - s.ads * 0.8);
    const bobY = Math.abs(Math.sin(s.bobPhase)) * 0.012 * s.moving * (1 - s.ads * 0.8);
    g.position.set(this.pos.x + this.swayX + bobX, this.pos.y + this.swayY + bobY - (1 - this.drawT) * 0.25, this.pos.z + this.kick * 0.06);
    g.rotation.set(this.kick * 0.25 + this.swayY * 2, this.swayX * 2, 0);
    if (s.sprint && !c.melee) { g.rotation.y += 0.5; g.rotation.x -= 0.25; }
    if (s.breathe) {
      g.position.x += Math.sin(s.time * 1.3) * 0.0015 * s.ads;
      g.position.y += Math.sin(s.time * 0.9) * 0.002 * s.ads;
    }

    if (s.swing >= 0) {
      const p = s.swing;
      if (c.thrust) {
        const f = p < 0.3 ? -p / 0.3 * 0.15 : p < 0.55 ? -0.15 + (p - 0.3) / 0.25 * 0.6 : 0.45 * (1 - (p - 0.55) / 0.45);
        g.position.z -= f;
      } else {
        const a = p < 0.35 ? (p / 0.35) * 0.9 : p < 0.6 ? 0.9 - ((p - 0.35) / 0.25) * 2.2 : -1.3 * (1 - (p - 0.6) / 0.4);
        g.rotation.x += a;
        g.rotation.z += a * 0.25;
        g.position.y += a * 0.05;
      }
    }
    if (s.reload >= 0) {
      const dip = Math.sin(Math.min(1, s.reload) * Math.PI);
      g.rotation.x -= dip * 0.5;
      g.rotation.z += dip * 0.6;
      g.position.y -= dip * 0.08;
      if (c.mag && !c.pump) c.mag.visible = s.reload < 0.35 || s.reload > 0.6;
    } else if (c.mag) c.mag.visible = true;
    if (c.pump) c.pump.position.z = -0.3 + (s.pump || 0) * 0.08;
    if (s.using >= 0) {
      g.position.y -= 0.05 + Math.sin(s.using * 20) * 0.01;
      g.rotation.x += 0.4;
    }

    this.flashT -= dt;
    if (this.flashT <= 0) {
      this.flash.visible = false;
      this.flashLight.intensity = 0;
    }
    this.flashLight.position.copy(g.position).add(new THREE.Vector3(0, 0, (c.muzzleZ || -0.3)));
  }
}
