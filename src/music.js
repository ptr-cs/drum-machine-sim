export const TOTAL_STEPS = 64;

export const STEP_RATES = [
  { id: "32n", label: "1/32", tone: "32n", beats: 0.125 },
  { id: "16t", label: "1/16T", tone: "16t", beats: 1 / 6 },
  { id: "16n", label: "1/16", tone: "16n", beats: 0.25 },
  { id: "8t", label: "1/8T", tone: "8t", beats: 1 / 3 },
  { id: "8n", label: "1/8", tone: "8n", beats: 0.5 },
  { id: "4n", label: "1/4", tone: "4n", beats: 1 },
  { id: "2n", label: "1/2", tone: "2n", beats: 2 },
  { id: "1m", label: "1/1", tone: "1m", beats: 4 },
];

export const PATTERN_LENGTHS = [16, 24, 32, 48, 64];

export const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

export const SCALES = {
  minor: { label: "Natural minor", intervals: [0, 2, 3, 5, 7, 8, 10] },
  harmonicMinor: { label: "Harmonic minor", intervals: [0, 2, 3, 5, 7, 8, 11] },
  phrygian: { label: "Phrygian", intervals: [0, 1, 3, 5, 7, 8, 10] },
};

export const DRUM_LANES = [
  { id: "kick", short: "BD", name: "Kick", group: "low" },
  { id: "snare", short: "SD", name: "Snare", group: "main" },
  { id: "clap", short: "CP", name: "Clap", group: "main" },
  { id: "closedHat", short: "CH", name: "Closed hat", group: "metal" },
  { id: "openHat", short: "OH", name: "Open hat", group: "metal" },
  { id: "rim", short: "RS", name: "Rim shot", group: "perc" },
  { id: "lowTom", short: "LT", name: "Low tom", group: "low" },
  { id: "midTom", short: "MT", name: "Mid tom", group: "perc" },
  { id: "highTom", short: "HT", name: "High tom", group: "perc" },
  { id: "cowbell", short: "CB", name: "Cowbell", group: "perc" },
  { id: "cymbal", short: "CY", name: "Cymbal", group: "metal" },
];

export const DEFAULT_BASS_SOUND = {
  archetype: "round",
  wave: "sine",
  attack: 0.006,
  decay: 0.9,
  glide: 0.09,
  punch: 22,
  pitchDecay: 0.038,
  cutoff: 360,
  drive: 0.24,
  body: 0.42,
  sub: 0.28,
  level: 0.78,
};

export const DEFAULT_MELODY_SOUND = {
  wave: "triangle",
  attack: 0.012,
  decay: 0.22,
  sustain: 0.16,
  release: 0.55,
  cutoff: 1850,
  resonance: 3.4,
  highpass: 170,
  delay: 0.12,
  space: 0.18,
  level: 0.36,
};

export const DEFAULT_DRUM_SETTINGS = Object.fromEntries(
  DRUM_LANES.map(({ id }) => [
    id,
    {
      level: id === "kick" ? 0.92 : id === "closedHat" ? 0.62 : 0.76,
      tone: id === "kick" ? 0.42 : 0.55,
      decay: id === "openHat" ? 0.72 : id === "kick" ? 0.58 : 0.46,
    },
  ]),
);

export function getRate(rateId) {
  return STEP_RATES.find((rate) => rate.id === rateId) ?? STEP_RATES[2];
}

export function emptyDrums() {
  return Object.fromEntries(
    DRUM_LANES.map(({ id }) => [id, Array(TOTAL_STEPS).fill(0)]),
  );
}

export function emptyBass() {
  return Array(TOTAL_STEPS).fill(null);
}

export function emptyMelody() {
  return Array(TOTAL_STEPS).fill(null);
}

export function midiToNote(midi) {
  const normalized = Math.max(0, Math.min(127, Math.round(midi)));
  const octave = Math.floor(normalized / 12) - 1;
  return `${NOTE_NAMES[normalized % 12]}${octave}`;
}

export function noteToMidi(note) {
  const match = /^([A-G])(#?)(-?\d)$/.exec(note ?? "");
  if (!match) return 36;
  const pitch = NOTE_NAMES.indexOf(`${match[1]}${match[2]}`);
  return (Number(match[3]) + 1) * 12 + pitch;
}

export function getRootMidi(root) {
  const pitchClass = Math.max(0, NOTE_NAMES.indexOf(root));
  const raw = 24 + pitchClass;
  return raw < 27 ? raw + 12 : raw;
}

export function phraseLengthLabel(stepCount, rateId) {
  const beats = stepCount * getRate(rateId).beats;
  const bars = beats / 4;
  if (Number.isInteger(bars)) return `${bars} ${bars === 1 ? "bar" : "bars"}`;
  const whole = Math.floor(bars);
  const fraction = bars - whole;
  const fractionLabel = Math.abs(fraction - 2 / 3) < 0.02
    ? "⅔"
    : Math.abs(fraction - 1 / 3) < 0.02
      ? "⅓"
      : fraction.toFixed(2).replace(/^0/, "");
  return `${whole ? `${whole} ` : ""}${fractionLabel} bars`;
}

export function stepGroupSize(rateId) {
  if (rateId === "16t") return 6;
  if (rateId === "8t") return 3;
  if (rateId === "32n") return 8;
  if (rateId === "16n") return 4;
  if (rateId === "8n") return 2;
  return 1;
}
