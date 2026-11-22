// Player progress, stored in this browser only (localStorage). No accounts or server.

const KEY = 'mathsplode.v1';
export const OPERATIONS = ['addition', 'subtraction', 'multiplication'];

function defaults() {
  return { levels: Object.fromEntries(OPERATIONS.map(op => [op, 1])) };
}

function load() {
  const data = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && saved.levels) {
      for (const op of OPERATIONS) {
        const lvl = Number(saved.levels[op]);
        if (Number.isInteger(lvl) && lvl >= 1) data.levels[op] = lvl;
      }
    }
  } catch { /* storage blocked or corrupt: fall back to defaults */ }
  return data;
}

function save(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage blocked */ }
}

export function getLevel(op) {
  return load().levels[op];
}

export function setLevel(op, level) {
  const data = load();
  data.levels[op] = level;
  save(data);
}
