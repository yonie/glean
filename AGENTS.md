# Glean - agent instructions

## Kit files are user data: every later version must load them

Since 1.1.0, **Export kit** writes a `.zip` (`app/js/export.js`) holding `kit.json` plus
the samples under `samples/`. People keep these and move them between machines, so every
future version must import a kit written by 1.1.0 or later and restore it exactly as it was
saved: samples, BPM, every knob, steps and mute.

- `kit.json` carries `"glean": 1`. Bump it when the format changes, and keep a reader for
  every older value.
- Add fields; never rename, remove or change the meaning or range of an existing one. If a
  knob's range or taper changes, convert the stored value on import.
- A new field needs a default for kits that do not have it (`importKit` already spreads
  `FXDEF()` under the stored knobs).
- Before each release, import a kit saved by every earlier version and check it comes back
  unchanged.
