// Item definitions, recipes and loot tables.

export const ITEMS = {
  // Resources
  wood: { name: 'Wood', icon: '🪵', stack: 1000 },
  stone: { name: 'Stone', icon: '🪨', stack: 1000 },
  metal_ore: { name: 'Metal Ore', icon: '🟤', stack: 1000 },
  sulfur_ore: { name: 'Sulfur Ore', icon: '🟡', stack: 1000 },
  metal_frags: { name: 'Metal Fragments', icon: '🔩', stack: 1000 },
  sulfur: { name: 'Sulfur', icon: '🧂', stack: 1000 },
  charcoal: { name: 'Charcoal', icon: '⚫', stack: 1000 },
  gunpowder: { name: 'Gunpowder', icon: '💥', stack: 1000 },
  scrap: { name: 'Scrap', icon: '⚙️', stack: 1000 },
  cloth: { name: 'Cloth', icon: '🧵', stack: 500 },

  // Consumables
  bandage: { name: 'Bandage', icon: '🩹', stack: 10, use: { heal: 8, stopBleed: true, time: 2.2 } },
  medkit: { name: 'Medkit', icon: '💊', stack: 3, use: { heal: 55, stopBleed: true, time: 5 } },
  beans: { name: 'Can of Beans', icon: '🥫', stack: 10, use: { food: 35, water: 5, time: 2.5 } },
  crisps: { name: 'Crisps', icon: '🍟', stack: 10, use: { food: 15, water: -5, time: 1.5 } },
  water: { name: 'Water Bottle', icon: '💧', stack: 10, use: { water: 45, time: 2 } },
  soda: { name: 'Soda Can', icon: '🥤', stack: 10, use: { water: 25, food: 5, time: 1.5 } },

  // Tools & melee
  rock: { name: 'Rock', icon: '🪨', stack: 1, melee: { dmg: 10, range: 2.2, rate: 0.85, stamina: 5 }, gather: { tree: 4, stone: 6, barrel: 1 } },
  hatchet: { name: 'Stone Hatchet', icon: '🪓', stack: 1, melee: { dmg: 18, range: 2.4, rate: 0.75, stamina: 6 }, gather: { tree: 12, stone: 3, barrel: 1 } },
  pickaxe: { name: 'Stone Pickaxe', icon: '⛏️', stack: 1, melee: { dmg: 16, range: 2.4, rate: 0.85, stamina: 7 }, gather: { tree: 3, stone: 13, barrel: 1 } },
  machete: { name: 'Machete', icon: '🔪', stack: 1, melee: { dmg: 38, range: 2.5, rate: 0.7, stamina: 6 }, gather: { tree: 6, stone: 2, barrel: 2 } },
  spear: { name: 'Wooden Spear', icon: '🔱', stack: 1, melee: { dmg: 30, range: 3.2, rate: 1.0, stamina: 8 }, gather: { tree: 2, stone: 1, barrel: 1 } },
  hammer: { name: 'Hammer', icon: '🔨', stack: 1, tool: 'hammer' },
  building_plan: { name: 'Building Plan', icon: '📐', stack: 1, tool: 'plan' },
  flashlight: { name: 'Flashlight', icon: '🔦', stack: 1 },

  // Ammo
  ammo_9mm: { name: '9x19mm FMJ', icon: '🔸', stack: 120 },
  ammo_12g: { name: '12ga Buckshot', icon: '🔴', stack: 60 },
  ammo_762: { name: '7.62x39mm PS', icon: '🔶', stack: 120 },

  // Firearms. Damage is per projectile. rpm = rounds per minute.
  pistol: {
    name: '9mm Pistol', icon: '🔫', stack: 1,
    gun: { ammo: 'ammo_9mm', mag: 12, dmg: 34, rpm: 450, auto: false, velocity: 360, spread: 0.9, adsSpread: 0.25,
      recoilV: 2.6, recoilH: 0.9, reload: 1.7, reloadEmpty: 2.3, noise: 75, pellets: 1, model: 'pistol', adsFov: 58 },
  },
  shotgun: {
    name: 'Pump Shotgun', icon: '🔫', stack: 1,
    gun: { ammo: 'ammo_12g', mag: 6, dmg: 13, rpm: 70, auto: false, velocity: 400, spread: 3.2, adsSpread: 2.6,
      recoilV: 6.5, recoilH: 1.6, reload: 0.55, reloadEmpty: 0.55, tube: true, noise: 110, pellets: 9, model: 'shotgun', adsFov: 56 },
  },
  rifle: {
    name: 'Assault Rifle', icon: '🔫', stack: 1,
    gun: { ammo: 'ammo_762', mag: 30, dmg: 48, rpm: 600, auto: true, velocity: 715, spread: 1.2, adsSpread: 0.12,
      recoilV: 1.9, recoilH: 0.75, reload: 2.4, reloadEmpty: 3.1, noise: 130, pellets: 1, model: 'rifle', adsFov: 48 },
  },
  bolt: {
    name: 'Bolt-Action Rifle', icon: '🔫', stack: 1,
    gun: { ammo: 'ammo_762', mag: 5, dmg: 105, rpm: 45, auto: false, velocity: 820, spread: 1.5, adsSpread: 0.03,
      recoilV: 5.5, recoilH: 0.6, reload: 2.8, reloadEmpty: 3.4, noise: 140, pellets: 1, model: 'bolt', adsFov: 30 },
  },

  // Deployables
  door_wood: { name: 'Wooden Door', icon: '🚪', stack: 5, deploy: 'door' },
  storage_box: { name: 'Storage Box', icon: '📦', stack: 5, deploy: 'box' },
  furnace: { name: 'Furnace', icon: '🔥', stack: 3, deploy: 'furnace' },
  campfire: { name: 'Campfire', icon: '🏕️', stack: 5, deploy: 'campfire' },
  sleeping_bag: { name: 'Sleeping Bag', icon: '🛏️', stack: 3, deploy: 'bag' },
};

