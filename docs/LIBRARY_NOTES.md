# Reference library build notes

The `tools/` scripts were built while assembling a ~700 MB Digitakt sample library from a
large raw collection. Summary of what they produced (for context — the audio itself is
not part of this repo):

- **Two parallel views** of the same files: by **sound type** (KICKS/SNARES/HATS/TOMS/
  PERC/CYMBALS/CLAPS/BASS/LEADS/PADS/FX/LOOPS) and by **kit** (`KITS/<machine>/`).
- **Filenames keep a source prefix** (e.g. `TR-808Kick01.wav`, `Oberheim DMX Bassdrum.wav`)
  so provenance survives when many sources share a folder.
- Sources merged: a curated vintage drum-machine shortlist (15 machines), the Legowelt
  packs (Drum Wizardry/Drumnibus + Juno-106/DX-FILES/JV-2080 synths), several small drum
  packs (808/99 Drum Samples/Alesis SR16/Korg DDM-110), a curated acoustic set (Real Drums
  Vol.1), and 14 iconic machines (DMX, SP-12, LinnDrum LM-1, MPC-60, Simmons, etc.).
- Kept under an **800 MB budget** (Digitakt has ~900 MB; leave room to record) by
  size-capping the large synth/acoustic sets.

Routing conventions used (see `sort_to_buckets.py` `RULES`): added **TOMS** and **PADS**
buckets beyond a bare drum layout; rimshots/sidesticks → PERC; finger snaps → CLAPS;
cymbal bells/edges → CYMBALS; synthetic odd hits → FX; tonal bass → BASS, pads/atmos/
strings → PADS, other tonal → LEADS, sequences → LOOPS.

**Format note (Elektron `.dtsnd` Sound files):** a `.dtsnd` is a ZIP of `manifest.json`
+ a binary `Payload` (sound params) + the embedded `Samples/*.wav` (resampled to 48 kHz
and rewrapped). The sample `Hash` is computed over that resampled audio and is baked into
both the manifest and the Payload — so reproducing valid Sound files by hand is fragile;
use the open-source **elektroid** project (which implements the package format) instead.
