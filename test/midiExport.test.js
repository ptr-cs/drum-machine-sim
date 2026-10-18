import assert from "node:assert/strict";
import test from "node:test";
import {
  DRUM_MIDI_NOTES,
  MIDI_PPQ,
  createMidiFile,
  encodeVariableLength,
  midiFilename,
  ticksPerStep,
} from "../src/midiExport.js";
import { DRUM_LANES, emptyBass, emptyDrums } from "../src/music.js";

function sampleProject(rateId = "16n") {
  const drums = emptyDrums();
  drums.kick[0] = 1;
  drums.snare[2] = 0.8;
  const bass = emptyBass();
  bass[1] = { note: "F#1", midi: 30, velocity: 0.75, length: 2, slide: false };
  bass[3] = { note: "C#2", midi: 37, velocity: 0.9, length: 1, slide: true };
  return {
    seed: "MIDI TEST",
    bpm: 142,
    rateId,
    length: 16,
    drums,
    bass,
    bassSound: { glide: 0.1 },
  };
}

function text(bytes, start, length) {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function readUint32(bytes, offset) {
  return ((bytes[offset] << 24) >>> 0)
    + (bytes[offset + 1] << 16)
    + (bytes[offset + 2] << 8)
    + bytes[offset + 3];
}

function trackChunks(bytes) {
  const tracks = [];
  let offset = 14;
  while (offset < bytes.length) {
    assert.equal(text(bytes, offset, 4), "MTrk");
    const length = readUint32(bytes, offset + 4);
    tracks.push(bytes.slice(offset + 8, offset + 8 + length));
    offset += 8 + length;
  }
  return tracks;
}

function readVariableLength(bytes, state) {
  let value = 0;
  let byte;
  do {
    byte = bytes[state.offset];
    state.offset += 1;
    value = (value << 7) | (byte & 0x7f);
  } while (byte & 0x80);
  return value;
}

function channelEvents(track) {
  const state = { offset: 0 };
  const result = [];
  let tick = 0;
  while (state.offset < track.length) {
    tick += readVariableLength(track, state);
    const status = track[state.offset];
    state.offset += 1;
    if (status === 0xff) {
      state.offset += 1;
      const length = readVariableLength(track, state);
      state.offset += length;
      continue;
    }
    const type = status & 0xf0;
    const length = type === 0xc0 || type === 0xd0 ? 1 : 2;
    const data = Array.from(track.slice(state.offset, state.offset + length));
    state.offset += length;
    result.push({ tick, status, data });
  }
  return result;
}

test("MIDI export writes a deterministic format-1 file with three tracks", () => {
  const first = createMidiFile(sampleProject());
  const second = createMidiFile(sampleProject());
  assert.deepEqual(first, second);
  assert.equal(text(first, 0, 4), "MThd");
  assert.equal(first[9], 1);
  assert.equal((first[10] << 8) + first[11], 3);
  assert.equal((first[12] << 8) + first[13], MIDI_PPQ);
  assert.equal(trackChunks(first).length, 3);
});

test("straight and triplet grids resolve to exact MIDI ticks", () => {
  assert.equal(ticksPerStep("32n"), 60);
  assert.equal(ticksPerStep("16t"), 80);
  assert.equal(ticksPerStep("16n"), 120);
  assert.equal(ticksPerStep("8t"), 160);
  assert.equal(ticksPerStep("8n"), 240);
  assert.equal(ticksPerStep("1m"), 1920);
});

test("half-tempo export doubles note spacing and gate timing", () => {
  const project = sampleProject("16n");
  const normalTracks = trackChunks(createMidiFile(project));
  const halfTempoTracks = trackChunks(createMidiFile(project, { halfTempo: true }));
  const normalDrums = channelEvents(normalTracks[1]);
  const halfTempoDrums = channelEvents(halfTempoTracks[1]);
  const normalBass = channelEvents(normalTracks[2]);
  const halfTempoBass = channelEvents(halfTempoTracks[2]);
  const noteOns = (events) => events.filter((event) => (event.status & 0xf0) === 0x90);

  assert.deepEqual(
    noteOns(halfTempoDrums).map(({ tick }) => tick),
    noteOns(normalDrums).map(({ tick }) => tick * 2),
  );
  assert.deepEqual(
    noteOns(halfTempoBass).map(({ tick }) => tick),
    noteOns(normalBass).map(({ tick }) => tick * 2),
  );
  const normalBassOff = normalBass.find((event) => event.status === 0x80);
  const halfTempoBassOff = halfTempoBass.find((event) => event.status === 0x80);
  assert.equal(halfTempoBassOff.tick, normalBassOff.tick * 2);
});

test("drums use channel 10 and bass preserves triplet timing and slide overlap", () => {
  const [, drumTrack, bassTrack] = trackChunks(createMidiFile(sampleProject("8t")));
  const drums = channelEvents(drumTrack);
  const bass = channelEvents(bassTrack);
  const kick = drums.find((event) => event.status === 0x99 && event.data[0] === DRUM_MIDI_NOTES.kick);
  const snare = drums.find((event) => event.status === 0x99 && event.data[0] === DRUM_MIDI_NOTES.snare);
  const bassOns = bass.filter((event) => event.status === 0x90);
  const portamento = bass.filter((event) => event.status === 0xb0 && event.data[0] === 65);
  const firstBassOff = bass.find((event) => event.status === 0x80 && event.data[0] === 30);

  assert.equal(kick.tick, 0);
  assert.equal(snare.tick, 320);
  assert.deepEqual(bassOns.map((event) => event.tick), [160, 480]);
  assert.ok(portamento.some((event) => event.tick === 160 && event.data[1] === 0));
  assert.ok(portamento.some((event) => event.tick === 480 && event.data[1] === 127));
  assert.ok(firstBassOff.tick > bassOns[1].tick, "slide source should overlap its target");
  assert.ok(DRUM_LANES.every(({ id }) => Number.isInteger(DRUM_MIDI_NOTES[id])));
});

test("variable-length values and filenames are MIDI-safe", () => {
  assert.deepEqual(encodeVariableLength(0), [0]);
  assert.deepEqual(encodeVariableLength(127), [127]);
  assert.deepEqual(encodeVariableLength(128), [0x81, 0x00]);
  assert.deepEqual(encodeVariableLength(16_383), [0xff, 0x7f]);
  const exportedAt = new Date("2026-10-18T19:50:12.347Z");
  assert.equal(
    midiFilename({ seed: " BX / Night 01 " }, exportedAt),
    "drum-machine-sim-bx-night-01-2026-10-18T19-50-12-347Z.mid",
  );
  assert.equal(
    midiFilename({ seed: " BX / Night 01 " }, exportedAt, { halfTempo: true }),
    "drum-machine-sim-bx-night-01-half-tempo-2026-10-18T19-50-12-347Z.mid",
  );
  assert.notEqual(
    midiFilename({ seed: "repeat" }, exportedAt),
    midiFilename({ seed: "repeat" }, new Date(exportedAt.getTime() + 1)),
  );
});
