// Deterministic paper rarity. Hash the slug into a stable bucket so tiers
// never shuffle between builds. Approx distribution across 158 papers:
//   keystone ~3%  (4-5)
//   exotic   ~12% (~19)
//   rare     ~25% (~40)
//   common   ~60% (~95)

export const TIERS = {
  common:   { key: 'common',   label: 'common',   hex: '#888888', unlockText: 'paper unlocked' },
  rare:     { key: 'rare',     label: 'rare',     hex: '#38bdf8', unlockText: 'rare paper unlocked' },
  exotic:   { key: 'exotic',   label: 'exotic',   hex: '#a78bfa', unlockText: 'exotic paper unlocked' },
  keystone: { key: 'keystone', label: 'keystone', hex: '#ffd166', unlockText: 'keystone unlocked' },
};

function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function tierForSlug(slug) {
  const bucket = hash32(String(slug)) % 1000;
  if (bucket < 30)  return TIERS.keystone;
  if (bucket < 150) return TIERS.exotic;
  if (bucket < 400) return TIERS.rare;
  return TIERS.common;
}
