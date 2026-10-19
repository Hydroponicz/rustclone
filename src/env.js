import * as THREE from 'three';
import { clamp, smoothstep } from './util.js';

// One in-game day lasts DAY_LENGTH real seconds.
export const DAY_LENGTH = 960;

const SKY_DAY = new THREE.Color(0x9db7c9);
const SKY_DUSK = new THREE.Color(0xc98a5e);
const SKY_NIGHT = new THREE.Color(0x0a0f17);

export class Environment {
  constructor(scene) {
    this.scene = scene;
    this.hours = 8;
    this.day = 1;
    scene.background = new THREE.Color();
    scene.fog = new THREE.Fog(0x9db7c9, 40, 260);

    this.hemi = new THREE.HemisphereLight(0xbfd4e6, 0x4a4030, 0.7);
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0x404a5a, 0.25);
    scene.add(this.ambient);

    const sun = new THREE.DirectionalLight(0xfff1dd, 1.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 1; sc.far = 300;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.04;
    scene.add(sun);
    scene.add(sun.target);
    this.sun = sun;

    // Sun / moon discs
    this.sunDisc = new THREE.Mesh(new THREE.SphereGeometry(6, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff3cf, fog: false }));
    this.moonDisc = new THREE.Mesh(new THREE.SphereGeometry(4, 12, 8), new THREE.MeshBasicMaterial({ color: 0xc8d4e8, fog: false }));
    scene.add(this.sunDisc, this.moonDisc);

    // Stars
    const starGeo = new THREE.BufferGeometry();
    const pts = [];
    for (let i = 0; i < 1200; i++) {
      const v = new THREE.Vector3().randomDirection();
      if (v.y < 0.05) v.y = Math.abs(v.y) + 0.05;
      v.normalize().multiplyScalar(450);
      pts.push(v.x, v.y, v.z);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, fog: false }));
    scene.add(this.stars);
  }

  get isNight() {
    return this.hours >= 21 || this.hours < 5;
  }

  // 0 at noon .. 1 at deep night
  get darkness() {
    return this._dark || 0;
  }

  update(dt, center) {
    this.hours += (dt / DAY_LENGTH) * 24;
    if (this.hours >= 24) {
      this.hours -= 24;
      this.day++;
    }
    // Long days: the sun is up from 05:00 to 21:00, night covers the remaining 8 hours.
    const h = this.hours;
    const ang = h >= 5 && h < 21 ? ((h - 5) / 16) * Math.PI : Math.PI + (((h - 21 + 24) % 24) / 8) * Math.PI;
    const sunDir = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0.35).normalize();
    const elev = sunDir.y;
    const dayAmt = smoothstep(-0.12, 0.25, elev);
    const duskAmt = clamp(1 - Math.abs(elev) / 0.3, 0, 1) * smoothstep(-0.25, 0.0, elev);
    this._dark = 1 - dayAmt;

    const sky = this.scene.background;
    sky.copy(SKY_NIGHT).lerp(SKY_DAY, dayAmt).lerp(SKY_DUSK, duskAmt * 0.55);
    this.scene.fog.color.copy(sky);
    this.scene.fog.near = 30 + dayAmt * 30;
    this.scene.fog.far = 110 + dayAmt * 170;

    const lightDir = elev > -0.05 ? sunDir : sunDir.clone().negate(); // moon opposite
    this.sun.position.copy(center).addScaledVector(lightDir, 150);
    this.sun.target.position.copy(center);
    this.sun.intensity = elev > -0.05 ? 0.25 + dayAmt * 1.5 : 0.18;
    this.sun.color.setHex(elev > -0.05 ? 0xfff1dd : 0x8fa6d6);
    this.sun.color.lerp(new THREE.Color(0xff9a5a), duskAmt * 0.6);
    this.hemi.intensity = 0.12 + dayAmt * 0.6;
    this.ambient.intensity = 0.1 + dayAmt * 0.18;

    this.sunDisc.position.copy(center).addScaledVector(sunDir, 420);
    this.moonDisc.position.copy(center).addScaledVector(sunDir, -420);
    this.sunDisc.visible = elev > -0.1;
    this.moonDisc.visible = elev < 0.1;
    this.stars.position.copy(center);
    this.stars.material.opacity = 1 - dayAmt;
    this.stars.visible = dayAmt < 0.95;
  }
}
