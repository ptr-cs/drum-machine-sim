import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AudioEngine } from "./audioEngine.js";
import {
  bassSummary,
  generateBassPattern,
  generateBassSound,
  generateDrumPattern,
  nextSeed,
} from "./generator.js";
import {
  DEFAULT_BASS_SOUND,
  DEFAULT_DRUM_SETTINGS,
  DRUM_LANES,
  NOTE_NAMES,
  PATTERN_LENGTHS,
  SCALES,
  STEP_RATES,
  TOTAL_STEPS,
  getRootMidi,
  midiToNote,
  noteToMidi,
  phraseLengthLabel,
  stepGroupSize,
} from "./music.js";
import { downloadMidiFile } from "./midiExport.js";
import "./styles.css";

const STORAGE_KEY = "808-drill-lab:v1";

function cloneDrumSettings() {
  return Object.fromEntries(
    Object.entries(DEFAULT_DRUM_SETTINGS).map(([id, settings]) => [id, { ...settings }]),
  );
}

function createStarterProject() {
  const seed = "BX-NIGHT-01";
  const drums = generateDrumPattern({
    seed,
    rateId: "16n",
    length: 64,
    energy: 0.7,
    variation: 0.56,
  });
  const bass = generateBassPattern({
    seed,
    drums,
    root: "F#",
    scale: "minor",
    rateId: "16n",
    length: 64,
    energy: 0.7,
    slides: 0.56,
  });
  return {
    version: 1,
    seed,
    bpm: 142,
    swing: 0.1,
    master: 0.74,
    rateId: "16n",
    length: 64,
    root: "F#",
    scale: "minor",
    energy: 0.7,
    variation: 0.56,
    slides: 0.56,
    drums,
    bass,
    bassSound: generateBassSound({ seed, energy: 0.7, pattern: bass, length: 64 }),
    drumSettings: cloneDrumSettings(),
    muted: Object.fromEntries(DRUM_LANES.map(({ id }) => [id, false])),
    bassMuted: false,
  };
}

function loadProject() {
  const fallback = createStarterProject();
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!stored || stored.version !== 1) return fallback;
    return {
      ...fallback,
      ...stored,
      drums: { ...fallback.drums, ...stored.drums },
      drumSettings: Object.fromEntries(
        DRUM_LANES.map(({ id }) => [
          id,
          { ...fallback.drumSettings[id], ...stored.drumSettings?.[id] },
        ]),
      ),
      muted: { ...fallback.muted, ...stored.muted },
    };
  } catch {
    return fallback;
  }
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function Icon({ name, size = 18 }) {
  const props = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };
  if (name === "play") {
    return <svg {...props} fill="currentColor" stroke="none"><path d="M7.5 5.2v13.6L18.8 12 7.5 5.2Z" /></svg>;
  }
  if (name === "pause") {
    return <svg {...props} fill="currentColor" stroke="none"><path d="M6.8 5h3.6v14H6.8zM13.6 5h3.6v14h-3.6z" /></svg>;
  }
  if (name === "stop") {
    return <svg {...props} fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="1.5" /></svg>;
  }
  if (name === "dice") {
    return <svg {...props}><rect x="3.5" y="3.5" width="17" height="17" rx="3" /><circle cx="8" cy="8" r=".8" fill="currentColor" /><circle cx="16" cy="8" r=".8" fill="currentColor" /><circle cx="12" cy="12" r=".8" fill="currentColor" /><circle cx="8" cy="16" r=".8" fill="currentColor" /><circle cx="16" cy="16" r=".8" fill="currentColor" /></svg>;
  }
  if (name === "volume") {
    return <svg {...props}><path d="M4 10v4h4l5 4V6L8 10H4Z" /><path d="M16 9c1.5 1.6 1.5 4.4 0 6M18.5 6.5c3 3 3 8 0 11" /></svg>;
  }
  if (name === "undo") {
    return <svg {...props}><path d="m9 8-4 4 4 4" /><path d="M5 12h8a6 6 0 0 1 6 6" /></svg>;
  }
  if (name === "download") {
    return <svg {...props}><path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M5 20h14" /></svg>;
  }
  if (name === "upload") {
    return <svg {...props}><path d="M12 16V4m0 0 4 4m-4-4L8 8" /><path d="M5 20h14" /></svg>;
  }
  return null;
}

function Knob({ label, value, min = 0, max = 1, step = 0.01, onChange, format, accent = "amber" }) {
  const ratio = (value - min) / (max - min);
  const degrees = -135 + clamp(ratio, 0, 1) * 270;
  const display = format ? format(value) : value;
  return (
    <label className={`knob-control knob-${accent}`}>
      <span className="knob-label">{label}</span>
      <span className="knob-shell" style={{ "--knob-angle": `${degrees}deg` }}>
        <span className="knob-ticks" />
        <span className="knob-cap"><span className="knob-pointer" /></span>
        <input
          aria-label={label}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </span>
      <span className="knob-value">{display}</span>
    </label>
  );
}

