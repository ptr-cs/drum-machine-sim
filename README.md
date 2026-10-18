# Drum Machine Sim

A local, synthesized 808 bass and percussion instrument with a shared 64-step sequencer. It is built with React, Vite, and Tone.js and does not use drum samples or a hosted backend.

## Run it

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. Audio starts only after a click on Play or an audition control because browsers require a user gesture before starting Web Audio.

Useful checks:

```bash
npm test
npm run build
```

## Instrument overview

- 64 total steps with 16-step edit banks and a full-pattern overview
- Active lengths of 16, 24, 32, 48, or 64 steps
- Exact Tone.js timing for `1/32`, `1/16T`, `1/16`, `1/8T`, `1/8`, `1/4`, `1/2`, and whole-note steps
- 11 synthesized percussion voices: kick, snare, clap, closed/open hats, rim, low/mid/high toms, cowbell, and cymbal
- Voice-specific level, tone, and decay controls; mute and audition per lane
- Continuous monophonic 808 bass voice with pitch drop, gates up to the remaining phrase length, glide, extended decay, saturation, a dedicated low-mid Body stage, sub oscillator, and master limiting
- Scale/key-constrained bass-note editing
- Local autosave, JSON project import/export, and multitrack Standard MIDI File export
- Desktop and responsive layouts, keyboard transport (`Space`), and instrument switching (`1` / `2`)

## Generative controls

The drum generator uses a constrained drill rhythm grammar: a half-time snare anchor, sparse syncopated kicks, alternating hats, occasional rolls, open-hat calls, and restrained secondary percussion. It composes in beat time and then quantizes to the selected grid, so both `1/16T` and `1/8T` are real triplet grids rather than visual approximations.

The bass generator follows existing kick accents, stays in the selected scale, favors tonic-centered motifs, enforces breathing room, and limits slides to useful transitions. Every result is deterministic from the visible seed.

The three bass buttons are deliberately independent:

- **Generate pattern** changes notes, rhythm, velocity, gate, and slides but preserves the current sound.
- **Generate sound** changes only the synth patch and preserves every note.
- **Generate both** changes the pattern and sound together.

The global **Generate groove** control chooses a fresh 140–150 BPM drill tempo, root, and minor-mode scale, then replaces drums, bass notes, and the bass voice as one coherent, undoable operation. It generates the drums first so the new bass phrase can lock to the new kick pattern and uses the newly selected key for every bass note.

**MIDI** exports a format-1 `.mid` file with a tempo/conductor track, GM-mapped drums on channel 10, and bass on channel 1. Timing uses 480 PPQ, which represents every supported straight, sixteenth-triplet, and eighth-triplet step exactly. Bass gates, velocities, and slide overlaps are retained; portamento controllers are included for glide-aware instruments. The **½ tempo** option doubles all MIDI note spacing and gate lengths, producing a clip that is twice as long while retaining the project BPM marker for reliable DAW import. Export filenames include the seed, export mode, and a sortable UTC timestamp down to milliseconds, so rapid exports do not overwrite one another.

Every generation can be undone, and generated state is reproducible through the seed and exported project JSON.

## Drill study profile

The initial profile draws on shared rhythmic and low-end traits heard across work by Sha Gz, Kay Flock, and Edot Babyy: roughly 140–150 BPM, a strong half-time pocket, syncopated kick/808 relationships, short pockets of negative space, melodic but restrained slides, and small hat bursts near transitions. These are generalized genre rules, not transcriptions or attempts to reproduce a specific recording.

Representative references used during the design pass:

- [Sha Gz — “New Opp”](https://www.youtube.com/watch?v=mnYttEgWNfA)
- [Kay Flock — “Is Ya Ready”](https://www.youtube.com/watch?v=gGJS8W9emac)
- [Edot Babyy — “Ready 4 War”](https://www.youtube.com/watch?v=3ShbbU4iMKE)
- [Pitchfork on Edot Babyy’s “Body”](https://pitchfork.com/thepitch/edot-baby-body-new-song-listen/)
- [Roland TR-808 technical specifications](https://support.roland.com/hc/en-us/articles/201963539-TR-808-Technical-Specifications)

The original TR-808 did not include a chromatic melodic bass synth. The bass workspace models the modern tuned, sustained “808” role separately from the short percussion kick.

## Source map

- `src/main.jsx` — interface, editing, persistence, and transport state
- `src/audioEngine.js` — Tone.js synthesis, drum rack, bass voice, and scheduling
- `src/generator.js` — seeded drum, bass-pattern, and bass-sound generation
- `src/music.js` — timing, scales, voices, and shared musical constants
- `src/midiExport.js` — dependency-free multitrack Standard MIDI File encoder
- `src/styles.css` — instrument chassis and responsive styling
- `test/generator.test.js` — deterministic and musical-boundary tests across hundreds of seeds

This project is an independent instrument inspired by classic drum-machine synthesis and is not affiliated with or endorsed by Roland Corporation.
