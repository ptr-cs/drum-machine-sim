import assert from "node:assert/strict";
import test from "node:test";
import {
  createRng,
  generateBassPattern,
  generateBassSound,
  generateDrumPattern,
} from "../src/generator.js";
import {
  DRUM_LANES,
  SCALES,
  TOTAL_STEPS,
  getRate,
  getRootMidi,
  noteToMidi,
  phraseLengthLabel,
  stepGroupSize,
} from "../src/music.js";

test("seeded RNG and generators are deterministic", () => {
  const firstRng = createRng("same-seed");
  const secondRng = createRng("same-seed");
  assert.deepEqual(
    Array.from({ length: 12 }, firstRng),
    Array.from({ length: 12 }, secondRng),
  );

  const options = { seed: "BX-TEST", rateId: "16n", length: 64, energy: 0.7, variation: 0.55 };
  assert.deepEqual(generateDrumPattern(options), generateDrumPattern(options));
  assert.deepEqual(
    generateBassSound({ seed: "BX-TEST", energy: 0.7 }),
    generateBassSound({ seed: "BX-TEST", energy: 0.7 }),
  );
});

test("drum phrases stay in bounds and keep the drill backbeat", () => {
  for (let seedIndex = 0; seedIndex < 120; seedIndex += 1) {
    const pattern = generateDrumPattern({
      seed: `drums-${seedIndex}`,
      rateId: "16n",
      length: 64,
      energy: 0.65,
      variation: 0.55,
    });

    for (const { id } of DRUM_LANES) {
      assert.equal(pattern[id].length, TOTAL_STEPS);
      assert.ok(pattern[id].every((velocity) => velocity >= 0 && velocity <= 1));
    }

    for (const backbeat of [8, 24, 40, 56]) {
      assert.ok(pattern.snare[backbeat] >= 0.9, `missing backbeat at ${backbeat}`);
    }
    assert.ok(pattern.kick.filter(Boolean).length >= 6);
    assert.ok(pattern.kick.filter(Boolean).length <= 22);
    assert.ok(pattern.openHat.every((hit, step) => !hit || !pattern.closedHat[step]));
  }
});

test("active length is respected across each supported grid", () => {
  for (const rateId of ["32n", "16t", "16n", "8t", "8n", "4n", "2n", "1m"]) {
    const length = rateId === "16t" ? 48 : 24;
    const drums = generateDrumPattern({ seed: rateId, rateId, length });
    for (const { id } of DRUM_LANES) {
      assert.ok(drums[id].slice(length).every((velocity) => velocity === 0));
    }
    const bass = generateBassPattern({ seed: rateId, drums, rateId, length, root: "F#", scale: "minor" });
    assert.equal(bass.length, TOTAL_STEPS);
    assert.ok(bass.slice(length).every((event) => event === null));
    assert.ok(bass.slice(0, length).some(Boolean));
  }
});

test("bass output stays tonal, monophonic, sparse, and related to the kick", () => {
  const rootMidi = getRootMidi("F#");
  const allowed = new Set();
  for (let octave = -2; octave <= 3; octave += 1) {
    for (const interval of SCALES.minor.intervals) {
      allowed.add((rootMidi + interval + octave * 12 + 120) % 12);
    }
  }

  for (let seedIndex = 0; seedIndex < 160; seedIndex += 1) {
    const seed = `bass-${seedIndex}`;
    const drums = generateDrumPattern({ seed, rateId: "16n", length: 64 });
    const bass = generateBassPattern({
      seed,
      drums,
      root: "F#",
      scale: "minor",
      rateId: "16n",
      length: 64,
      energy: 0.68,
      slides: 0.55,
    });
    const active = bass.map((event, step) => ({ event, step })).filter(({ event }) => event);
    assert.ok(active.length >= 6, `too few bass notes for ${seed}`);
    assert.ok(active.length <= 26, `too many bass notes for ${seed}`);
    assert.ok(active.every(({ event }) => event.length >= 1 && event.velocity >= 0.35 && event.velocity <= 1));
    assert.ok(active.every(({ event }) => allowed.has(((noteToMidi(event.note) % 12) + 12) % 12)));
    const shared = active.filter(({ step }) => drums.kick[step]).length;
    assert.ok(shared / active.length >= 0.35, `weak kick relationship for ${seed}`);
    assert.ok(active.filter(({ event }) => event.slide).length <= Math.ceil(active.length * 0.5));
  }
});

test("generated bass sounds stay inside safe, useful synthesis ranges", () => {
  for (let index = 0; index < 300; index += 1) {
    const patch = generateBassSound({ seed: `sound-${index}`, energy: index / 299 });
    assert.ok(["sine", "triangle"].includes(patch.wave));
    assert.ok(["round", "knock", "growl", "long-slide"].includes(patch.archetype));
    assert.ok(patch.attack >= 0.002 && patch.attack <= 0.025);
    assert.ok(patch.decay >= 0.25 && patch.decay <= 1.8);
    assert.ok(patch.glide >= 0.02 && patch.glide <= 0.24);
    assert.ok(patch.punch >= 8 && patch.punch <= 36);
    assert.ok(patch.cutoff >= 120 && patch.cutoff <= 900);
    assert.ok(patch.drive >= 0 && patch.drive <= 0.7);
    assert.ok(patch.level >= 0.35 && patch.level <= 0.95);
  }

  const sparse = Array(64).fill(null);
  [0, 16, 32, 48].forEach((step) => { sparse[step] = { slide: false }; });
  const dense = Array.from({ length: 64 }, (_, step) => step % 3 === 0 ? { slide: false } : null);
  const sparsePatch = generateBassSound({ seed: "density-check", pattern: sparse, length: 64 });
  const densePatch = generateBassSound({ seed: "density-check", pattern: dense, length: 64 });
  assert.ok(sparsePatch.decay >= 0.92);
  assert.ok(densePatch.decay <= 0.9);
});

test("phrase labels explain straight and triplet loop lengths", () => {
  assert.equal(phraseLengthLabel(64, "16n"), "4 bars");
  assert.equal(phraseLengthLabel(48, "16t"), "2 bars");
  assert.equal(phraseLengthLabel(64, "16t"), "2 ⅔ bars");
  assert.equal(phraseLengthLabel(24, "8t"), "2 bars");
  assert.equal(phraseLengthLabel(64, "8t"), "5 ⅓ bars");
  assert.equal(getRate("8t").tone, "8t");
  assert.equal(getRate("8t").beats, 1 / 3);
  assert.equal(stepGroupSize("8t"), 3);
});
