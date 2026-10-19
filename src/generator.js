import {
  DEFAULT_BASS_SOUND,
  DRUM_LANES,
  NOTE_NAMES,
  SCALES,
  TOTAL_STEPS,
  emptyDrums,
  getRate,
  getRootMidi,
  midiToNote,
} from "./music.js";

export function hashSeed(value) {
  const string = String(value);
  let hash = 2166136261;
  for (let index = 0; index < string.length; index += 1) {
    hash ^= string.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createRng(seed) {
  let state = hashSeed(seed);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function nextSeed(seed) {
  return hashSeed(`${seed}:next:${Date.now()}`).toString(36).toUpperCase().slice(0, 7);
}

function weighted(rng, values) {
  const total = values.reduce((sum, item) => sum + item.weight, 0);
  let cursor = rng() * total;
  for (const item of values) {
    cursor -= item.weight;
    if (cursor <= 0) return item.value;
  }
  return values.at(-1).value;
}

const DRILL_TEMPOS = [
  { value: 140, weight: 2 },
  { value: 142, weight: 5 },
  { value: 144, weight: 6 },
  { value: 145, weight: 4 },
  { value: 146, weight: 6 },
  { value: 148, weight: 4 },
  { value: 150, weight: 2 },
];

const DRILL_ROOTS = NOTE_NAMES.map((value) => ({
  value,
  weight: ({ C: 2, "C#": 4, D: 3, "D#": 5, E: 4, F: 4, "F#": 6, G: 5, "G#": 4, A: 3, "A#": 4, B: 2 })[value],
}));

const DRILL_SCALES = [
  { value: "minor", weight: 7 },
  { value: "phrygian", weight: 2.5 },
  { value: "harmonicMinor", weight: 1.5 },
];

function withoutPrevious(values, previous) {
  const filtered = values.filter(({ value }) => value !== previous);
  return filtered.length ? filtered : values;
}

export function generateGrooveSettings({
  seed,
  previousBpm,
  previousRoot,
  previousScale,
} = {}) {
  const rng = createRng(`${seed}:groove-settings`);
  return {
    bpm: weighted(rng, withoutPrevious(DRILL_TEMPOS, Number(previousBpm))),
    root: weighted(rng, withoutPrevious(DRILL_ROOTS, previousRoot)),
    scale: weighted(rng, withoutPrevious(DRILL_SCALES, previousScale)),
  };
}

function setHit(pattern, lane, step, velocity, length = TOTAL_STEPS) {
  if (step < 0 || step >= length) return;
  pattern[lane][step] = Math.max(pattern[lane][step], velocity);
}

function quantizedStep(timeInBeats, stepBeats) {
  return Math.round(timeInBeats / stepBeats);
}

const KICK_POCKETS = [
  [0, 1.5, 2.75, 3.5],
  [0, 0.75, 2.25, 3.25],
  [0.5, 1.75, 2.5, 3.75],
  [0, 1.25, 2.5, 3.5],
  [0.75, 1.5, 2.75, 3.75],
  [0, 0.5, 1.75, 3.25],
];

const BASS_POCKETS = [
  [0, 0.75, 1.5, 2.75, 3.5],
  [0, 1.5, 2.25, 3.25],
  [0.5, 1.25, 2.75, 3.75],
  [0, 0.75, 2.5, 3.25],
  [0, 1.75, 2.5, 3.75],
];

const BASS_DEGREE_MOTIFS = [
  [0, 0, 4, 2, 0],
  [0, 4, 0, 1, 0],
  [0, 0, 6, 4, 2, 0],
  [0, 2, 0, 4, 1, 0],
];

// Original motif grammar distilled from shared production traits around
// Kay Flock's “Is Ya Ready” / “Being Honest” and Edot Babyy's “Friday Night” /
// “Ready 4 War”: sparse repeated cells, dark scalar tension, and descending
// answers. These are abstract constraints, not transcribed pitches or rhythms.
const MELODY_RHYTHM_MOTIFS = [
  [0, 0.75, 1.75, 3.25],
  [0.5, 1.25, 2.5, 3.5],
  [0, 1.5, 2.25, 3.75],
  [0.25, 1.25, 2.75, 3.5],
  [0.5, 1.75, 3],
];

const MELODY_DEGREE_MOTIFS = [
  [0, 1, 0, -1],
  [4, 3, 1, 0],
  [0, 4, 3, 1],
  [0, 6, 5, 4],
  [2, 1, 0, 4],
];

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function usableLength(length) {
  return clamp(Math.floor(Number.isFinite(length) ? length : TOTAL_STEPS), 1, TOTAL_STEPS);
}

function phraseRole(bar, barCount) {
  if (barCount === 1) return "fill";
  if (bar === barCount - 1 || bar % 4 === 3) return "fill";
  if (bar % 4 === 1) return "a-prime";
  if (bar % 4 === 2) return "b";
  return "a";
}

function uniqueSteps(steps, maximum) {
  return [...new Set(steps)]
    .filter((step) => Number.isFinite(step) && step >= 0 && step < maximum)
    .sort((left, right) => left - right);
}

function jaccard(left, right) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const union = new Set([...leftSet, ...rightSet]);
  if (!union.size) return 1;
  let shared = 0;
  leftSet.forEach((value) => {
    if (rightSet.has(value)) shared += 1;
  });
  return shared / union.size;
}

function localLaneSteps(pattern, lane, bar, stepsPerBar, length) {
  const start = bar * stepsPerBar;
  const end = Math.min(length, start + stepsPerBar);
  const result = [];
  for (let step = start; step < end; step += 1) {
    if (pattern[lane][step]) result.push(step - start);
  }
  return result;
}

function developKickPocket({
  base,
  contrast,
  role,
  stepsPerBar,
  stepBeats,
  energy,
  variation,
  rng,
}) {
  const toSteps = (beats) => uniqueSteps(
    beats.map((beat) => quantizedStep(beat, stepBeats)),
    stepsPerBar,
  );
  let steps = toSteps(role === "b" ? contrast : base);
  const target = clamp(Math.round(2.25 + energy * 2.35 + (role === "fill" ? 0.55 : 0)), 2, 6);
  const mutationChance = 0.35 + variation * 0.5;

  if (role === "a-prime" && steps.length > 2 && rng() < mutationChance) {
    const index = 1 + Math.floor(rng() * (steps.length - 1));
    if (rng() < 0.32 && steps.length >= target) {
      steps.splice(index, 1);
    } else {
      steps[index] = clamp(steps[index] + (rng() < 0.5 ? -1 : 1), 0, stepsPerBar - 1);
    }
  }

  if (role === "b" && rng() < variation * 0.45 && steps.length > 2) {
    const index = 1 + Math.floor(rng() * (steps.length - 1));
    steps[index] = clamp(steps[index] + (rng() < 0.5 ? -1 : 1), 0, stepsPerBar - 1);
  }

  if (role === "fill") {
    const turnaround = stepsPerBar - 1;
    if (stepBeats <= 0.25 || rng() < 0.72) steps.push(turnaround);
    if (stepBeats <= 1 / 6 && energy > 0.72 && rng() < variation * 0.5) {
      steps.push(Math.max(0, turnaround - (rateAwareRollCount(stepBeats) - 1)));
    }
  }

  steps = uniqueSteps(steps, stepsPerBar);
  while (steps.length > target) {
    const removable = steps
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => step !== 0);
    if (!removable.length) break;
    const selection = removable[Math.floor(rng() * removable.length)];
    steps.splice(selection.index, 1);
  }

  const additions = toSteps([0.75, 1.25, 1.75, 2.5, 3.25, 3.75]);
  while (steps.length < target && additions.length) {
    const index = Math.floor(rng() * additions.length);
    steps.push(additions.splice(index, 1)[0]);
    steps = uniqueSteps(steps, stepsPerBar);
  }
  return steps;
}

function rateAwareRollCount(stepBeats) {
  if (stepBeats <= 0.125) return 4;
  if (stepBeats <= 1 / 6 + 0.0001) return 3;
  return 2;
}

function drumCandidateScore(pattern, { length, stepBeats, stepsPerBar, barCount, energy, variation }) {
  const kicks = pattern.kick.slice(0, length)
    .map((velocity, step) => (velocity ? step : -1))
    .filter((step) => step >= 0);
  const hats = pattern.closedHat.slice(0, length).filter(Boolean).length;
  const targetKicks = barCount * (2.35 + energy * 2.25);
  const targetHats = Math.min(length, barCount * (6.2 + energy * 2.8));
  let score = 80;

  score -= Math.abs(kicks.length - targetKicks) * 4;
  score -= Math.abs(hats - targetHats) * 0.7;

  if (stepBeats < 1 && kicks.length) {
    const syncopated = kicks.filter((step) => {
      const beat = step * stepBeats;
      return Math.abs(beat - Math.round(beat)) > 0.001;
    }).length / kicks.length;
    score -= Math.abs(syncopated - (0.48 + variation * 0.2)) * 24;
  }

  for (let bar = 0; bar < barCount; bar += 1) {
    const start = bar * stepsPerBar;
    if (start >= length) continue;
    const anchor = start + quantizedStep(2, stepBeats);
    score += pattern.snare[anchor] ? 6 : -18;

    const localKicks = localLaneSteps(pattern, "kick", bar, stepsPerBar, length);
    const edges = [-1, ...localKicks, Math.min(stepsPerBar, length - start)];
    let largestGap = 0;
    for (let index = 1; index < edges.length; index += 1) {
      largestGap = Math.max(largestGap, edges[index] - edges[index - 1] - 1);
    }
    if (largestGap * stepBeats >= 0.75) score += 4;
    else score -= 5;
  }

  if (barCount > 1) {
    const a = localLaneSteps(pattern, "kick", 0, stepsPerBar, length);
    const aPrime = localLaneSteps(pattern, "kick", 1, stepsPerBar, length);
    const similarity = jaccard(a, aPrime);
    score += similarity >= 0.45 && similarity < 1 ? 11 : -Math.abs(similarity - 0.68) * 12;
  }

  for (let step = 0; step < length; step += 1) {
    if (pattern.openHat[step] && pattern.closedHat[step]) score -= 14;
    const crowded = DRUM_LANES.reduce(
      (sum, { id }) => sum + (pattern[id][step] ? 1 : 0),
      0,
    );
    if (crowded > 4) score -= (crowded - 4) * 5;
  }
  return score;
}

/**
 * Generates a constrained drill pocket. Targets are composed in quarter-note
 * beats and quantized onto the selected grid, so triplets are real triplets.
 */
export function generateDrumPattern({
  seed,
  rateId = "16n",
  length = TOTAL_STEPS,
  energy = 0.68,
  variation = 0.55,
} = {}) {
  const stepBeats = getRate(rateId).beats;
  const patternLength = usableLength(length);
  const safeEnergy = clamp(energy, 0, 1);
  const safeVariation = clamp(variation, 0, 1);
  const totalBeats = patternLength * stepBeats;
  const barCount = Math.max(1, Math.ceil(totalBeats / 4));
  const stepsPerBar = Math.max(1, Math.round(4 / stepBeats));
  let bestPattern = null;
  let bestScore = -Infinity;

  for (let candidate = 0; candidate < 14; candidate += 1) {
    const rng = createRng(`${seed}:drums:candidate:${candidate}`);
    const pattern = emptyDrums();
    const base = KICK_POCKETS[Math.floor(rng() * KICK_POCKETS.length)];
    let contrast = KICK_POCKETS[Math.floor(rng() * KICK_POCKETS.length)];
    if (contrast === base) contrast = KICK_POCKETS[(KICK_POCKETS.indexOf(base) + 1) % KICK_POCKETS.length];
    const straightHats = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];
    const drillHats = [0, 0.75, 1.5, 2, 2.75, 3.5];
    const baseHats = rng() < 0.68 ? drillHats : straightHats;
    const contrastHats = baseHats === drillHats ? straightHats : drillHats;

    for (let bar = 0; bar < barCount; bar += 1) {
      const role = phraseRole(bar, barCount);
      const barStart = bar * stepsPerBar;
      const localKicks = developKickPocket({
        base,
        contrast,
        role,
        stepsPerBar,
        stepBeats,
        energy: safeEnergy,
        variation: safeVariation,
        rng,
      });

      localKicks.forEach((localStep, index) => {
        const metricBeat = Math.abs((localStep * stepBeats) % 1) < 0.001;
        const velocity = index === 0
          ? 0.94 + rng() * 0.06
          : metricBeat
            ? 0.82 + rng() * 0.12
            : 0.66 + rng() * 0.22;
        setHit(pattern, "kick", barStart + localStep, velocity, patternLength);
      });

      const backbeat = barStart + quantizedStep(2, stepBeats);
      setHit(pattern, "snare", backbeat, 0.96 + rng() * 0.04, patternLength);
      if (rng() < 0.44 + safeEnergy * 0.32) {
        setHit(pattern, "clap", backbeat, 0.76 + rng() * 0.14, patternLength);
      }

      if ((role === "a-prime" || role === "fill") && rng() < safeVariation * 0.5) {
        const ghostBeat = role === "fill" && rng() < 0.6 ? 3.75 : 1.75;
        setHit(
          pattern,
          "snare",
          barStart + quantizedStep(ghostBeat, stepBeats),
          0.32 + rng() * 0.18,
          patternLength,
        );
      }

      const hatSource = role === "b" ? contrastHats : baseHats;
      let hatSteps = uniqueSteps(
        hatSource.map((beat) => quantizedStep(beat, stepBeats)),
        stepsPerBar,
      );
      if (role === "a-prime" && hatSteps.length > 3 && rng() < safeVariation * 0.4) {
        const index = 1 + Math.floor(rng() * (hatSteps.length - 1));
        hatSteps[index] = clamp(hatSteps[index] + (rng() < 0.5 ? -1 : 1), 0, stepsPerBar - 1);
        hatSteps = uniqueSteps(hatSteps, stepsPerBar);
      }
      if (role === "fill" && stepBeats <= 0.25) hatSteps.push(stepsPerBar - 1);
      uniqueSteps(hatSteps, stepsPerBar).forEach((localStep) => {
        const isOffbeat = Math.abs((localStep * stepBeats) % 1 - 0.5) < 0.08;
        const skipChance = 0.04 + (1 - safeEnergy) * 0.18 + (role === "b" ? 0.04 : 0);
        if (rng() < skipChance && localStep !== 0) return;
        const velocity = isOffbeat ? 0.52 + rng() * 0.14 : 0.7 + rng() * 0.14;
        setHit(pattern, "closedHat", barStart + localStep, velocity, patternLength);
      });

      const canRoll = stepBeats <= 0.25;
      const rollChance = 0.12 + safeEnergy * 0.25 + safeVariation * 0.24 + (role === "fill" ? 0.18 : 0);
      if (canRoll && rng() < rollChance) {
        const rollCount = rateAwareRollCount(stepBeats);
        const nearSnare = role !== "fill" && rng() < 0.42;
        const localEnd = nearSnare
          ? Math.max(rollCount, quantizedStep(2, stepBeats))
          : stepsPerBar;
        const rollStart = clamp(localEnd - rollCount, 0, stepsPerBar - rollCount);
        for (let hit = 0; hit < rollCount; hit += 1) {
          const contour = hit / Math.max(1, rollCount - 1);
          setHit(
            pattern,
            "closedHat",
            barStart + rollStart + hit,
            0.4 + contour * 0.32,
            patternLength,
          );
        }
      }

      if (rng() < 0.3 + safeEnergy * 0.25) {
        const openBeat = weighted(rng, [
          { value: 1.5, weight: 2 },
          { value: 2.75, weight: 3 },
          { value: 3.5, weight: 4 },
        ]);
        const openStep = barStart + quantizedStep(openBeat, stepBeats);
        setHit(pattern, "openHat", openStep, 0.66 + rng() * 0.18, patternLength);
        if (openStep >= 0 && openStep < patternLength) pattern.closedHat[openStep] = 0;
      }

      const secondaryChance = 0.14 + safeVariation * 0.3 + (role === "fill" ? 0.12 : 0);
      if (rng() < secondaryChance) {
        const lane = weighted(rng, [
          { value: "rim", weight: 5 },
          { value: "lowTom", weight: role === "fill" ? 4 : 2 },
          { value: "midTom", weight: role === "fill" ? 3 : 1 },
          { value: "highTom", weight: role === "fill" ? 2 : 1 },
          { value: "cowbell", weight: 2 },
          { value: "cymbal", weight: role === "fill" ? 1.5 : 0.5 },
        ]);
        const beat = ["lowTom", "midTom", "highTom", "cymbal"].includes(lane)
          ? 3.75
          : weighted(rng, [
            { value: 1, weight: 2 },
            { value: 2.5, weight: 3 },
            { value: 3.75, weight: 2 },
          ]);
        setHit(
          pattern,
          lane,
          barStart + quantizedStep(beat, stepBeats),
          0.44 + rng() * 0.2,
          patternLength,
        );
      }
    }

    if (!pattern.kick.slice(0, patternLength).some(Boolean)) pattern.kick[0] = 1;
    for (let step = 0; step < patternLength; step += 1) {
      if (pattern.openHat[step]) pattern.closedHat[step] = 0;
      if (pattern.snare[step] >= 0.9) {
        pattern.rim[step] = 0;
        pattern.cowbell[step] = 0;
        pattern.cymbal[step] = 0;
      }
    }

    const score = drumCandidateScore(pattern, {
      length: patternLength,
      stepBeats,
      stepsPerBar,
      barCount,
      energy: safeEnergy,
      variation: safeVariation,
    });
    if (score > bestScore) {
      bestPattern = pattern;
      bestScore = score;
    }
  }

  return bestPattern ?? emptyDrums();
}

