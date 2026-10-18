import * as Tone from "tone";
import { DRUM_LANES, getRate } from "./music.js";

const dbForVelocity = (velocity) => Math.max(0.05, Math.min(1, velocity));

class BassVoice {
  constructor(destination) {
    this.mainOsc = new Tone.Oscillator(55, "sine");
    this.subOsc = new Tone.Oscillator(27.5, "sine");
    this.mainLevel = new Tone.Gain(0.9);
    this.subLevel = new Tone.Gain(0.28);
    this.bodyFilter = new Tone.Filter({ frequency: 155, type: "peaking", Q: 0.8, gain: 0 });
    this.amplitude = new Tone.Gain(0.0001);
    this.filter = new Tone.Filter({ frequency: 360, type: "lowpass", rolloff: -24, Q: 0.7 });
    this.distortion = new Tone.Distortion({ distortion: 0.24, oversample: "2x", wet: 0.36 });
    this.highpass = new Tone.Filter({ frequency: 22, type: "highpass", rolloff: -12, Q: 0.4 });
    this.output = new Tone.Gain(0.78);

    this.mainOsc.chain(this.mainLevel, this.bodyFilter, this.amplitude);
    this.subOsc.connect(this.subLevel);
    this.subLevel.connect(this.amplitude);
    this.amplitude.chain(this.filter, this.distortion, this.highpass, this.output, destination);
    this.mainOsc.start();
    this.subOsc.start();
    this.currentSound = null;
  }

  setSound(sound, ramp = 0.035, startTime = Tone.now()) {
    if (!sound) return;
    const unchanged = this.currentSound
      && Object.keys(sound).every((key) => this.currentSound[key] === sound[key]);
    if (unchanged) return;
    const now = startTime;
    if (!this.currentSound || this.currentSound.wave !== sound.wave) {
      this.mainOsc.type = sound.wave;
    }
    this.subOsc.type = "sine";
    const body = Math.max(0, Math.min(1, sound.body ?? 0.42));
    const drive = Math.max(0, Math.min(0.95, sound.drive));
    const level = Math.max(0.35, Math.min(1.25, sound.level));
    this.mainLevel.gain.rampTo(0.9 + body * 0.5, ramp, now);
    this.bodyFilter.gain.rampTo(body * 9, ramp, now);
    this.subLevel.gain.rampTo(sound.sub, ramp, now);
    this.filter.frequency.rampTo(sound.cutoff, ramp, now);
    this.distortion.distortion = drive;
    this.distortion.wet.rampTo(Math.min(0.82, 0.14 + drive * 0.78 + body * 0.08), ramp, now);
    this.output.gain.rampTo(level * (1 - drive * 0.08), ramp, now);
    this.currentSound = { ...sound };
  }

  trigger(event, time, stepSeconds, sound) {
    if (!event) return;
    this.setSound(sound, 0.02, time);
    const target = Tone.Frequency(event.note).toFrequency();
    const subTarget = target / 2;
    const glideEnd = time + Math.max(0.008, sound.glide);

    this.mainOsc.frequency.cancelAndHoldAtTime(time);
    this.subOsc.frequency.cancelAndHoldAtTime(time);

    if (event.slide) {
      this.mainOsc.frequency.exponentialRampToValueAtTime(target, glideEnd);
      this.subOsc.frequency.exponentialRampToValueAtTime(subTarget, glideEnd);
      this.amplitude.gain.cancelAndHoldAtTime(time);
      this.amplitude.gain.linearRampToValueAtTime(
        Math.max(0.05, event.velocity),
        time + Math.max(0.004, sound.attack),
      );
    } else {
      const pitchRatio = 2 ** (sound.punch / 12);
      this.mainOsc.frequency.setValueAtTime(target * pitchRatio, time);
      this.subOsc.frequency.setValueAtTime(subTarget * Math.min(2, pitchRatio), time);
      this.mainOsc.frequency.exponentialRampToValueAtTime(target, time + sound.pitchDecay);
      this.subOsc.frequency.exponentialRampToValueAtTime(subTarget, time + sound.pitchDecay);

      this.amplitude.gain.cancelAndHoldAtTime(time);
      this.amplitude.gain.setValueAtTime(0.0001, time);
      this.amplitude.gain.linearRampToValueAtTime(
        Math.max(0.05, event.velocity),
        time + Math.max(0.002, sound.attack),
      );
    }

    const eventDuration = Math.max(stepSeconds * event.length, 0.1);
    const audibleDuration = Math.max(0.1, Math.min(eventDuration, sound.decay));
    this.amplitude.gain.exponentialRampToValueAtTime(0.0001, time + audibleDuration);
  }

