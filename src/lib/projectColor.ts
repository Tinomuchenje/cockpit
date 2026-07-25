/*
 * Stable per-project accent colours. Keyed off the project's index in the
 * list rather than a hash of its id, so the first project always gets the
 * first colour and adjacent projects never collide.
 *
 * Tuned for the dark surface: high enough lightness to read as a label,
 * low enough saturation not to fight the accent colour.
 */
const PALETTE = [
  { tag: 'bg-[#1e3a5f] text-[#93c5fd]', bar: 'bg-[#60a5fa]' }, // blue
  { tag: 'bg-[#14432f] text-[#6ee7b7]', bar: 'bg-[#34d399]' }, // emerald
  { tag: 'bg-[#4a3410] text-[#fcd34d]', bar: 'bg-[#fbbf24]' }, // amber
  { tag: 'bg-[#3b2154] text-[#d8b4fe]', bar: 'bg-[#c084fc]' }, // purple
  { tag: 'bg-[#4c1d3d] text-[#f9a8d4]', bar: 'bg-[#f472b6]' }, // pink
  { tag: 'bg-[#134e4a] text-[#5eead4]', bar: 'bg-[#2dd4bf]' }, // teal
  { tag: 'bg-[#4a2318] text-[#fdba74]', bar: 'bg-[#fb923c]' }, // orange
  { tag: 'bg-[#1e3a3a] text-[#a5b4fc]', bar: 'bg-[#818cf8]' }, // indigo
];

export function projectColor(index: number) {
  if (index < 0) return { tag: 'bg-raised text-muted', bar: 'bg-faint' };
  return PALETTE[index % PALETTE.length];
}