function midiForDegree(rootMidi, scaleIntervals, degree, octaveShift = 0) {
  const scaleLength = scaleIntervals.length;
  const wrapped = ((degree % scaleLength) + scaleLength) % scaleLength;
  const octaves = Math.floor(degree / scaleLength) + octaveShift;
  return rootMidi + scaleIntervals[wrapped] + octaves * 12;
}

export function generateBassPattern({
  seed,
  drums,
  root = "F#",
  scale = "minor",
  rateId = "16n",
  length = TOTAL_STEPS,
  energy = 0.68,
  slides = 0.52,
} = {}) {
  const stepBeats = getRate(rateId).beats;
  const patternLength = usableLength(length);
  const safeEnergy = clamp(energy, 0, 1);
  const safeSlides = clamp(slides, 0, 1);
  const rootMidi = getRootMidi(root);
  const scaleIntervals = (SCALES[scale] ?? SCALES.minor).intervals;
  const stepsPerBar = Math.max(1, Math.round(4 / stepBeats));
  const barCount = Math.max(1, Math.ceil(patternLength / stepsPerBar));
  const kicks = (drums?.kick ?? []).slice(0, patternLength);
  const kickSteps = kicks
    .map((velocity, step) => (velocity ? step : -1))
    .filter((step) => step >= 0);

  const localKicksForBar = (bar) => kickSteps
    .filter((step) => step >= bar * stepsPerBar && step < (bar + 1) * stepsPerBar)
    .map((step) => step - bar * stepsPerBar);

  const closestKick = (localStep, localKicks, window) => {
    let closest = null;
    let distance = Infinity;
    localKicks.forEach((kick) => {
      const nextDistance = Math.abs(kick - localStep);
      if (nextDistance < distance) {
        closest = kick;
        distance = nextDistance;
      }
    });
    return distance <= window ? closest : null;
  };

  const voiceLedMidi = (degree, previousMidi, octaveAccent = false) => {
    const options = [-1, 0, 1, 2]
      .map((octave) => midiForDegree(rootMidi, scaleIntervals, degree, octave))
      .filter((midi) => midi >= 24 && midi <= 52);
    if (!options.length) return clamp(midiForDegree(rootMidi, scaleIntervals, degree), 24, 52);
    if (octaveAccent) {
      const raised = options.filter((midi) => midi > (previousMidi ?? rootMidi) + 5);
      if (raised.length) return raised[0];
    }
    if (previousMidi == null) {
      return options.reduce((best, midi) => (
        Math.abs(midi - rootMidi) < Math.abs(best - rootMidi) ? midi : best
      ));
    }
    return options.reduce((best, midi) => (
      Math.abs(midi - previousMidi) < Math.abs(best - previousMidi) ? midi : best
    ));
  };

  const scoreBass = (result) => {
    const active = result.slice(0, patternLength)
      .map((event, step) => (event ? { ...event, step } : null))
      .filter(Boolean);
    if (!active.length) return -Infinity;
    let score = 70;
    const targetEvents = barCount * (2.5 + safeEnergy * 2.25);
    score -= Math.abs(active.length - targetEvents) * 4;

    if (kickSteps.length) {
      const shared = active.filter(({ step }) => kicks[step]).length / active.length;
      score -= Math.abs(shared - (0.58 + safeEnergy * 0.16)) * 42;
    }

    const syncopated = active.filter(({ step }) => {
      const beat = step * stepBeats;
      return Math.abs(beat - Math.round(beat)) > 0.001;
    }).length / active.length;
    if (stepBeats < 1) score -= Math.abs(syncopated - 0.6) * 18;

    const slideCount = active.filter(({ slide }) => slide).length;
    const targetSlides = Math.min(
      Math.max(0, Math.round((active.length - 1) * safeSlides * 0.38)),
      Math.max(1, Math.ceil(barCount * 0.75)),
    );
    score -= Math.abs(slideCount - targetSlides) * 5;

    const intervals = active.slice(1).map((event, index) => Math.abs(event.midi - active[index].midi));
    const largeLeaps = intervals.filter((interval) => interval > 12).length;
    score -= largeLeaps * 9;
    if (active[0].midi % 12 === rootMidi % 12) score += 7;
    if (active.at(-1).midi % 12 === rootMidi % 12) score += 7;

    for (let bar = 0; bar < barCount; bar += 1) {
      const start = bar * stepsPerBar;
      const barEvents = active.filter(({ step }) => step >= start && step < start + stepsPerBar);
      const positions = barEvents.map(({ step }) => step - start);
      const edges = [-1, ...positions, Math.min(stepsPerBar, patternLength - start)];
      let largestGap = 0;
      for (let index = 1; index < edges.length; index += 1) {
        largestGap = Math.max(largestGap, edges[index] - edges[index - 1] - 1);
      }
      score += largestGap * stepBeats >= 0.75 ? 4 : -5;
    }

    if (barCount > 1) {
      const first = active.filter(({ step }) => step < stepsPerBar).map(({ step }) => step);
      const second = active
        .filter(({ step }) => step >= stepsPerBar && step < stepsPerBar * 2)
        .map(({ step }) => step - stepsPerBar);
      const similarity = jaccard(first, second);
      score += similarity >= 0.45 && similarity < 1 ? 10 : -Math.abs(similarity - 0.7) * 10;
    }
    return score;
  };

  let bestResult = null;
  let bestScore = -Infinity;

  for (let candidate = 0; candidate < 18; candidate += 1) {
    const rng = createRng(`${seed}:bass-pattern:candidate:${candidate}`);
    const result = Array(TOTAL_STEPS).fill(null);
    const pocket = BASS_POCKETS[Math.floor(rng() * BASS_POCKETS.length)];
    let contrast = BASS_POCKETS[Math.floor(rng() * BASS_POCKETS.length)];
    if (contrast === pocket) contrast = BASS_POCKETS[(BASS_POCKETS.indexOf(pocket) + 1) % BASS_POCKETS.length];
    const pitchMotif = BASS_DEGREE_MOTIFS[Math.floor(rng() * BASS_DEGREE_MOTIFS.length)];
    const snapWindow = stepBeats <= 0.125 ? 2 : 1;
    const targetPerBar = clamp(Math.round(2.4 + safeEnergy * 2.4), 2, 5);
    const onsetSteps = [];

    for (let bar = 0; bar < barCount; bar += 1) {
      const role = phraseRole(bar, barCount);
      const barStart = bar * stepsPerBar;
      const localLimit = Math.min(stepsPerBar, patternLength - barStart);
      const localKicks = localKicksForBar(bar).filter((step) => step < localLimit);
      const source = role === "b" ? contrast : pocket;
      let local = uniqueSteps(
        source.map((beat) => quantizedStep(beat, stepBeats)),
        localLimit,
      );

      if (role === "a-prime" && local.length > 2) {
        const index = 1 + Math.floor(rng() * (local.length - 1));
        if (rng() < 0.35) local.splice(index, 1);
        else local[index] = clamp(local[index] + (rng() < 0.5 ? -1 : 1), 0, localLimit - 1);
      }
      if (role === "fill" && localLimit > 1) {
        local.push(localLimit - 1);
        if (stepBeats <= 1 / 6 && safeEnergy > 0.66 && rng() < 0.5) {
          local.push(Math.max(0, localLimit - rateAwareRollCount(stepBeats)));
        }
      }

      local = uniqueSteps(local, localLimit).map((step) => {
        const kick = closestKick(step, localKicks, snapWindow);
        return kick != null && rng() < 0.62 + safeEnergy * 0.23 ? kick : step;
      });

      const desired = clamp(targetPerBar + (role === "fill" && safeEnergy > 0.68 ? 1 : 0), 2, 6);
      const uncoupledKicks = localKicks.filter((kick) => !local.includes(kick));
      while (local.length < desired && uncoupledKicks.length) {
        const index = Math.floor(rng() * uncoupledKicks.length);
        local.push(uncoupledKicks.splice(index, 1)[0]);
        local = uniqueSteps(local, localLimit);
      }
      while (local.length > desired) {
        const removable = local
          .map((step, index) => ({ step, index, coupled: localKicks.includes(step) }))
          .filter(({ step }) => step !== 0);
        if (!removable.length) break;
        removable.sort((left, right) => Number(left.coupled) - Number(right.coupled));
        const pool = removable.filter(({ coupled }) => coupled === removable[0].coupled);
        const choice = pool[Math.floor(rng() * pool.length)];
        local.splice(choice.index, 1);
      }

      uniqueSteps(local, localLimit).forEach((localStep) => onsetSteps.push(barStart + localStep));
    }

    const activeSteps = uniqueSteps(onsetSteps, patternLength)
      .filter((step, index, array) => {
        if (index < 2) return true;
        return !(step - array[index - 1] === 1 && array[index - 1] - array[index - 2] === 1);
      });

    let previousMidi = null;
    activeSteps.forEach((step, index) => {
      const bar = Math.floor(step / stepsPerBar);
      const role = phraseRole(bar, barCount);
      const localIndex = activeSteps
        .filter((candidateStep) => candidateStep >= bar * stepsPerBar && candidateStep <= step)
        .length - 1;
      let degree = pitchMotif[localIndex % pitchMotif.length];
      const isPhraseEnd = index === activeSteps.length - 1 || (
        role === "fill" && activeSteps[index + 1] >= (bar + 1) * stepsPerBar
      );
      if (isPhraseEnd) degree = 0;
      else if (role === "b" && localIndex > 0 && rng() < 0.38) {
        degree = weighted(rng, [
          { value: 0, weight: 4 },
          { value: 4, weight: 4 },
          { value: 2, weight: 2 },
          { value: 6, weight: 2 },
          { value: 1, weight: 1 },
        ]);
      }
      const octaveAccent = index > 0
        && role !== "a"
        && rng() < 0.07 + safeEnergy * 0.13;
      const midi = voiceLedMidi(degree, previousMidi, octaveAccent);
      const nextStep = activeSteps[index + 1] ?? patternLength;
      const available = Math.max(1, nextStep - step);
      const articulation = rng();
      const gateRatio = articulation < 0.18 ? 0.42 : articulation > 0.82 ? 0.92 : 0.68 + rng() * 0.16;
      const metricAccent = Math.abs((step * stepBeats) % 1) < 0.001;
      const velocity = clamp(
        0.68 + (metricAccent ? 0.12 : 0) + (kicks[step] ? 0.08 : 0) + (localIndex === 0 ? 0.05 : 0) + (rng() - 0.5) * 0.08,
        0.5,
        0.98,
      );
      result[step] = {
        note: midiToNote(midi),
        midi,
        velocity,
        length: clamp(Math.round(available * gateRatio), 1, available),
        slide: false,
      };
      previousMidi = midi;
    });

    const eligibleSlides = activeSteps.slice(1)
      .map((step, index) => {
        const previous = activeSteps[index];
        const interval = Math.abs(result[step].midi - result[previous].midi);
        const gapBeats = (step - previous) * stepBeats;
        const localStep = step % stepsPerBar;
        const score = (interval >= 5 ? 3 : 1) + (gapBeats <= 0.5 ? 2 : 0) + (localStep > stepsPerBar * 0.7 ? 1 : 0) + rng();
        return { step, previous, index: index + 1, interval, gapBeats, score };
      })
      .filter(({ interval, gapBeats, step }) => (
        interval > 0
        && interval <= 12
        && gapBeats <= 0.85
        && step % stepsPerBar !== 0
      ))
      .sort((left, right) => right.score - left.score);
    const slideTarget = Math.min(
      Math.max(safeSlides > 0.62 && eligibleSlides.length ? 1 : 0, Math.round(eligibleSlides.length * safeSlides * 0.5)),
      Math.max(1, Math.ceil(barCount * 0.75)),
    );
    const selectedIndexes = [];
    eligibleSlides.forEach(({ step, previous, index }) => {
      if (selectedIndexes.length >= slideTarget) return;
      if (selectedIndexes.some((selected) => Math.abs(selected - index) <= 1)) return;
      result[step].slide = true;
      result[previous].length = Math.max(result[previous].length, step - previous + 1);
      selectedIndexes.push(index);
    });

    const candidateScore = scoreBass(result);
    if (candidateScore > bestScore) {
      bestResult = result;
      bestScore = candidateScore;
    }
  }

  return bestResult ?? Array(TOTAL_STEPS).fill(null);
}

