import { ITEMS, LOOT } from './items.js';
import { randInt, weighted } from './util.js';

export function makeItem(id, qty = 1) {
  const item = { id, qty };
  const def = ITEMS[id];
  if (def && def.gun) item.mag = 0;
  return item;
}

export class Container {
  constructor(size, name = 'Container') {
    this.slots = new Array(size).fill(null);
    this.name = name;
    this.onChange = null;
  }

  changed() {
    if (this.onChange) this.onChange();
  }

  // Adds qty of id; returns leftover that did not fit.
  add(id, qty = 1, extra = null) {
    const def = ITEMS[id];
    if (!def) return qty;
    const stack = def.stack;
    if (stack > 1) {
      for (const s of this.slots) {
        if (!s || s.id !== id || s.qty >= stack) continue;
        const n = Math.min(stack - s.qty, qty);
        s.qty += n;
        qty -= n;
        if (qty <= 0) break;
      }
    }
    for (let i = 0; i < this.slots.length && qty > 0; i++) {
      if (this.slots[i]) continue;
      const n = Math.min(stack, qty);
      const item = makeItem(id, n);
      if (extra) Object.assign(item, extra);
      this.slots[i] = item;
      qty -= n;
    }
    this.changed();
    return qty;
  }

  addItem(item) {
    const left = this.add(item.id, item.qty, item.mag !== undefined ? { mag: item.mag } : null);
    return left;
  }

  count(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.qty;
    return n;
  }

  has(cost) {
    for (const k in cost) if (this.count(k) < cost[k]) return false;
    return true;
  }

  remove(id, qty) {
    // Take from the back (main inventory) before the hotbar.
    for (let i = this.slots.length - 1; i >= 0 && qty > 0; i--) {
      const s = this.slots[i];
      if (!s || s.id !== id) continue;
      const n = Math.min(s.qty, qty);
      s.qty -= n;
      qty -= n;
      if (s.qty <= 0) this.slots[i] = null;
    }
    this.changed();
    return qty === 0;
  }

  pay(cost) {
    if (!this.has(cost)) return false;
    for (const k in cost) this.remove(k, cost[k]);
    return true;
  }

  isEmpty() {
    return this.slots.every((s) => !s);
  }

  clear() {
    this.slots.fill(null);
    this.changed();
  }

  serialize() {
    return this.slots.map((s) => (s ? { ...s } : null));
  }

  load(arr) {
    this.slots.fill(null);
    if (Array.isArray(arr)) arr.forEach((s, i) => { if (i < this.slots.length && s && ITEMS[s.id]) this.slots[i] = { ...s }; });
    this.changed();
  }
}

export function rollLoot(container, table, rng = Math.random) {
  const t = LOOT[table];
  if (!t) return;
  const rolls = randInt(rng, t.rolls[0], t.rolls[1]);
  for (let i = 0; i < rolls; i++) {
    const e = weighted(rng, t.entries);
    const qty = randInt(rng, e.min, e.max);
    const def = ITEMS[e.id];
    if (def.gun) container.add(e.id, 1, { mag: Math.floor(rng() * def.gun.mag * 0.6) });
    else container.add(e.id, qty);
  }
}