  silence(time = Tone.now()) {
    this.amplitude.gain.cancelAndHoldAtTime(time);
    this.amplitude.gain.exponentialRampToValueAtTime(0.0001, time + 0.03);
  }

  dispose() {
    this.mainOsc.stop();
    this.subOsc.stop();
    [
      this.mainOsc,
      this.subOsc,
      this.mainLevel,
      this.subLevel,
      this.bodyFilter,
      this.amplitude,
      this.filter,
      this.distortion,
      this.highpass,
      this.output,
    ].forEach((node) => node.dispose());
  }
}

class DrumRack {
  constructor(destination) {
    this.channels = Object.fromEntries(
      DRUM_LANES.map(({ id }) => [id, new Tone.Gain(0.78).connect(destination)]),
    );
    this.channelLevels = Object.fromEntries(DRUM_LANES.map(({ id }) => [id, 0.78]));

    this.kick = new Tone.MembraneSynth({
      pitchDecay: 0.055,
      octaves: 7.5,
      oscillator: { type: "sine" },
      envelope: { attack: 0.001, decay: 0.42, sustain: 0, release: 0.06 },
    }).connect(this.channels.kick);

    this.snareNoise = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.14, sustain: 0, release: 0.03 },
    });
    this.snareFilter = new Tone.Filter({ frequency: 1450, type: "highpass" }).connect(this.channels.snare);
    this.snareNoise.connect(this.snareFilter);
    this.snareBody = new Tone.Synth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.02 },
    }).connect(this.channels.snare);

    this.clap = new Tone.NoiseSynth({
      noise: { type: "pink" },
      envelope: { attack: 0.002, decay: 0.18, sustain: 0, release: 0.04 },
    });
    this.clapFilter = new Tone.Filter({ frequency: 1000, type: "bandpass", Q: 0.7 }).connect(this.channels.clap);
    this.clap.connect(this.clapFilter);

    this.closedHat = new Tone.MetalSynth({
      frequency: 250,
      envelope: { attack: 0.001, decay: 0.045, release: 0.01 },
      harmonicity: 5.1,
      modulationIndex: 32,
      resonance: 5600,
      octaves: 1.4,
    }).connect(this.channels.closedHat);

    this.openHat = new Tone.MetalSynth({
      frequency: 210,
      envelope: { attack: 0.001, decay: 0.34, release: 0.08 },
      harmonicity: 5.1,
      modulationIndex: 28,
      resonance: 4800,
      octaves: 1.8,
    }).connect(this.channels.openHat);

    this.rim = new Tone.Synth({
      oscillator: { type: "square" },
      envelope: { attack: 0.001, decay: 0.028, sustain: 0, release: 0.015 },
    }).connect(this.channels.rim);

    this.lowTom = new Tone.MembraneSynth({
      pitchDecay: 0.035,
      octaves: 3.5,
      oscillator: { type: "sine" },
      envelope: { attack: 0.002, decay: 0.28, sustain: 0, release: 0.05 },
    }).connect(this.channels.lowTom);

    this.midTom = new Tone.MembraneSynth({
      pitchDecay: 0.028,
      octaves: 3,
      oscillator: { type: "sine" },
      envelope: { attack: 0.002, decay: 0.22, sustain: 0, release: 0.045 },
    }).connect(this.channels.midTom);

    this.highTom = new Tone.MembraneSynth({
      pitchDecay: 0.022,
      octaves: 2.4,
      oscillator: { type: "sine" },
      envelope: { attack: 0.002, decay: 0.18, sustain: 0, release: 0.035 },
    }).connect(this.channels.highTom);

    this.cowbellA = new Tone.Synth({
      oscillator: { type: "square" },
      envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.03 },
    }).connect(this.channels.cowbell);
    this.cowbellB = new Tone.Synth({
      oscillator: { type: "square" },
      envelope: { attack: 0.001, decay: 0.075, sustain: 0, release: 0.02 },
    }).connect(this.channels.cowbell);

    this.cymbal = new Tone.MetalSynth({
      frequency: 190,
      envelope: { attack: 0.001, decay: 0.58, release: 0.16 },
      harmonicity: 5.1,
      modulationIndex: 36,
      resonance: 3600,
      octaves: 2.1,
    }).connect(this.channels.cymbal);
  }

  setMuted(muted = {}, settings = {}, time = Tone.now()) {
    DRUM_LANES.forEach(({ id }) => {
      const level = settings[id]?.level ?? 0.78;
      const target = muted[id] ? 0 : level;
      if (this.channelLevels[id] === target) return;
      this.channels[id].gain.rampTo(target, 0.02, time);
      this.channelLevels[id] = target;
    });
  }

  trigger(id, time, velocity = 0.8, settings = {}) {
    const level = dbForVelocity(velocity);
    const tone = settings.tone ?? 0.5;
    const decay = settings.decay ?? 0.5;
    switch (id) {
      case "kick":
        this.kick.pitchDecay = 0.025 + decay * 0.07;
        this.kick.triggerAttackRelease(38 + tone * 20, 0.18 + decay * 0.5, time, level);
        break;
      case "snare":
        this.snareFilter.frequency.setValueAtTime(900 + tone * 2100, time);
        this.snareNoise.triggerAttackRelease(0.08 + decay * 0.18, time, level * 0.76);
        this.snareBody.triggerAttackRelease(170 + tone * 130, 0.05 + decay * 0.07, time, level * 0.36);
        break;
      case "clap":
        this.clapFilter.frequency.setValueAtTime(700 + tone * 1800, time);
        this.clap.triggerAttackRelease(0.08 + decay * 0.24, time, level * 0.72);
        break;
      case "closedHat":
        this.openHat.triggerRelease(time);
        this.closedHat.resonance = 4200 + tone * 3200;
        this.closedHat.triggerAttackRelease(
          235 + tone * 90,
          0.018 + decay * 0.07,
          time,
          level * 0.54,
        );
        break;
      case "openHat":
        this.openHat.resonance = 3600 + tone * 3000;
        this.openHat.triggerAttackRelease(
          190 + tone * 75,
          0.12 + decay * 0.42,
          time,
          level * 0.55,
        );
        break;
      case "rim":
        this.rim.triggerAttackRelease(1200 + tone * 1600, 0.015 + decay * 0.035, time, level * 0.45);
        break;
      case "lowTom":
        this.lowTom.triggerAttackRelease(62 + tone * 72, 0.12 + decay * 0.3, time, level * 0.72);
        break;
      case "midTom":
        this.midTom.triggerAttackRelease(92 + tone * 92, 0.1 + decay * 0.26, time, level * 0.66);
        break;
      case "highTom":
        this.highTom.triggerAttackRelease(145 + tone * 125, 0.08 + decay * 0.22, time, level * 0.62);
        break;
      case "cowbell":
        this.cowbellA.triggerAttackRelease(740 + tone * 240, 0.05 + decay * 0.12, time, level * 0.34);
        this.cowbellB.triggerAttackRelease(1110 + tone * 310, 0.04 + decay * 0.1, time, level * 0.27);
        break;
      case "cymbal":
        this.cymbal.resonance = 2800 + tone * 3200;
        this.cymbal.triggerAttackRelease(
          145 + tone * 95,
          0.22 + decay * 0.62,
          time,
          level * 0.42,
        );
        break;
      default:
        break;
    }
  }

  audition(id, settings) {
    this.trigger(id, Tone.now(), 0.9, settings);
  }

  dispose() {
    [
      ...Object.values(this.channels),
      this.kick,
      this.snareNoise,
      this.snareFilter,
      this.snareBody,
      this.clap,
      this.clapFilter,
      this.closedHat,
      this.openHat,
      this.rim,
      this.lowTom,
      this.midTom,
      this.highTom,
      this.cowbellA,
      this.cowbellB,
      this.cymbal,
    ].forEach((node) => node.dispose());
  }
}

