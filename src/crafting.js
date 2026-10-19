import { ITEMS } from './items.js';

// Rust-style crafting queue: resources are taken when queued and refunded on cancel.
export class Crafting {
  constructor(game) {
    this.game = game;
    this.queue = [];
  }

  canCraft(recipe, times = 1) {
    const inv = this.game.inventory;
    for (const k in recipe.cost) if (inv.count(k) < recipe.cost[k] * times) return false;
    return true;
  }

  enqueue(recipe, times = 1) {
    let n = 0;
    for (let i = 0; i < times; i++) {
      if (!this.game.inventory.pay(recipe.cost)) break;
      this.queue.push({ recipe, t: 0 });
      n++;
    }
    if (n === 0) this.game.ui.message('Not enough resources', 'warn');
    else this.game.audio.play('ui');
    return n;
  }

  cancel(index) {
    const job = this.queue[index];
    if (!job) return;
    this.queue.splice(index, 1);
    for (const k in job.recipe.cost) this.game.inventory.add(k, job.recipe.cost[k]);
  }

  update(dt) {
    const job = this.queue[0];
    if (!job) return;
    job.t += dt;
    if (job.t >= job.recipe.time) {
      this.queue.shift();
      const r = job.recipe;
      const def = ITEMS[r.id];
      const left = this.game.inventory.add(r.id, r.qty, def.gun ? { mag: 0 } : null);
      this.game.ui.pickup(r.id, r.qty - left);
      if (left > 0) this.game.dropItems([{ id: r.id, qty: left }]);
      this.game.audio.play('craft');
    }
  }

  clear(refund = false) {
    if (refund) while (this.queue.length) this.cancel(0);
    this.queue = [];
  }
}