export function generateMelodyPattern({
  seed,
  drums,
  bass,
  root = "F#",
  scale = "minor",
  rateId = "16n",
  length = TOTAL_STEPS,
  energy = 0.68,
  variation = 0.56,
} = {}) {
  const stepBeats = getRate(rateId).beats;
  const patternLength = usableLength(length);
  const safeEnergy = clamp(energy, 0, 1);
  const safeVariation = clamp(variation, 0, 1);
  const rootMidi = getRootMidi(root);
  const scaleIntervals = (SCALES[scale] ?? SCALES.minor).intervals;
  const stepsPerBar = Math.max(1, Math.round(4 / stepBeats));
  const barCount = Math.max(1, Math.ceil(patternLength / stepsPerBar));
  const bassPattern = Array.isArray(bass) ? bass : [];
  const snare = drums?.snare ?? [];
  const clap = drums?.clap ?? [];
  const kick = drums?.kick ?? [];
  const tensionDegrees = scale === "phrygian"
    ? [1, 5, 6]
    : scale === "harmonicMinor"
      ? [6, 5, 1]
      : [5, 6, 1];

  const collisionCost = (step) => (
    (bassPattern[step] ? 7 : 0)
    + (snare[step] ? 4 : 0)
    + (clap[step] ? 2 : 0)
    + (kick[step] ? 1 : 0)
  );

  const voiceLedMidi = (degree, previousMidi, raised = false) => {
    const options = [-1, 0, 1, 2, 3, 4, 5]
      .map((octave) => midiForDegree(rootMidi, scaleIntervals, degree, octave))
      .filter((midi) => midi >= 55 && midi <= 84);
    if (!options.length) {
      return clamp(midiForDegree(rootMidi, scaleIntervals, degree, 3), 55, 84);
    }
    const center = raised ? 74 : 67;
    return options.reduce((best, midi) => {
      const bestCost = previousMidi == null
        ? Math.abs(best - center)
        : Math.abs(best - previousMidi) + Math.abs(best - center) * 0.12;
      const nextCost = previousMidi == null
        ? Math.abs(midi - center)
        : Math.abs(midi - previousMidi) + Math.abs(midi - center) * 0.12;
      return nextCost < bestCost ? midi : best;
    });
  };

  const scoreMelody = (result) => {
    const active = result.slice(0, patternLength)
      .map((event, step) => (event ? { ...event, step } : null))
      .filter(Boolean);
    if (!active.length) return -Infinity;

    const targetPerBar = Math.min(3.25, Math.max(0.6, stepsPerBar * 0.42));
    const targetEvents = Math.min(
      patternLength * 0.58,
      barCount * targetPerBar * (0.82 + safeEnergy * 0.16),
    );
    let score = 100 - Math.abs(active.length - targetEvents) * 4;

    const bassCollisions = active.filter(({ step }) => bassPattern[step]).length / active.length;
    const backbeatCollisions = active.filter(({ step }) => snare[step] || clap[step]).length / active.length;
    score -= bassCollisions * 42;
    score -= backbeatCollisions * 34;

    const syncopated = active.filter(({ step }) => {
      const beat = step * stepBeats;
      return Math.abs(beat - Math.round(beat)) > 0.001;
    }).length / active.length;
    if (stepBeats < 1) score -= Math.abs(syncopated - 0.58) * 16;

    const rootPitchClass = ((rootMidi % 12) + 12) % 12;
    const tonicShare = active.filter(({ midi }) => midi % 12 === rootPitchClass).length / active.length;
    score -= Math.abs(tonicShare - 0.3) * 18;
    if (active[0].midi % 12 === rootPitchClass) score += 6;
    if (active.at(-1).midi % 12 === rootPitchClass) score += 10;

    let descending = 0;
    let moving = 0;
    let repeatedRun = 1;
    for (let index = 1; index < active.length; index += 1) {
      const interval = active[index].midi - active[index - 1].midi;
      if (interval !== 0) {
        moving += 1;
        if (interval < 0) descending += 1;
      }
      if (Math.abs(interval) > 12) score -= 20;
      else if (Math.abs(interval) > 7) score -= 4;
      repeatedRun = interval === 0 ? repeatedRun + 1 : 1;
      if (repeatedRun > 2) score -= 7;
      if (active[index].step - active[index - 1].step === 1
        && index > 1
        && active[index - 1].step - active[index - 2].step === 1) score -= 10;
    }
    if (moving) score -= Math.abs(descending / moving - 0.56) * 12;

    for (let bar = 0; bar < barCount; bar += 1) {
      const start = bar * stepsPerBar;
      const limit = Math.min(stepsPerBar, patternLength - start);
      const positions = active
        .filter(({ step }) => step >= start && step < start + limit)
        .map(({ step }) => step - start);
      const edges = [-1, ...positions, limit];
      let largestGap = 0;
      for (let index = 1; index < edges.length; index += 1) {
        largestGap = Math.max(largestGap, edges[index] - edges[index - 1] - 1);
      }
      score += largestGap * stepBeats >= 0.75 ? 3 : -6;
    }

    if (barCount > 1) {
      const first = active.filter(({ step }) => step < stepsPerBar).map(({ step }) => step);
      const second = active
        .filter(({ step }) => step >= stepsPerBar && step < stepsPerBar * 2)
        .map(({ step }) => step - stepsPerBar);
      if (first.length && second.length) {
        const similarity = jaccard(first, second);
        score += similarity >= 0.35 && similarity <= 0.9
          ? 10
          : -Math.abs(similarity - 0.62) * 12;
      }
    }
    return score;
  };

  let bestResult = null;
  let bestScore = -Infinity;

  for (let candidate = 0; candidate < 24; candidate += 1) {
    const rng = createRng(`${seed}:melody-pattern:candidate:${candidate}`);
    const result = Array(TOTAL_STEPS).fill(null);
    const baseRhythm = MELODY_RHYTHM_MOTIFS[Math.floor(rng() * MELODY_RHYTHM_MOTIFS.length)];
    let contrastRhythm = MELODY_RHYTHM_MOTIFS[Math.floor(rng() * MELODY_RHYTHM_MOTIFS.length)];
    if (contrastRhythm === baseRhythm) {
      contrastRhythm = MELODY_RHYTHM_MOTIFS[(MELODY_RHYTHM_MOTIFS.indexOf(baseRhythm) + 1) % MELODY_RHYTHM_MOTIFS.length];
    }
    const degreeMotif = [...MELODY_DEGREE_MOTIFS[Math.floor(rng() * MELODY_DEGREE_MOTIFS.length)]];
    const tensionDegree = tensionDegrees[Math.floor(rng() * tensionDegrees.length)];
    if (!degreeMotif.includes(tensionDegree) && degreeMotif.length > 1) degreeMotif[1] = tensionDegree;
    const onsetSteps = [];

    for (let bar = 0; bar < barCount; bar += 1) {
      const role = phraseRole(bar, barCount);
      const barStart = bar * stepsPerBar;
      const localLimit = Math.min(stepsPerBar, patternLength - barStart);
      if (localLimit <= 0) continue;
      const source = role === "b" ? contrastRhythm : baseRhythm;
      let local = uniqueSteps(
        source.map((beat) => quantizedStep(beat, stepBeats)),
        localLimit,
      );
      if (!local.length) local = [0];

      if (role === "a-prime" && local.length > 1 && rng() < 0.35 + safeVariation * 0.5) {
        const index = 1 + Math.floor(rng() * (local.length - 1));
        local[index] = clamp(local[index] + (rng() < 0.5 ? -1 : 1), 0, localLimit - 1);
      }
      if (role === "fill" && localLimit > 1) {
        local = local.slice(0, Math.max(1, local.length - 1));
        local.push(localLimit - 1);
      }

      const activityChance = clamp(0.56 + safeEnergy * 0.2 + Math.min(1, stepsPerBar / 4) * 0.2, 0.58, 0.96);
      if (stepsPerBar <= 2 && bar > 0 && bar < barCount - 1 && rng() > activityChance) continue;

      const used = new Set();
      local = uniqueSteps(local, localLimit).map((localStep) => {
        const alternatives = uniqueSteps([localStep, localStep - 1, localStep + 1], localLimit)
          .filter((step) => !used.has(step));
        const chosen = (alternatives.length ? alternatives : [localStep])
          .map((step) => ({
            step,
            cost: collisionCost(barStart + step) + Math.abs(step - localStep) * 0.75,
          }))
          .sort((left, right) => left.cost - right.cost || left.step - right.step)[0].step;
        used.add(chosen);
        return chosen;
      });
      local = uniqueSteps(local, localLimit);

      const desired = clamp(
        Math.round(Math.min(3.25, Math.max(0.65, localLimit * 0.42)) + (rng() - 0.5) * safeVariation),
        1,
        Math.min(4, localLimit),
      );
      while (local.length > desired) {
        const removable = local
          .map((step, index) => ({ step, index, cost: collisionCost(barStart + step) + (index === 0 ? -2 : 0) }))
          .sort((left, right) => right.cost - left.cost || right.index - left.index)[0];
        local.splice(removable.index, 1);
      }
      while (local.length < desired) {
        const options = Array.from({ length: localLimit }, (_, step) => step)
          .filter((step) => !local.includes(step))
          .map((step) => ({
            step,
            cost: collisionCost(barStart + step)
              + local.reduce((sum, existing) => sum + (Math.abs(existing - step) <= 1 ? 2 : 0), 0),
          }))
          .sort((left, right) => left.cost - right.cost || left.step - right.step);
        if (!options.length) break;
        local.push(options[0].step);
      }
      uniqueSteps(local, localLimit).forEach((localStep) => onsetSteps.push(barStart + localStep));
    }

    const activeSteps = uniqueSteps(onsetSteps, patternLength);
    if (!activeSteps.length) activeSteps.push(0);
    let previousMidi = null;
    activeSteps.forEach((step, index) => {
      const bar = Math.floor(step / stepsPerBar);
      const role = phraseRole(bar, barCount);
      const localIndex = activeSteps
        .filter((candidateStep) => candidateStep >= bar * stepsPerBar && candidateStep <= step)
        .length - 1;
      let degree = degreeMotif[localIndex % degreeMotif.length];
      if (role === "b" && localIndex === 0) degree = 4;
      if (role === "a-prime" && localIndex > 0 && rng() < safeVariation * 0.36) {
        degree += rng() < 0.5 ? -1 : 1;
      }
      const isFinal = index === activeSteps.length - 1;
      const isResolvingBar = role === "fill"
        && (activeSteps[index + 1] == null || activeSteps[index + 1] >= (bar + 1) * stepsPerBar);
      if (isFinal || isResolvingBar) degree = 0;
      const raised = role === "b" && localIndex === 0 && safeEnergy > 0.62 && rng() < 0.3;
      const midi = voiceLedMidi(degree, previousMidi, raised);
      const nextStep = activeSteps[index + 1] ?? patternLength;
      const available = Math.max(1, nextStep - step);
      const articulation = 0.42 + rng() * (0.36 + safeVariation * 0.12);
      const lengthInSteps = clamp(Math.round(available * articulation), 1, available);
      const metricAccent = Math.abs((step * stepBeats) % 1) < 0.001;
      const velocity = clamp(
        0.54 + (metricAccent ? 0.08 : 0) + (localIndex === 0 ? 0.05 : 0) + (rng() - 0.5) * 0.12,
        0.46,
        0.88,
      );
      result[step] = {
        note: midiToNote(midi),
        midi,
        velocity,
        length: lengthInSteps,
      };
      previousMidi = midi;
    });

    const candidateScore = scoreMelody(result);
    if (candidateScore > bestScore) {
      bestResult = result;
      bestScore = candidateScore;
    }
  }

  return bestResult ?? Array(TOTAL_STEPS).fill(null);
}