function Meter({ level }) {
  const normalized = clamp((level + 54) / 54, 0, 1);
  return (
    <div className="output-meter" aria-label={`Output ${Math.round(level)} decibels`}>
      {Array.from({ length: 9 }, (_, index) => (
        <span key={index} className={normalized * 9 > index ? "lit" : ""} />
      ))}
    </div>
  );
}

function MiniOverview({ project, playhead, bank, setBank }) {
  const drumActivity = useMemo(
    () => Array.from({ length: TOTAL_STEPS }, (_, step) =>
      DRUM_LANES.some(({ id }) => Boolean(project.drums[id]?.[step]))),
    [project.drums],
  );
  return (
    <div className="overview-wrap">
      <div className="overview-labels">
        <span>64-step map</span>
        <span>{phraseLengthLabel(project.length, project.rateId)} · {project.length} active</span>
      </div>
      <div className="overview-grid" role="group" aria-label="64-step pattern overview">
        {Array.from({ length: TOTAL_STEPS }, (_, step) => {
          const hasDrums = drumActivity[step];
          const hasBass = Boolean(project.bass[step]);
          return (
            <button
              key={step}
              type="button"
              aria-label={`Show step ${step + 1}`}
              disabled={step >= project.length}
              onClick={() => setBank(Math.floor(step / 16))}
              className={[
                "overview-step",
                hasDrums ? "has-drums" : "",
                hasBass ? "has-bass" : "",
                playhead === step ? "is-playing" : "",
                Math.floor(step / 16) === bank ? "in-bank" : "",
              ].filter(Boolean).join(" ")}
            >
              <span />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BankSelector({ bank, setBank, length }) {
  return (
    <div className="bank-selector" role="group" aria-label="Step bank">
      {[0, 1, 2, 3].map((value) => (
        <button
          type="button"
          key={value}
          className={bank === value ? "active" : ""}
          disabled={value * 16 >= length}
          onClick={() => setBank(value)}
        >
          <b>{String.fromCharCode(65 + value)}</b>
          <span>{String(value * 16 + 1).padStart(2, "0")}–{String(value * 16 + 16).padStart(2, "0")}</span>
        </button>
      ))}
    </div>
  );
}

function StepHeader({ bank, rateId, length }) {
  const group = stepGroupSize(rateId);
  return (
    <div className="step-header" aria-hidden="true">
      <span className="row-spacer">voice</span>
      {Array.from({ length: 16 }, (_, local) => {
        const absolute = bank * 16 + local;
        return (
          <span
            key={absolute}
            className={`${absolute % group === 0 ? "group-start" : ""} ${absolute >= length ? "disabled" : ""}`}
          >
            {absolute + 1}
          </span>
        );
      })}
    </div>
  );
}

function DrumGrid({ project, bank, playhead, selectedLane, onSelectLane, onToggleStep, onToggleMute, onAudition }) {
  const group = stepGroupSize(project.rateId);
  return (
    <div className="drum-grid" role="grid" aria-label="Drum sequencer">
      <StepHeader bank={bank} rateId={project.rateId} length={project.length} />
      {DRUM_LANES.map((lane) => (
        <div className={`drum-row ${selectedLane === lane.id ? "selected" : ""}`} role="row" key={lane.id}>
          <div className="lane-label" role="rowheader">
            <button
              className="audition-button"
              type="button"
              aria-label={`Audition ${lane.name}`}
              onClick={() => onAudition(lane.id)}
            >
              <span>{lane.short}</span>
            </button>
            <button className="lane-name" type="button" onClick={() => onSelectLane(lane.id)}>
              {lane.name}
            </button>
            <button
              className={`mute-button ${project.muted[lane.id] ? "active" : ""}`}
              type="button"
              aria-pressed={project.muted[lane.id]}
              onClick={() => onToggleMute(lane.id)}
            >M</button>
          </div>
          {Array.from({ length: 16 }, (_, local) => {
            const step = bank * 16 + local;
            const velocity = project.drums[lane.id]?.[step] ?? 0;
            const state = velocity >= 0.9 ? "accent" : velocity > 0 && velocity < 0.55 ? "ghost" : velocity > 0 ? "active" : "";
            return (
              <button
                key={step}
                type="button"
                role="gridcell"
                aria-label={`${lane.name}, step ${step + 1}${velocity ? `, velocity ${Math.round(velocity * 100)}` : ", off"}`}
                aria-pressed={Boolean(velocity)}
                disabled={step >= project.length}
                title="Click to toggle · Shift-click to cycle velocity"
                onClick={(event) => onToggleStep(lane.id, step, event.shiftKey)}
                className={[
                  "step-pad",
                  state,
                  step % group === 0 ? "group-start" : "",
                  playhead === step ? "is-playing" : "",
                ].filter(Boolean).join(" ")}
              >
                <span className="pad-light" />
                {state === "accent" && <span className="accent-mark">+</span>}
                {state === "ghost" && <span className="ghost-mark">·</span>}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function BassGrid({ project, bank, playhead, selectedStep, onSelectStep, onDeleteStep }) {
  const group = stepGroupSize(project.rateId);
  return (
    <div className="bass-grid" role="grid" aria-label="808 bass sequencer">
      <StepHeader bank={bank} rateId={project.rateId} length={project.length} />
      <div className="bass-row" role="row">
        <div className="bass-row-label" role="rowheader">
          <span className="bass-wave">∿</span>
          <div><b>SUB</b><small>mono / glide</small></div>
        </div>
        {Array.from({ length: 16 }, (_, local) => {
          const step = bank * 16 + local;
          const event = project.bass[step];
          return (
            <button
              key={step}
              type="button"
              role="gridcell"
              disabled={step >= project.length}
              aria-pressed={Boolean(event)}
              aria-label={event
                ? `Bass step ${step + 1}, ${event.note}, velocity ${Math.round(event.velocity * 100)}${event.slide ? ", slide" : ""}`
                : `Bass step ${step + 1}, empty`}
              title={event ? "Click to edit · Double-click to clear" : "Click to add the root note"}
              onClick={() => onSelectStep(step)}
              onDoubleClick={() => onDeleteStep(step)}
              className={[
                "bass-step",
                event ? "active" : "",
                event?.slide ? "slide" : "",
                selectedStep === step ? "selected" : "",
                step % group === 0 ? "group-start" : "",
                playhead === step ? "is-playing" : "",
              ].filter(Boolean).join(" ")}
            >
              <span className="bass-step-number">{String(step + 1).padStart(2, "0")}</span>
              {event ? (
                <>
                  <strong>{event.note}</strong>
                  <span className="velocity-bar" style={{ "--velocity": event.velocity }} />
                  <small>{event.length}×{event.slide ? " ↗" : ""}</small>
                </>
              ) : <span className="empty-note">—</span>}
            </button>
          );
        })}
      </div>
      <p className="grid-hint">Click an empty step to add the root · Double-click a note to clear it</p>
    </div>
  );
}

function VoiceBay({ project, selectedLane, onParam, onAudition }) {
  const lane = DRUM_LANES.find((item) => item.id === selectedLane) ?? DRUM_LANES[0];
  const settings = project.drumSettings[lane.id];
  return (
    <aside className="bay voice-bay">
      <div className="bay-kicker">voice circuit</div>
      <div className="voice-title">
        <button type="button" className="voice-audition" onClick={() => onAudition(lane.id)}>
          {lane.short}
        </button>
        <div><strong>{lane.name}</strong><span>analog model</span></div>
      </div>
      <div className="knob-rack three">
        <Knob label="Level" value={settings.level} onChange={(value) => onParam(lane.id, "level", value)} format={(value) => `${Math.round(value * 100)}`} />
        <Knob label="Tone" value={settings.tone} onChange={(value) => onParam(lane.id, "tone", value)} format={(value) => `${Math.round(value * 100)}`} />
        <Knob label="Decay" value={settings.decay} onChange={(value) => onParam(lane.id, "decay", value)} format={(value) => `${Math.round(value * 100)}`} />
      </div>
      <p className="bay-note">Select any lane beside the grid, then shape and audition its synthesized voice here.</p>
    </aside>
  );
}

function DrumGeneratorBay({ project, onGenerate, onUpdate, canUndo, onUndo }) {
  return (
    <aside className="bay generator-bay">
      <div className="bay-kicker">pattern architect</div>
      <h3>Drill drums</h3>
      <p>Half-time backbeat, syncopated kick grammar, hat motion, and controlled turnarounds.</p>
      <Knob label="Energy" value={project.energy} onChange={(value) => onUpdate("energy", value)} format={(value) => `${Math.round(value * 100)}%`} />
      <Knob label="Variation" value={project.variation} onChange={(value) => onUpdate("variation", value)} format={(value) => `${Math.round(value * 100)}%`} />
      <button className="generate-button primary" type="button" onClick={onGenerate}>
        <Icon name="dice" />
        <span><b>Generate drums</b><small>new full 64-step phrase</small></span>
      </button>
      <button className="undo-button" type="button" disabled={!canUndo} onClick={onUndo}>
        <Icon name="undo" size={16} /> Undo last generation
      </button>
    </aside>
  );
}

function BassSoundBay({ project, onParam, onWave, onAudition }) {
  const sound = project.bassSound;
  return (
    <aside className="bay bass-sound-bay">
      <div className="bay-kicker">bass circuit</div>
      <div className="sound-title-line"><h3>808 voice</h3><span>{sound.archetype ?? sound.wave}</span></div>
      <div className="wave-switch" role="group" aria-label="Oscillator wave">
        {["sine", "triangle"].map((wave) => (
          <button type="button" key={wave} className={sound.wave === wave ? "active" : ""} onClick={() => onWave(wave)}>{wave}</button>
        ))}
      </div>
      <div className="knob-rack four bass-knobs">
        <Knob accent="blue" label="Decay" value={sound.decay} min={0.25} max={1.8} step={0.01} onChange={(value) => onParam("decay", value)} format={(value) => `${value.toFixed(2)}s`} />
        <Knob accent="blue" label="Glide" value={sound.glide} min={0.02} max={0.24} step={0.005} onChange={(value) => onParam("glide", value)} format={(value) => `${Math.round(value * 1000)}ms`} />
        <Knob accent="blue" label="Punch" value={sound.punch} min={8} max={36} step={1} onChange={(value) => onParam("punch", value)} format={(value) => `${Math.round(value)}st`} />
        <Knob accent="blue" label="Tone" value={sound.cutoff} min={120} max={900} step={5} onChange={(value) => onParam("cutoff", value)} format={(value) => `${Math.round(value)}Hz`} />
        <Knob accent="blue" label="Drive" value={sound.drive} min={0} max={0.7} onChange={(value) => onParam("drive", value)} format={(value) => `${Math.round(value * 100)}%`} />
        <Knob accent="blue" label="Sub" value={sound.sub} min={0} max={0.58} onChange={(value) => onParam("sub", value)} format={(value) => `${Math.round(value * 100)}%`} />
        <Knob accent="blue" label="Attack" value={sound.attack} min={0.002} max={0.025} step={0.001} onChange={(value) => onParam("attack", value)} format={(value) => `${Math.round(value * 1000)}ms`} />
        <Knob accent="blue" label="Level" value={sound.level} min={0.35} max={0.95} onChange={(value) => onParam("level", value)} format={(value) => `${Math.round(value * 100)}`} />
      </div>
      <button className="audition-wide" type="button" onClick={onAudition}>Hold test note <b>{midiToNote(getRootMidi(project.root))}</b></button>
    </aside>
  );
}

function BassGeneratorBay({ project, summary, onGeneratePattern, onGenerateSound, onGenerateBoth, onUpdate, canUndo, onUndo }) {
  return (
    <aside className="bay generator-bay bass-generator">
      <div className="bay-kicker">generative controls</div>
      <h3>Bass designer</h3>
      <div className="generator-stats">
        <span><b>{summary.events}</b> notes</span>
        <span><b>{summary.slides}</b> slides</span>
        <span><b>{summary.range}</b> range</span>
      </div>
      <div className="mini-control">
        <label htmlFor="slides-control">Slide amount</label>
        <output>{Math.round(project.slides * 100)}%</output>
        <input id="slides-control" type="range" min="0" max="1" step="0.01" value={project.slides} onChange={(event) => onUpdate("slides", Number(event.target.value))} />
      </div>
      <div className="bass-generate-stack">
        <button className="generate-button" type="button" onClick={onGeneratePattern}>
          <Icon name="dice" /><span><b>Generate pattern</b><small>keep this bass sound</small></span>
        </button>
        <button className="generate-button" type="button" onClick={onGenerateSound}>
          <Icon name="dice" /><span><b>Generate sound</b><small>keep these notes</small></span>
        </button>
        <button className="generate-button primary" type="button" onClick={onGenerateBoth}>
          <Icon name="dice" /><span><b>Generate both</b><small>new pattern + voice</small></span>
        </button>
      </div>
      <button className="undo-button" type="button" disabled={!canUndo} onClick={onUndo}>
        <Icon name="undo" size={16} /> Undo last generation
      </button>
    </aside>
  );
}

function BassStepInspector({ event, step, onChange, onDelete, onAudition }) {
  if (step === null || !event) {
    return (
      <div className="step-inspector empty">
        <span className="inspector-index">STEP —</span>
        <p>Select a bass note to edit pitch, gate, velocity, and glide.</p>
      </div>
    );
  }
  const noteOptions = Array.from({ length: 33 }, (_, index) => midiToNote(24 + index));
  return (
    <div className="step-inspector">
      <div className="inspector-heading">
        <span className="inspector-index">STEP {String(step + 1).padStart(2, "0")}</span>
        <button type="button" onClick={() => onAudition(event.note)} className="note-audition">▶ {event.note}</button>
      </div>
      <div className="inspector-fields">
        <label>Pitch<select value={event.note} onChange={(e) => onChange("note", e.target.value)}>{noteOptions.map((note) => <option key={note}>{note}</option>)}</select></label>
        <label>Gate<output>{event.length} steps</output><input type="range" min="1" max="16" value={event.length} onChange={(e) => onChange("length", Number(e.target.value))} /></label>
        <label>Velocity<output>{Math.round(event.velocity * 100)}%</output><input type="range" min="0.35" max="1" step="0.01" value={event.velocity} onChange={(e) => onChange("velocity", Number(e.target.value))} /></label>
        <label className="slide-toggle"><input type="checkbox" checked={event.slide} onChange={(e) => onChange("slide", e.target.checked)} /><span>Glide into this note</span></label>
      </div>
      <button className="delete-step" type="button" onClick={onDelete}>Clear note</button>
    </div>
  );
}

function App() {
  const [project, setProject] = useState(loadProject);
  const [workspace, setWorkspace] = useState(
    () => new URLSearchParams(window.location.search).get("view") === "bass" ? "bass" : "drums",
  );
  const [bank, setBank] = useState(0);
  const [follow, setFollow] = useState(true);
  const [playhead, setPlayhead] = useState(-1);
  const [transportState, setTransportState] = useState("stopped");
  const [selectedLane, setSelectedLane] = useState("kick");
  const [selectedBassStep, setSelectedBassStep] = useState(null);
  const [undoSnapshot, setUndoSnapshot] = useState(null);
  const [meterLevel, setMeterLevel] = useState(-60);
  const [audioError, setAudioError] = useState("");
  const [tapTimes, setTapTimes] = useState([]);
  const engineRef = useRef(null);
  const projectRef = useRef(project);
  const importRef = useRef(null);
  const followRef = useRef(follow);
  projectRef.current = project;
  followRef.current = follow;

  if (!engineRef.current) engineRef.current = new AudioEngine();

  useEffect(() => () => engineRef.current?.dispose(), []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [project]);

  useEffect(() => {
    const maxBank = Math.max(0, Math.floor((project.length - 1) / 16));
    if (bank > maxBank) setBank(maxBank);
  }, [project.length, bank]);

  useEffect(() => {
    if (!engineRef.current.initialized) return;
    engineRef.current.configure({ bpm: project.bpm, swing: project.swing, master: project.master });
  }, [project.bpm, project.swing, project.master]);

  useEffect(() => {
    if (!engineRef.current.initialized) return;
    engineRef.current.setBassSound(project.bassSound);
  }, [project.bassSound]);

  const previousRate = useRef(project.rateId);
  useEffect(() => {
    if (previousRate.current === project.rateId) return;
    previousRate.current = project.rateId;
    if (engineRef.current.initialized) {
      engineRef.current.changeRate(project.rateId, transportState === "playing").catch(() => {});
      setPlayhead(-1);
    }
  }, [project.rateId, transportState]);

  useEffect(() => {
    if (transportState !== "playing") {
      setMeterLevel(-60);
      return undefined;
    }
    let frame;
    let last = 0;
    const readMeter = (timestamp) => {
      if (timestamp - last > 55) {
        const level = engineRef.current.getLevel();
        setMeterLevel(Number.isFinite(level) ? level : -60);
        last = timestamp;
      }
      frame = requestAnimationFrame(readMeter);
    };
    frame = requestAnimationFrame(readMeter);
    return () => cancelAnimationFrame(frame);
  }, [transportState]);

  const handlePlay = async () => {
    try {
      setAudioError("");
      if (transportState === "playing") {
        engineRef.current.pause();
        setTransportState("paused");
        return;
      }
      if (transportState === "paused") {
        await engineRef.current.resume();
        setTransportState("playing");
        return;
      }
      await engineRef.current.start({
        rateId: project.rateId,
        getState: () => projectRef.current,
        onStep: (step) => {
          setPlayhead(step);
          if (followRef.current) setBank(Math.floor(step / 16));
        },
        onLoop: () => {},
        bpm: project.bpm,
        swing: project.swing,
        master: project.master,
      });
      setTransportState("playing");
    } catch (error) {
      setAudioError(error instanceof Error ? error.message : "Audio could not start.");
    }
  };

  const handleStop = () => {
    engineRef.current.stop();
    setTransportState("stopped");
    setPlayhead(-1);
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLButtonElement || target instanceof HTMLTextAreaElement) return;
      if (event.code === "Space") {
        event.preventDefault();
        handlePlay();
      }
      if (event.key === "1") setWorkspace("drums");
      if (event.key === "2") setWorkspace("bass");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const updateProject = (key, value) => setProject((current) => ({ ...current, [key]: value }));

  const captureUndo = () => {
    setUndoSnapshot({
      drums: project.drums,
      bass: project.bass,
      bassSound: project.bassSound,
      seed: project.seed,
    });
  };

  const makeSeed = (scope) => nextSeed(`${project.seed}:${scope}`);

  const generateDrums = () => {
    captureUndo();
    const seed = makeSeed("drums");
    const drums = generateDrumPattern({
      seed,
      rateId: project.rateId,
      length: project.length,
      energy: project.energy,
      variation: project.variation,
    });
    setProject((current) => ({ ...current, seed, drums }));
  };

  const generatePattern = () => {
    captureUndo();
    const seed = makeSeed("bass-pattern");
    const bass = generateBassPattern({
      seed,
      drums: project.drums,
      root: project.root,
      scale: project.scale,
      rateId: project.rateId,
      length: project.length,
      energy: project.energy,
      slides: project.slides,
    });
    setProject((current) => ({ ...current, seed, bass }));
  };

  const generateSound = () => {
    captureUndo();
    const seed = makeSeed("bass-sound");
    const bassSound = generateBassSound({
      seed,
      energy: project.energy,
      pattern: project.bass,
      length: project.length,
    });
    setProject((current) => ({ ...current, seed, bassSound }));
  };

  const generateBoth = () => {
    captureUndo();
    const seed = makeSeed("bass-both");
    const bass = generateBassPattern({
      seed,
      drums: project.drums,
      root: project.root,
      scale: project.scale,
      rateId: project.rateId,
      length: project.length,
      energy: project.energy,
      slides: project.slides,
    });
    const bassSound = generateBassSound({
      seed,
      energy: project.energy,
      pattern: bass,
      length: project.length,
    });
    setProject((current) => ({ ...current, seed, bass, bassSound }));
  };

  const generateGroove = () => {
    captureUndo();
    const seed = makeSeed("full-groove");
    const drums = generateDrumPattern({
      seed,
      rateId: project.rateId,
      length: project.length,
      energy: project.energy,
      variation: project.variation,
    });
    const bass = generateBassPattern({
      seed,
      drums,
      root: project.root,
      scale: project.scale,
      rateId: project.rateId,
      length: project.length,
      energy: project.energy,
      slides: project.slides,
    });
    const bassSound = generateBassSound({
      seed,
      energy: project.energy,
      pattern: bass,
      length: project.length,
    });
    setProject((current) => ({ ...current, seed, drums, bass, bassSound }));
  };

  const undoGeneration = () => {
    if (!undoSnapshot) return;
    const redo = {
      drums: project.drums,
      bass: project.bass,
      bassSound: project.bassSound,
      seed: project.seed,
    };
    setProject((current) => ({ ...current, ...undoSnapshot }));
    setUndoSnapshot(redo);
  };

  const toggleDrumStep = (lane, step, cycleVelocity) => {
    setProject((current) => {
      const previous = current.drums[lane][step];
      let next = previous ? 0 : 0.78;
      if (cycleVelocity) {
        if (!previous) next = 0.42;
        else if (previous < 0.55) next = 0.78;
        else if (previous < 0.9) next = 1;
        else next = 0;
      }
      const lanePattern = [...current.drums[lane]];
      lanePattern[step] = next;
      return { ...current, drums: { ...current.drums, [lane]: lanePattern } };
    });
  };

  const toggleMute = (lane) => {
    setProject((current) => ({
      ...current,
      muted: { ...current.muted, [lane]: !current.muted[lane] },
    }));
  };

  const setDrumParam = (lane, key, value) => {
    setProject((current) => ({
      ...current,
      drumSettings: {
        ...current.drumSettings,
        [lane]: { ...current.drumSettings[lane], [key]: value },
      },
    }));
  };

  const auditionDrum = async (lane) => {
    setSelectedLane(lane);
    try {
      await engineRef.current.auditionDrum(lane, project.drumSettings[lane]);
    } catch {
      setAudioError("Click Play once to unlock audio, then audition the voice.");
    }
  };

  const selectBassStep = (step) => {
    setSelectedBassStep(step);
    if (project.bass[step]) return;
    const midi = getRootMidi(project.root);
    setProject((current) => {
      const bass = [...current.bass];
      bass[step] = { note: midiToNote(midi), midi, velocity: 0.82, length: 2, slide: false };
      return { ...current, bass };
    });
  };

  const deleteBassStep = (step = selectedBassStep) => {
    if (step === null) return;
    setProject((current) => {
      const bass = [...current.bass];
      bass[step] = null;
      return { ...current, bass };
    });
  };

  const changeBassEvent = (key, value) => {
    if (selectedBassStep === null) return;
    setProject((current) => {
      const event = current.bass[selectedBassStep];
      if (!event) return current;
      const bass = [...current.bass];
      bass[selectedBassStep] = {
        ...event,
        [key]: value,
        ...(key === "note" ? { midi: noteToMidi(value) } : {}),
      };
      return { ...current, bass };
    });
  };

  const setBassParam = (key, value) => {
    setProject((current) => ({ ...current, bassSound: { ...current.bassSound, [key]: value } }));
  };

  const auditionBass = async (note = midiToNote(getRootMidi(project.root))) => {
    try {
      await engineRef.current.auditionBass(note, project.bassSound);
    } catch {
      setAudioError("Click Play once to unlock audio, then audition the bass.");
    }
  };

  const tapTempo = () => {
    const now = performance.now();
    const recent = [...tapTimes.filter((time) => now - time < 2400), now].slice(-5);
    setTapTimes(recent);
    if (recent.length > 1) {
      const intervals = recent.slice(1).map((time, index) => time - recent[index]);
      const average = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
      updateProject("bpm", clamp(Math.round(60000 / average), 70, 190));
    }
  };

  const exportProject = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `808-drill-${project.seed.toLowerCase()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importProject = async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed.drums || !parsed.bass || !parsed.bassSound) throw new Error("Not an 808 Drill Lab file.");
      const fallback = createStarterProject();
      setProject({ ...fallback, ...parsed, version: 1 });
      setPlayhead(-1);
      setAudioError("");
    } catch (error) {
      setAudioError(error instanceof Error ? error.message : "Could not import that pattern.");
    } finally {
      event.target.value = "";
    }
  };

  const summary = bassSummary(project.bass, project.length);
  const selectedEvent = selectedBassStep === null ? null : project.bass[selectedBassStep];

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark"><span>8</span><span>0</span><span>8</span></div>
          <div><h1>Drill Lab</h1><p>bass + rhythm synthesizer</p></div>
          <span className="local-badge">LOCAL</span>
        </div>

        <div className="transport-block">
          <button className={`play-button ${transportState === "playing" ? "playing" : ""}`} type="button" onClick={handlePlay} aria-label={transportState === "playing" ? "Pause" : "Play"}>
            <Icon name={transportState === "playing" ? "pause" : "play"} size={20} />
          </button>
          <button className="stop-button" type="button" onClick={handleStop} aria-label="Stop and reset"><Icon name="stop" size={16} /></button>
          <div className="tempo-control">
            <label htmlFor="bpm">BPM</label>
            <input id="bpm" type="number" min="70" max="190" value={project.bpm} onChange={(e) => updateProject("bpm", clamp(Number(e.target.value), 70, 190))} />
            <button type="button" onClick={tapTempo}>TAP</button>
          </div>
          <Meter level={meterLevel} />
        </div>

        <div className="workspace-tabs" role="tablist" aria-label="Instrument workspace">
          <button role="tab" aria-selected={workspace === "drums"} className={workspace === "drums" ? "active" : ""} onClick={() => setWorkspace("drums")}><span>01</span> Percussion</button>
          <button role="tab" aria-selected={workspace === "bass"} className={workspace === "bass" ? "active" : ""} onClick={() => setWorkspace("bass")}><span>02</span> 808 Bass</button>
        </div>

        <div className="file-actions">
          <button type="button" onClick={exportProject} title="Export pattern"><Icon name="download" size={16} /> Export</button>
          <button type="button" onClick={() => importRef.current?.click()} title="Import pattern"><Icon name="upload" size={16} /> Import</button>
          <input ref={importRef} type="file" accept="application/json" onChange={importProject} hidden />
        </div>
      </header>

      <section className="control-rail" aria-label="Pattern settings">
        <div className="global-actions">
          <button className="global-generate" type="button" onClick={generateGroove} title="Generate drums, bass pattern, and bass sound">
            <Icon name="dice" size={20} />
            <span><b>Generate groove</b><small>drums + bass</small></span>
          </button>
          <button className="midi-export" type="button" onClick={() => downloadMidiFile(project)} title="Export separate drum and bass MIDI tracks">
            <Icon name="download" size={17} />
            <span><b>MIDI</b><small>3-track .mid</small></span>
          </button>
        </div>
        <div className="rail-section genre-section"><span className="rail-label">Style</span><strong>BRONX DRILL</strong><i>v1</i></div>
        <label className="rail-field"><span>Root</span><select value={project.root} onChange={(e) => updateProject("root", e.target.value)}>{NOTE_NAMES.map((note) => <option key={note}>{note}</option>)}</select></label>
        <label className="rail-field scale-field"><span>Scale</span><select value={project.scale} onChange={(e) => updateProject("scale", e.target.value)}>{Object.entries(SCALES).map(([id, scale]) => <option key={id} value={id}>{scale.label}</option>)}</select></label>
        <label className="rail-field"><span>Step rate</span><select value={project.rateId} onChange={(e) => updateProject("rateId", e.target.value)}>{STEP_RATES.map((rate) => <option key={rate.id} value={rate.id}>{rate.label}</option>)}</select></label>
        <label className="rail-field"><span>Length</span><select value={project.length} onChange={(e) => updateProject("length", Number(e.target.value))}>{PATTERN_LENGTHS.map((length) => <option key={length} value={length}>{length} steps</option>)}</select></label>
        <label className="rail-slider"><span>Swing <output>{Math.round(project.swing * 100)}%</output></span><input type="range" min="0" max="0.5" step="0.01" value={project.swing} onChange={(e) => updateProject("swing", Number(e.target.value))} /></label>
        <label className="rail-slider"><span>Master <output>{Math.round(project.master * 100)}</output></span><input type="range" min="0" max="0.95" step="0.01" value={project.master} onChange={(e) => updateProject("master", Number(e.target.value))} /></label>
        <label className="seed-field"><span>Seed</span><input value={project.seed} maxLength="18" onChange={(e) => updateProject("seed", e.target.value.toUpperCase())} /></label>
      </section>

      {audioError && <div className="error-banner" role="alert"><b>Audio:</b> {audioError}<button onClick={() => setAudioError("")} aria-label="Dismiss">×</button></div>}

      <main>
        <section className="timeline-chassis">
          <div className="timeline-topline">
            <MiniOverview project={{ ...project, follow }} playhead={playhead} bank={bank} setBank={setBank} />
            <div className="follow-control">
              <button className={follow ? "active" : ""} type="button" aria-pressed={follow} onClick={() => setFollow((value) => !value)}><span className="status-dot" /> Follow</button>
              <span>Space: play · 1/2: switch</span>
            </div>
          </div>
          <BankSelector bank={bank} setBank={setBank} length={project.length} />
        </section>

        <section className={`instrument-chassis ${workspace}`}>
          <div className="instrument-header">
            <div>
              <span className="eyebrow">{workspace === "drums" ? "TR-style percussion synthesizer" : "monophonic sub synthesizer"}</span>
              <h2>{workspace === "drums" ? "Rhythm machine" : "808 bass machine"}</h2>
            </div>
            <div className="now-status">
              <span className={transportState === "playing" ? "live" : ""} />
              {transportState === "playing" ? `Playing ${String(playhead + 1).padStart(2, "0")}` : transportState === "paused" ? "Paused" : "Ready"}
            </div>
          </div>

          {workspace === "drums" ? (
            <div className="workspace-layout drum-layout">
              <VoiceBay project={project} selectedLane={selectedLane} onParam={setDrumParam} onAudition={auditionDrum} />
              <section className="bay sequencer-bay">
                <div className="bay-topline"><div><span className="bay-kicker">sequence</span><h3>Pattern grid</h3></div><div className="velocity-key"><span className="ghost-key" /> Ghost <span className="hit-key" /> Hit <span className="accent-key" /> Accent</div></div>
                <DrumGrid project={project} bank={bank} playhead={playhead} selectedLane={selectedLane} onSelectLane={setSelectedLane} onToggleStep={toggleDrumStep} onToggleMute={toggleMute} onAudition={auditionDrum} />
              </section>
              <DrumGeneratorBay project={project} onGenerate={generateDrums} onUpdate={updateProject} canUndo={Boolean(undoSnapshot)} onUndo={undoGeneration} />
            </div>
          ) : (
            <div className="workspace-layout bass-layout">
              <BassSoundBay project={project} onParam={setBassParam} onWave={(wave) => setBassParam("wave", wave)} onAudition={() => auditionBass()} />
              <section className="bass-center-stack">
                <section className="bay sequencer-bay bass-sequencer-bay">
                  <div className="bay-topline"><div><span className="bay-kicker">sequence</span><h3>Pitch lane</h3></div><button className={`bass-mute ${project.bassMuted ? "active" : ""}`} type="button" onClick={() => updateProject("bassMuted", !project.bassMuted)}>MUTE BASS</button></div>
                  <BassGrid project={project} bank={bank} playhead={playhead} selectedStep={selectedBassStep} onSelectStep={selectBassStep} onDeleteStep={deleteBassStep} />
                </section>
                <BassStepInspector event={selectedEvent} step={selectedBassStep} onChange={changeBassEvent} onDelete={() => deleteBassStep()} onAudition={auditionBass} />
              </section>
              <BassGeneratorBay project={project} summary={summary} onGeneratePattern={generatePattern} onGenerateSound={generateSound} onGenerateBoth={generateBoth} onUpdate={updateProject} canUndo={Boolean(undoSnapshot)} onUndo={undoGeneration} />
            </div>
          )}
        </section>

        <section className="session-note">
          <span className="warning-icon">!</span>
          <div><b>Start low.</b><p>The sub voice is synthesized in real time and can carry serious low-frequency energy. A compressor and limiter protect the output, but your speakers still matter.</p></div>
          <div className="save-status"><span /> Auto-saved locally</div>
        </section>
      </main>

      <footer>
        <p>Pattern logic studies shared Bronx drill vocabulary—half-time anchors, syncopated low end, negative space, and restrained slides—without recreating any specific recording.</p>
        <span>Tone.js engine · no samples · 64 steps</span>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
