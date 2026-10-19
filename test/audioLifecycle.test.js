import test from "node:test";
import assert from "node:assert/strict";
import {
  isAppleMobile,
  primeAudioContext,
  selectPlaybackAudioSession,
  waitForAudioUnlock,
} from "../src/audioLifecycle.js";

test("recognizes iPhone and touch-capable iPad user agents", () => {
  assert.equal(isAppleMobile({ userAgent: "Mozilla/5.0 (iPhone)", platform: "iPhone" }), true);
  assert.equal(isAppleMobile({ userAgent: "Mozilla/5.0", platform: "MacIntel", maxTouchPoints: 5 }), true);
  assert.equal(isAppleMobile({ userAgent: "Mozilla/5.0", platform: "MacIntel", maxTouchPoints: 0 }), false);
});

test("selects the iOS playback session when the browser exposes one", () => {
  const navigatorObject = { audioSession: { type: "auto" } };
  assert.equal(selectPlaybackAudioSession(navigatorObject), true);
  assert.equal(navigatorObject.audioSession.type, "playback");
  assert.equal(selectPlaybackAudioSession({}), false);
});

test("primes a native audio context with a silent one-frame source", () => {
  let started = false;
  let connected = false;
  const source = {
    connect(destination) {
      connected = destination === "speaker";
    },
    start() {
      started = true;
    },
    disconnect() {},
  };
  const context = {
    sampleRate: 48000,
    destination: "speaker",
    createBuffer: (channels, length, sampleRate) => ({ channels, length, sampleRate }),
    createBufferSource: () => source,
  };

  assert.equal(primeAudioContext(context), true);
  assert.equal(connected, true);
  assert.equal(started, true);
  assert.deepEqual(source.buffer, { channels: 1, length: 1, sampleRate: 48000 });
});

test("only reports an unlocked context after it is running", async () => {
  let state = "suspended";
  const result = await waitForAudioUnlock(
    async () => { state = "running"; },
    () => state,
    { timeout: 50 },
  );
  assert.equal(result, "running");

  await assert.rejects(
    waitForAudioUnlock(async () => {}, () => "interrupted", { timeout: 50 }),
    /interrupted/,
  );
});