export function generateBassSound({
  seed,
  energy = 0.68,
  pattern = null,
  length = TOTAL_STEPS,
} = {}) {
  const rng = createRng(`${seed}:bass-sound`);
  const bodyRng = createRng(`${seed}:bass-body`);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const events = Array.isArray(pattern) ? pattern.slice(0, usableLength(length)).filter(Boolean) : [];
  const density = events.length / usableLength(length);
  const slideRatio = events.length
    ? events.filter((event) => event.slide).length / events.length
    : 0;
  const archetype = weighted(rng, [
    { value: "round", weight: density > 0.24 ? 3 : 5 },
    { value: "knock", weight: density > 0.2 ? 6 : 3 },
    { value: "growl", weight: 2 + energy * 3 },
    { value: "long-slide", weight: slideRatio > 0.12 ? 6 : density < 0.16 ? 3 : 1 },
  ]);
  const randomBetween = (minimum, maximum) => minimum + rng() * (maximum - minimum);
  const randomBodyBetween = (minimum, maximum) => minimum + bodyRng() * (maximum - minimum);
  const presets = {
    round: {
      wave: "sine",
      attack: randomBetween(0.004, 0.011),
      decay: randomBetween(0.9, 2.8),
      glide: randomBetween(0.06, 0.135),
      punch: randomBetween(14, 24),
      pitchDecay: randomBetween(0.028, 0.056),
      cutoff: randomBetween(190, 430),
      drive: randomBetween(0.12, 0.4),
      body: randomBodyBetween(0.38, 0.64),
      sub: randomBetween(0.24, 0.5),
      level: randomBetween(0.78, 1.02),
    },
    knock: {
      wave: "sine",
      attack: randomBetween(0.002, 0.006),
      decay: randomBetween(0.48, 1.18),
      glide: randomBetween(0.035, 0.09),
      punch: randomBetween(23, 35),
      pitchDecay: randomBetween(0.018, 0.038),
      cutoff: randomBetween(300, 680),
      drive: randomBetween(0.2, 0.54),
      body: randomBodyBetween(0.52, 0.78),
      sub: randomBetween(0.15, 0.34),
      level: randomBetween(0.8, 1.08),
    },
    growl: {
      wave: rng() < 0.78 ? "triangle" : "sine",
      attack: randomBetween(0.003, 0.009),
      decay: randomBetween(0.7, 2.1),
      glide: randomBetween(0.055, 0.14),
      punch: randomBetween(16, 28),
      pitchDecay: randomBetween(0.024, 0.052),
      cutoff: randomBetween(420, 840),
      drive: randomBetween(0.46, 0.9),
      body: randomBodyBetween(0.7, 1),
      sub: randomBetween(0.12, 0.32),
      level: randomBetween(0.78, 1.14),
    },
    "long-slide": {
      wave: "sine",
      attack: randomBetween(0.005, 0.013),
      decay: randomBetween(1.6, 4.45),
      glide: randomBetween(0.105, 0.2),
      punch: randomBetween(12, 21),
      pitchDecay: randomBetween(0.032, 0.065),
      cutoff: randomBetween(175, 440),
      drive: randomBetween(0.16, 0.48),
      body: randomBodyBetween(0.42, 0.72),
      sub: randomBetween(0.26, 0.53),
      level: randomBetween(0.76, 1.02),
    },
  };
  const selected = presets[archetype];
  if (density > 0.24) {
    selected.decay = Math.min(selected.decay, 0.9);
    selected.glide = Math.min(selected.glide, 0.12);
  } else if (events.length && density < 0.12) {
    selected.decay = Math.max(selected.decay, 1.4);
  }
  return {
    ...DEFAULT_BASS_SOUND,
    archetype,
    wave: selected.wave,
    attack: Number(clamp(selected.attack, 0.002, 0.025).toFixed(3)),
    decay: Number(clamp(selected.decay, 0.25, 4.5).toFixed(2)),
    glide: Number(clamp(selected.glide, 0.02, 0.24).toFixed(3)),
    punch: Math.round(clamp(selected.punch, 8, 36)),
    pitchDecay: Number(clamp(selected.pitchDecay, 0.018, 0.075).toFixed(3)),
    cutoff: Math.round(clamp(selected.cutoff, 120, 900)),
    drive: Number(clamp(selected.drive + energy * 0.04, 0, 0.95).toFixed(2)),
    body: Number(clamp(selected.body + energy * 0.06, 0, 1).toFixed(2)),
    sub: Number(clamp(selected.sub, 0, 0.58).toFixed(2)),
    level: Number(clamp(selected.level + energy * 0.025, 0.35, 1.2).toFixed(2)),
  };
}

export function countHits(pattern, length = TOTAL_STEPS) {
  return Object.fromEntries(
    DRUM_LANES.map(({ id }) => [
      id,
      (pattern[id] ?? []).slice(0, length).filter(Boolean).length,
    ]),
  );
}

export function bassSummary(pattern, length = TOTAL_STEPS) {
  const events = pattern.slice(0, length).filter(Boolean);
  return {
    events: events.length,
    slides: events.filter((event) => event.slide).length,
    range: events.length
      ? `${midiToNote(Math.min(...events.map((event) => event.midi)))}–${midiToNote(Math.max(...events.map((event) => event.midi)))}`
      : "—",
  };
}

export function melodySummary(pattern, length = TOTAL_STEPS) {
  const events = (pattern ?? []).slice(0, length).filter(Boolean);
  return {
    events: events.length,
    held: events.filter((event) => event.length >= 3).length,
    range: events.length
      ? `${midiToNote(Math.min(...events.map((event) => event.midi)))}–${midiToNote(Math.max(...events.map((event) => event.midi)))}`
      : "—",
  };
}
