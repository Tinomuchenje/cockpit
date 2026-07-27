/*
 * Stable per-project accent colours. Keyed off the project's index in the
 * list rather than a hash of its id, so the first project always gets the
 * first colour and adjacent projects never collide.
 *
 * The actual values live in globals.css as `--cp-p<n>-*` custom properties,
 * one set per theme. They were originally literal hex tuned for the dark
 * surface, which left a row of dark chips sitting on white once light mode
 * existed. Going through variables means a chip re-colours with everything
 * else and this file never has to know which theme is on.
 *
 * The class strings are written out in full rather than built from the index,
 * because Tailwind scans source text: an interpolated class name is invisible
 * to it and the utility is never generated.
 */
const PALETTE = [
  { tag: 'bg-[var(--cp-p0-bg)] text-[var(--cp-p0-fg)]', bar: 'bg-[var(--cp-p0-bar)]' }, // blue
  { tag: 'bg-[var(--cp-p1-bg)] text-[var(--cp-p1-fg)]', bar: 'bg-[var(--cp-p1-bar)]' }, // emerald
  { tag: 'bg-[var(--cp-p2-bg)] text-[var(--cp-p2-fg)]', bar: 'bg-[var(--cp-p2-bar)]' }, // amber
  { tag: 'bg-[var(--cp-p3-bg)] text-[var(--cp-p3-fg)]', bar: 'bg-[var(--cp-p3-bar)]' }, // purple
  { tag: 'bg-[var(--cp-p4-bg)] text-[var(--cp-p4-fg)]', bar: 'bg-[var(--cp-p4-bar)]' }, // pink
  { tag: 'bg-[var(--cp-p5-bg)] text-[var(--cp-p5-fg)]', bar: 'bg-[var(--cp-p5-bar)]' }, // teal
  { tag: 'bg-[var(--cp-p6-bg)] text-[var(--cp-p6-fg)]', bar: 'bg-[var(--cp-p6-bar)]' }, // orange
  { tag: 'bg-[var(--cp-p7-bg)] text-[var(--cp-p7-fg)]', bar: 'bg-[var(--cp-p7-bar)]' }, // indigo
];

export function projectColor(index: number) {
  if (index < 0) return { tag: 'bg-raised text-muted', bar: 'bg-faint' };
  return PALETTE[index % PALETTE.length];
}
