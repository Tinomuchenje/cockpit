/*
 * Short synthesised chimes for session events. Web Audio rather than an audio
 * file: no asset to ship, no load latency, and the tone is tunable here.
 */

let ctx: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  return ctx;
}

function tone(context: AudioContext, freq: number, startAt: number, duration: number) {
  const osc = context.createOscillator();
  const gain = context.createGain();

  osc.type = 'sine';
  osc.frequency.value = freq;

  // Quick attack, gentle exponential release — a soft "ping", not a beep.
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(0.16, startAt + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  osc.connect(gain).connect(context.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

/**
 * `attention` — a rising two-note figure: the session is waiting on you.
 * `done`      — a falling figure: the session ended.
 */
export function chime(kind: 'attention' | 'done') {
  const context = audioContext();
  if (!context) return;

  // Browsers start the context suspended until a user gesture has happened.
  if (context.state === 'suspended') void context.resume();

  const now = context.currentTime;
  if (kind === 'attention') {
    tone(context, 660, now, 0.16);
    tone(context, 880, now + 0.1, 0.22);
  } else {
    tone(context, 620, now, 0.16);
    tone(context, 440, now + 0.11, 0.28);
  }
}