export const RECIPES = [
  { id: 'building_plan', qty: 1, cost: { wood: 10 }, time: 1, cat: 'Tools' },
  { id: 'hammer', qty: 1, cost: { wood: 50 }, time: 2, cat: 'Tools' },
  { id: 'hatchet', qty: 1, cost: { wood: 100, stone: 50 }, time: 4, cat: 'Tools' },
  { id: 'pickaxe', qty: 1, cost: { wood: 100, stone: 60 }, time: 4, cat: 'Tools' },
  { id: 'spear', qty: 1, cost: { wood: 150 }, time: 4, cat: 'Weapons' },
  { id: 'machete', qty: 1, cost: { metal_frags: 60, wood: 20 }, time: 6, cat: 'Weapons' },
  { id: 'pistol', qty: 1, cost: { metal_frags: 150, scrap: 40 }, time: 15, cat: 'Weapons' },
  { id: 'shotgun', qty: 1, cost: { metal_frags: 200, wood: 100, scrap: 60 }, time: 20, cat: 'Weapons' },
  { id: 'bolt', qty: 1, cost: { metal_frags: 250, wood: 75, scrap: 120 }, time: 25, cat: 'Weapons' },
  { id: 'rifle', qty: 1, cost: { metal_frags: 350, wood: 50, scrap: 200 }, time: 30, cat: 'Weapons' },
  { id: 'gunpowder', qty: 10, cost: { charcoal: 30, sulfur: 20 }, time: 2, cat: 'Ammo' },
  { id: 'ammo_9mm', qty: 12, cost: { metal_frags: 10, gunpowder: 10 }, time: 3, cat: 'Ammo' },
  { id: 'ammo_12g', qty: 6, cost: { metal_frags: 6, gunpowder: 12 }, time: 3, cat: 'Ammo' },
  { id: 'ammo_762', qty: 10, cost: { metal_frags: 20, gunpowder: 20 }, time: 4, cat: 'Ammo' },
  { id: 'bandage', qty: 1, cost: { cloth: 4 }, time: 2, cat: 'Medical' },
  { id: 'door_wood', qty: 1, cost: { wood: 150 }, time: 4, cat: 'Deployables' },
  { id: 'storage_box', qty: 1, cost: { wood: 100 }, time: 3, cat: 'Deployables' },
  { id: 'campfire', qty: 1, cost: { wood: 50 }, time: 2, cat: 'Deployables' },
  { id: 'furnace', qty: 1, cost: { stone: 200, wood: 100, cloth: 10 }, time: 6, cat: 'Deployables' },
  { id: 'sleeping_bag', qty: 1, cost: { cloth: 30 }, time: 3, cat: 'Deployables' },
];

