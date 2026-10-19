import assert from "node:assert/strict";
import test from "node:test";
import {
  createRng,
  generateBassPattern,
  generateBassSound,
  generateDrumPattern,
  generateGrooveSettings,
  generateMelodyPattern,
  melodySummary,
} from "../src/generator.js";
import {
  DRUM_LANES,
  NOTE_NAMES,
  PATTERN_LENGTHS,
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
  const drums = generateDrumPattern(options);
  const bass = generateBassPattern({ ...options, drums, root: "F#", scale: "minor" });
  const melodyOptions = { ...options, drums, bass, root: "F#", scale: "minor" };
  assert.deepEqual(generateMelodyPattern(melodyOptions), generateMelodyPattern(melodyOptions));
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

test("groove settings choose fresh drill tempos, roots, and minor modes", () => {
  const previous = { previousBpm: 142, previousRoot: "F#", previousScale: "minor" };
  for (let index = 0; index < 120; index += 1) {
    const options = { seed: `groove-settings-${index}`, ...previous };
    const settings = generateGrooveSettings(options);
    assert.deepEqual(settings, generateGrooveSettings(options));
    assert.ok([140, 142, 144, 145, 146, 148, 150].includes(settings.bpm));
    assert.ok(NOTE_NAMES.includes(settings.root));
    assert.ok(Object.hasOwn(SCALES, settings.scale));
    assert.notEqual(settings.bpm, previous.previousBpm);
    assert.notEqual(settings.root, previous.previousRoot);
    assert.notEqual(settings.scale, previous.previousScale);
  }
});

test("active length is respected across each supported grid", () => {
  for (const rateId of ["32n", "16t", "16n", "8t", "8n", "4n", "2n", "1m"]) {
    for (const length of PATTERN_LENGTHS) {
      const seed = `${rateId}-${length}`;
      const drums = generateDrumPattern({ seed, rateId, length });
      for (const { id } of DRUM_LANES) {
        assert.ok(drums[id].slice(length).every((velocity) => velocity === 0));
      }
      const bass = generateBassPattern({ seed, drums, rateId, length, root: "F#", scale: "minor" });
      assert.equal(bass.length, TOTAL_STEPS);
      assert.ok(bass.slice(length).every((event) => event === null));
      assert.ok(bass.slice(0, length).some(Boolean));
      const melody = generateMelodyPattern({
        seed,
        drums,
        bass,
        rateId,
        length,
        root: "F#",
        scale: "minor",
      });
      assert.equal(melody.length, TOTAL_STEPS);
      assert.ok(melody.slice(length).every((event) => event === null));
      assert.ok(melody.slice(0, length).some(Boolean));
      const active = melody.slice(0, length).map((event, step) => (
        event ? { event, step } : null
      )).filter(Boolean);
      active.forEach(({ event, step }, index) => {
        const nextStep = active[index + 1]?.step ?? length;
        assert.ok(event.midi >= 55 && event.midi <= 84);
        assert.ok(event.length >= 1 && event.length <= nextStep - step);
      });
    }
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
  let foundLongDecay = false;
  let foundAggressiveLevel = false;
  for (let index = 0; index < 300; index += 1) {
    const patch = generateBassSound({ seed: `sound-${index}`, energy: index / 299 });
    assert.ok(["sine", "triangle"].includes(patch.wave));
    assert.ok(["round", "knock", "growl", "long-slide"].includes(patch.archetype));
    assert.ok(patch.attack >= 0.002 && patch.attack <= 0.025);
    assert.ok(patch.decay >= 0.25 && patch.decay <= 4.5);
    assert.ok(patch.glide >= 0.02 && patch.glide <= 0.24);
    assert.ok(patch.punch >= 8 && patch.punch <= 36);
    assert.ok(patch.cutoff >= 120 && patch.cutoff <= 900);
    assert.ok(patch.drive >= 0 && patch.drive <= 0.95);
    assert.ok(patch.body >= 0 && patch.body <= 1);
    assert.ok(patch.sub >= 0 && patch.sub <= 0.58);
    assert.ok(patch.level >= 0.35 && patch.level <= 1.2);
    foundLongDecay ||= patch.decay > 1.8;
    foundAggressiveLevel ||= patch.level > 0.95;
  }
  assert.ok(foundLongDecay, "generator should reach the extended decay range");
  assert.ok(foundAggressiveLevel, "generator should reach the extended output range");

  const sparse = Array(64).fill(null);
  [0, 16, 32, 48].forEach((step) => { sparse[step] = { slide: false }; });
  const dense = Array.from({ length: 64 }, (_, step) => step % 3 === 0 ? { slide: false } : null);
  const sparsePatch = generateBassSound({ seed: "density-check", pattern: sparse, length: 64 });
  const densePatch = generateBassSound({ seed: "density-check", pattern: dense, length: 64 });
  assert.ok(sparsePatch.decay >= 0.92);
  assert.ok(densePatch.decay <= 0.9);
});

test("melodies stay ominous, tonal, sparse, monophonic, and clear of the rhythm section", () => {
  for (let seedIndex = 0; seedIndex < 120; seedIndex += 1) {
    const seed = `melody-${seedIndex}`;
    const root = NOTE_NAMES[seedIndex % NOTE_NAMES.length];
    const scale = Object.keys(SCALES)[seedIndex % Object.keys(SCALES).length];
    const drums = generateDrumPattern({ seed, rateId: "16n", length: 64 });
    const bass = generateBassPattern({ seed, drums, root, scale, rateId: "16n", length: 64 });
    const melody = generateMelodyPattern({
      seed,
      drums,
      bass,
      root,
      scale,
      rateId: "16n",
      length: 64,
      energy: 0.68,
      variation: 0.56,
    });
    const active = melody.map((event, step) => (event ? { event, step } : null)).filter(Boolean);
    const rootMidi = getRootMidi(root);
    const allowed = new Set(SCALES[scale].intervals.map((interval) => (rootMidi + interval) % 12));

    assert.ok(active.length >= 8 && active.length <= 24, `unmusical density for ${seed}`);
    assert.ok(active.every(({ event }) => event.midi >= 55 && event.midi <= 84));
    assert.ok(active.every(({ event }) => noteToMidi(event.note) === event.midi));
    assert.ok(active.every(({ event }) => allowed.has(event.midi % 12)), `out-of-scale note for ${seed}`);
    assert.ok(active.every(({ event }) => (
      Number.isInteger(event.length)
      && event.length >= 1
      && event.velocity >= 0.46
      && event.velocity <= 0.88
    )));
    active.forEach(({ event, step }, index) => {
      const nextStep = active[index + 1]?.step ?? 64;
      assert.ok(event.length <= nextStep - step, `overlapping melody at ${step} for ${seed}`);
    });
    assert.equal(active.at(-1).event.midi % 12, rootMidi % 12, `unresolved phrase for ${seed}`);
    assert.ok(
      active.some(({ step }, index) => index > 0 && step - active[index - 1].step >= 3),
      `no breathing room for ${seed}`,
    );
    const bassCollisions = active.filter(({ step }) => bass[step]).length / active.length;
    const backbeatCollisions = active.filter(({ step }) => drums.snare[step] || drums.clap[step]).length / active.length;
    assert.ok(bassCollisions <= 0.35, `melody crowds bass for ${seed}`);
    assert.ok(backbeatCollisions <= 0.35, `melody crowds backbeat for ${seed}`);

    const summary = melodySummary(melody, 64);
    assert.equal(summary.events, active.length);
    assert.equal(summary.held, active.filter(({ event }) => event.length >= 3).length);
    assert.match(summary.range, /^[A-G]#?-?\d–[A-G]#?-?\d$/);
  }
});

test("melody phrases repeat, develop, and move with connected voice leading", () => {
  let motifMatches = 0;
  let rhythmSimilarity = 0;
  let compactIntervals = 0;
  let closeIntervals = 0;
  let totalIntervals = 0;
  let movingIntervals = 0;
  let reversals = 0;
  let balancedBars = 0;
  let totalBars = 0;
  let shapedPhrases = 0;
  let connectedNotes = 0;
  let shortGapNotes = 0;
  let largestLeap = 0;
  const sampleCount = 160;

  const setSimilarity = (left, right) => {
    const leftSet = new Set(left);
    const rightSet = new Set(right);
    const union = new Set([...leftSet, ...rightSet]);
    return [...union].filter((value) => leftSet.has(value) && rightSet.has(value)).length
      / Math.max(1, union.size);
  };
  const motifSignature = (events) => JSON.stringify({
    rhythm: events.slice(1, 3).map((event, index) => event.step - events[index].step),
    contour: events.slice(1, 3).map((event, index) => event.midi - events[index].midi),
  });

  for (let seedIndex = 0; seedIndex < sampleCount; seedIndex += 1) {
    const seed = `flow-${seedIndex}`;
    const root = NOTE_NAMES[seedIndex % NOTE_NAMES.length];
    const scale = Object.keys(SCALES)[seedIndex % Object.keys(SCALES).length];
    const drums = generateDrumPattern({ seed, rateId: "16n", length: 64 });
    const bass = generateBassPattern({ seed, drums, root, scale, rateId: "16n", length: 64 });
    const melody = generateMelodyPattern({
      seed,
      drums,
      bass,
      root,
      scale,
      rateId: "16n",
      length: 64,
      energy: 0.68,
      variation: 0.56,
    });
    const active = melody.map((event, step) => (event ? { ...event, step } : null)).filter(Boolean);
    const bars = Array.from({ length: 4 }, (_, bar) => active
      .filter(({ step }) => step >= bar * 16 && step < (bar + 1) * 16)
      .map((event) => ({ ...event, localStep: event.step - bar * 16 })));
    const firstCell = bars[0].slice(0, 3);
    const secondCell = bars[1].slice(0, 3);
    if (firstCell.length === 3 && secondCell.length === 3
      && motifSignature(firstCell) === motifSignature(secondCell)) motifMatches += 1;
    rhythmSimilarity += setSimilarity(
      bars[0].map(({ localStep }) => localStep),
      bars[1].map(({ localStep }) => localStep),
    );
    bars.forEach((bar) => {
      totalBars += 1;
      if (bar.length >= 2 && bar.length <= 4) balancedBars += 1;
    });

    const signedIntervals = [];
    const gaps = [];
    active.slice(1).forEach((event, index) => {
      const interval = event.midi - active[index].midi;
      const absolute = Math.abs(interval);
      const gap = event.step - active[index].step;
      signedIntervals.push(interval);
      gaps.push(gap);
      totalIntervals += 1;
      if (absolute <= 5) compactIntervals += 1;
      if (absolute <= 7) closeIntervals += 1;
      largestLeap = Math.max(largestLeap, absolute);
      if (gap <= 4) {
        shortGapNotes += 1;
        if (active[index].length / gap >= 0.6) connectedNotes += 1;
      }
    });
    const moving = signedIntervals.filter(Boolean);
    movingIntervals += Math.max(0, moving.length - 1);
    for (let index = 1; index < moving.length; index += 1) {
      if (Math.sign(moving[index]) !== Math.sign(moving[index - 1])) reversals += 1;
    }
    if (gaps.some((gap) => gap <= 4) && gaps.some((gap) => gap >= 5)) shapedPhrases += 1;
  }

  assert.ok(motifMatches / sampleCount >= 0.9, "A and A′ should retain a recognizable three-note cell");
  assert.ok(rhythmSimilarity / sampleCount >= 0.82, "A and A′ should share a stable pulse skeleton");
  assert.ok(compactIntervals / totalIntervals >= 0.9, "most melody motion should stay within five semitones");
  assert.ok(closeIntervals / totalIntervals >= 0.99, "nearly all melody motion should stay within seven semitones");
  assert.ok(largestLeap <= 7, "melody should avoid abrupt register jumps");
  assert.ok(reversals / movingIntervals <= 0.55, "melodic contours should not zig-zag randomly");
  assert.ok(balancedBars / totalBars >= 0.95, "phrases should use compact two-to-four-note cells");
  assert.ok(shapedPhrases / sampleCount >= 0.95, "phrases should contain both movement and breathing room");
  assert.ok(connectedNotes / shortGapNotes >= 0.85, "nearby notes should use connected, flowing gates");
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
