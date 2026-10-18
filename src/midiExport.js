import { DRUM_LANES, getRate, noteToMidi } from "./music.js";

export const MIDI_PPQ = 480;

export const DRUM_MIDI_NOTES = Object.freeze({
  kick: 36,
  rim: 37,
  snare: 38,
  clap: 39,
  closedHat: 42,
  lowTom: 45,
  openHat: 46,
  midTom: 47,
  cymbal: 49,
  highTom: 50,
  cowbell: 56,
});

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

const asciiBytes = (value) => Array.from(String(value), (character) => {
  const code = character.charCodeAt(0);
  return code >= 32 && code <= 126 ? code : 63;
});

const uint32 = (value) => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
];

const uint16 = (value) => [(value >>> 8) & 0xff, value & 0xff];

export function encodeVariableLength(value) {
  let remaining = Math.max(0, Math.floor(value));
  const bytes = [remaining & 0x7f];
  while ((remaining >>= 7) > 0) bytes.unshift((remaining & 0x7f) | 0x80);
  return bytes;
}

export function ticksPerStep(rateId) {
  return Math.round(getRate(rateId).beats * MIDI_PPQ);
}

function metaEvent(type, data) {
  return [0xff, type, ...encodeVariableLength(data.length), ...data];
}

function namedTrack(name, events, endTick) {
  const sorted = [
    { tick: 0, priority: -2, bytes: metaEvent(0x03, asciiBytes(name)) },
    ...events,
  ].sort((left, right) => left.tick - right.tick || left.priority - right.priority);

  const body = [];
  let cursor = 0;
  for (const event of sorted) {
    const tick = Math.max(cursor, Math.floor(event.tick));
    body.push(...encodeVariableLength(tick - cursor), ...event.bytes);
    cursor = tick;
  }
  body.push(...encodeVariableLength(Math.max(0, endTick - cursor)), 0xff, 0x2f, 0x00);
  return [...asciiBytes("MTrk"), ...uint32(body.length), ...body];
}

function tempoTrack(project, endTick) {
  const bpm = clamp(Number(project.bpm) || 142, 20, 400);
  const microsecondsPerBeat = Math.round(60_000_000 / bpm);
  const tempo = [
    (microsecondsPerBeat >>> 16) & 0xff,
    (microsecondsPerBeat >>> 8) & 0xff,
    microsecondsPerBeat & 0xff,
  ];
  const seed = asciiBytes(`Seed: ${project.seed || "untitled"}`);
  return namedTrack("Drum Machine Sim", [
    { tick: 0, priority: -1, bytes: metaEvent(0x51, tempo) },
    { tick: 0, priority: 0, bytes: metaEvent(0x58, [4, 2, 24, 8]) },
    { tick: 0, priority: 1, bytes: metaEvent(0x06, seed) },
  ], endTick);
}

function drumTrack(project, stepTicks, endTick) {
  const events = [{ tick: 0, priority: -1, bytes: metaEvent(0x20, [9]) }];
  const duration = Math.max(12, Math.round(stepTicks * 0.3));

  for (const { id } of DRUM_LANES) {
    const note = DRUM_MIDI_NOTES[id];
    if (note === undefined) continue;
    const lane = project.drums?.[id] ?? [];
    for (let step = 0; step < project.length; step += 1) {
      const velocity = Number(lane[step]) || 0;
      if (velocity <= 0) continue;
      const tick = step * stepTicks;
      const offTick = Math.min(endTick, tick + duration);
      const midiVelocity = clamp(Math.round(velocity * 127), 1, 127);
      events.push(
        { tick, priority: 1, bytes: [0x99, note, midiVelocity] },
        { tick: offTick, priority: 0, bytes: [0x89, note, 0] },
      );
    }
  }

  return namedTrack("TR-808 Drums", events, endTick);
}

function bassTrack(project, stepTicks, endTick) {
  const glide = clamp(Number(project.bassSound?.glide) || 0.09, 0.02, 0.24);
  const portamentoTime = Math.round(20 + ((glide - 0.02) / 0.22) * 80);
  const events = [
    { tick: 0, priority: -1, bytes: metaEvent(0x20, [0]) },
    { tick: 0, priority: 0, bytes: [0xc0, 38] },
    { tick: 0, priority: 0, bytes: [0xb0, 65, 0] },
    { tick: 0, priority: 0, bytes: [0xb0, 5, portamentoTime] },
    { tick: 0, priority: 0, bytes: [0xb0, 126, 1] },
  ];
  const notes = (project.bass ?? [])
    .slice(0, project.length)
    .map((event, step) => event ? { ...event, step } : null)
    .filter(Boolean);

  notes.forEach((event, index) => {
    const tick = event.step * stepTicks;
    const midi = clamp(Number.isFinite(event.midi) ? Math.round(event.midi) : noteToMidi(event.note), 0, 127);
    const velocity = clamp(Math.round((Number(event.velocity) || 0.78) * 127), 1, 127);
    let offTick = Math.min(
      endTick,
      tick + Math.max(1, Math.round((Number(event.length) || 1) * stepTicks)),
    );
    const next = notes[index + 1];
    if (next?.slide && next.midi !== midi) {
      const nextTick = next.step * stepTicks;
      offTick = Math.min(endTick, Math.max(offTick, nextTick + Math.max(1, Math.round(stepTicks * 0.25))));
    }
    events.push(
      { tick, priority: 0, bytes: [0xb0, 65, event.slide ? 127 : 0] },
      { tick, priority: 1, bytes: [0x90, midi, velocity] },
      { tick: offTick, priority: 0, bytes: [0x80, midi, 0] },
    );
  });

  return namedTrack("808 Bass", events, endTick);
}

export function createMidiFile(project) {
  const length = clamp(Math.round(Number(project.length) || 64), 1, 64);
  const normalizedProject = { ...project, length };
  const stepTicks = ticksPerStep(project.rateId);
  const endTick = length * stepTicks;
  const tracks = [
    tempoTrack(normalizedProject, endTick),
    drumTrack(normalizedProject, stepTicks, endTick),
    bassTrack(normalizedProject, stepTicks, endTick),
  ];
  const header = [
    ...asciiBytes("MThd"),
    ...uint32(6),
    ...uint16(1),
    ...uint16(tracks.length),
    ...uint16(MIDI_PPQ),
  ];
  return Uint8Array.from([...header, ...tracks.flat()]);
}

export function midiFilename(project, timestamp = new Date()) {
  const seed = String(project.seed || "pattern")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "pattern";
  const exportedAt = timestamp.toISOString()
    .replaceAll(":", "-")
    .replace(".", "-");
  return `drum-machine-sim-${seed}-${exportedAt}.mid`;
}

export function downloadMidiFile(project) {
  const bytes = createMidiFile(project);
  const blob = new Blob([bytes], { type: "audio/midi" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = midiFilename(project);
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