// Loot tables: list of { id, min, max, w }. `rolls` picks per container.
export const LOOT = {
  kitchen: {
    rolls: [1, 3],
    entries: [
      { id: 'beans', min: 1, max: 2, w: 10 }, { id: 'crisps', min: 1, max: 2, w: 8 },
      { id: 'water', min: 1, max: 2, w: 10 }, { id: 'soda', min: 1, max: 2, w: 7 },
      { id: 'cloth', min: 3, max: 8, w: 5 }, { id: 'scrap', min: 1, max: 4, w: 4 },
    ],
  },
  closet: {
    rolls: [1, 3],
    entries: [
      { id: 'cloth', min: 4, max: 12, w: 10 }, { id: 'bandage', min: 1, max: 3, w: 7 },
      { id: 'ammo_9mm', min: 4, max: 14, w: 5 }, { id: 'ammo_12g', min: 2, max: 6, w: 3 },
      { id: 'scrap', min: 2, max: 6, w: 6 }, { id: 'flashlight', min: 1, max: 1, w: 1 },
      { id: 'pistol', min: 1, max: 1, w: 1.2 }, { id: 'machete', min: 1, max: 1, w: 1 },
      { id: 'medkit', min: 1, max: 1, w: 1 }, { id: 'sulfur', min: 5, max: 15, w: 2 },
    ],
  },
  car: {
    rolls: [1, 2],
    entries: [
      { id: 'scrap', min: 3, max: 9, w: 10 }, { id: 'metal_frags', min: 10, max: 30, w: 8 },
      { id: 'cloth', min: 2, max: 6, w: 4 }, { id: 'ammo_12g', min: 2, max: 5, w: 2 },
      { id: 'water', min: 1, max: 1, w: 3 }, { id: 'gunpowder', min: 5, max: 15, w: 2 },
    ],
  },
  military: {
    rolls: [2, 4],
    entries: [
      { id: 'ammo_762', min: 10, max: 30, w: 10 }, { id: 'ammo_9mm', min: 12, max: 30, w: 8 },
      { id: 'ammo_12g', min: 6, max: 12, w: 6 }, { id: 'medkit', min: 1, max: 2, w: 5 },
      { id: 'bandage', min: 2, max: 4, w: 5 }, { id: 'rifle', min: 1, max: 1, w: 2 },
      { id: 'shotgun', min: 1, max: 1, w: 2.5 }, { id: 'pistol', min: 1, max: 1, w: 3 },
      { id: 'bolt', min: 1, max: 1, w: 1.5 }, { id: 'metal_frags', min: 30, max: 80, w: 4 },
      { id: 'gunpowder', min: 20, max: 40, w: 4 }, { id: 'scrap', min: 10, max: 25, w: 5 },
    ],
  },
  zombie: {
    rolls: [0, 2],
    entries: [
      { id: 'cloth', min: 2, max: 6, w: 10 }, { id: 'scrap', min: 1, max: 3, w: 5 },
      { id: 'beans', min: 1, max: 1, w: 2 }, { id: 'water', min: 1, max: 1, w: 2 },
      { id: 'ammo_9mm', min: 3, max: 8, w: 2 }, { id: 'bandage', min: 1, max: 1, w: 2 },
      { id: 'crisps', min: 1, max: 1, w: 2 },
    ],
  },
};