export class AudioEngine {
  constructor() {
    this.initialized = false;
    this.transportEvent = null;
    this.step = 0;
    this.getState = null;
    this.onStep = null;
    this.onLoop = null;
    this.rateId = "16n";
  }

  async initialize() {
    await Tone.start();
    if (this.initialized) return;

    this.input = new Tone.Gain(0.82);
    this.compressor = new Tone.Compressor({ threshold: -14, ratio: 3, attack: 0.008, release: 0.18 });
    this.limiter = new Tone.Limiter(-1.2);
    this.meter = new Tone.Meter({ normalRange: false, smoothing: 0.82 });
    this.input.chain(this.compressor, this.limiter, this.meter, Tone.getDestination());
    this.drums = new DrumRack(this.input);
    this.bass = new BassVoice(this.input);
    this.initialized = true;
  }

  configure({ bpm = 142, swing = 0.12, master = 0.82 } = {}) {
    const transport = Tone.getTransport();
    transport.bpm.rampTo(bpm, 0.04);
    transport.swing = Math.max(0, Math.min(0.65, swing));
    transport.swingSubdivision = this.rateId === "16t"
      ? "8n"
      : this.rateId === "8t"
        ? "4n"
        : "16n";
    if (this.input) this.input.gain.rampTo(master, 0.03);
  }

  schedule(rateId) {
    const transport = Tone.getTransport();
    if (this.transportEvent !== null) transport.clear(this.transportEvent);
    this.rateId = rateId;
    const subdivision = getRate(rateId).tone;
    transport.swingSubdivision = rateId === "16t"
      ? "8n"
      : rateId === "8t"
        ? "4n"
        : "16n";
    this.transportEvent = transport.scheduleRepeat((time) => {
      const state = this.getState?.();
      if (!state) return;
      const activeLength = Math.max(1, state.length);
      if (this.step >= activeLength) this.step = 0;
      const currentStep = this.step;

      this.drums.setMuted(state.muted, state.drumSettings, time);
      DRUM_LANES.forEach(({ id }) => {
        const velocity = state.drums[id]?.[currentStep];
        if (velocity && !state.muted?.[id]) {
          this.drums.trigger(id, time, velocity, state.drumSettings?.[id]);
        }
      });

      const bassEvent = state.bass[currentStep];
      if (bassEvent && !state.bassMuted) {
        const stepSeconds = Tone.Time(subdivision).toSeconds();
        this.bass.trigger(bassEvent, time, stepSeconds, state.bassSound);
      }

      Tone.getDraw().schedule(() => this.onStep?.(currentStep), time);
      this.step = (currentStep + 1) % activeLength;
      if (this.step === 0) Tone.getDraw().schedule(() => this.onLoop?.(), time);
    }, subdivision);
  }

  async start({ rateId, getState, onStep, onLoop, bpm, swing, master }) {
    await this.initialize();
    this.getState = getState;
    this.onStep = onStep;
    this.onLoop = onLoop;
    this.bass.setSound(getState()?.bassSound, 0.01);
    this.step = 0;
    this.schedule(rateId);
    this.configure({ bpm, swing, master });
    const transport = Tone.getTransport();
    transport.stop();
    transport.position = 0;
    transport.start("+0.05");
  }

  async resume() {
    await this.initialize();
    Tone.getTransport().start("+0.03");
  }

  pause() {
    Tone.getTransport().pause();
    this.bass?.silence();
  }

  stop() {
    const transport = Tone.getTransport();
    Tone.getDraw().cancel(Tone.now());
    transport.stop();
    transport.position = 0;
    this.step = 0;
    this.bass?.silence();
    this.onStep?.(-1);
  }

  async changeRate(rateId, shouldResume = true) {
    if (!this.initialized) {
      this.rateId = rateId;
      return;
    }
    const transport = Tone.getTransport();
    const wasRunning = transport.state === "started";
    transport.stop();
    transport.position = 0;
    this.step = 0;
    this.schedule(rateId);
    if (shouldResume && wasRunning) transport.start("+0.03");
  }

  setBassSound(sound) {
    this.bass?.setSound(sound);
  }

  setMaster(level) {
    this.input?.gain.rampTo(level, 0.03);
  }

  async auditionDrum(id, settings) {
    await this.initialize();
    this.drums.audition(id, settings);
  }

  async auditionBass(note, sound) {
    await this.initialize();
    this.bass.trigger(
      { note, velocity: 0.86, length: 1, slide: false },
      Tone.now(),
      Math.max(0.18, sound.decay * 0.65),
      sound,
    );
  }

  getLevel() {
    if (!this.meter) return -60;
    const value = this.meter.getValue();
    return Array.isArray(value) ? Math.max(...value) : value;
  }

  dispose() {
    const transport = Tone.getTransport();
    if (this.transportEvent !== null) transport.clear(this.transportEvent);
    this.stop();
    this.drums?.dispose();
    this.bass?.dispose();
    [this.input, this.compressor, this.limiter, this.meter]
      .filter(Boolean)
      .forEach((node) => node.dispose());
    this.initialized = false;
  }
}
