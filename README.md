# homebrew XO — sample browser + drum machine

A zero-install, browser-based sample browser inspired by XLN Audio **XO** and Waves
**Cosmos**: point it at any folder of `.wav` samples and it lays them out in a 2D
**similarity space** (nearby = similar timbre), lets you **scan sounds by ear** by
dragging across the map, and drops them onto an **8-track / 16-step drum machine** with
per-track filter, EQ, pan, pitch and volume.

Everything runs locally in the browser — **no upload, no server, no build step**.

## Features

- **Similarity map** — every sample is reduced to a ~17-dimensional timbre vector
  (envelope, spectral centroid/spread/rolloff/flatness, log-band energies, ZCR…) and the
  set is projected to 2D with PCA. Similar sounds cluster; colors mark the source folder.
- **Drag-to-scan** — hold the mouse and sweep across the map; it retriggers the nearest
  sound as you move, so you browse by ear. Click a dot to drop it on the active track.
- **Folder browser** — left sidebar is a real folder tree with breadcrumbs; drill into
  subdirectories. Works on any folder structure (curated colors for common drum
  categories, hashed colors for everything else).
- **8-track step sequencer** — 16 steps, adjustable BPM, per-track channel strip
  (Volume, Pan, Filter cutoff + resonance, low/high EQ shelves, Pitch), mute, and live
  Web Audio playback.
- **Swap samples** — click a track's name to jump back to the map and pick a new sound.

## Run it

No install. Open `app/index.html` in a modern browser (Chrome, Edge, or Firefox) and
click **Open folder…**. If your browser blocks local scripts over `file://`, serve the
folder instead:

```bash
cd app && python -m http.server 8000   # then open http://localhost:8000
```

## Repo layout

```
app/                 the web app (no build step)
  index.html
  css/styles.css
  js/util.js         shared state + helpers + colors
  js/dsp.js          FFT, feature extraction, PCA  (pure, reusable)
  js/audio.js        decode/audition + per-track FX chain
  js/app.js          UI: folder browser, map, sequencer, transport
tools/               Python scripts to PREP/sort a sample library (see tools/README.md)
docs/                build notes from the reference library
```

## How the map works (and how it compares to XO/Cosmos)

The commercial tools use larger learned feature sets / ML embeddings and a non-linear
projection (t-SNE/UMAP-style) for their layouts. This project uses a transparent,
dependency-free pipeline: hand-built timbre features → **linear PCA** to 2D. It produces
a genuine similarity layout (kicks, hats, snares, pads separate out) and is easy to read
and hack, but it won't be as surgical as a trained model. Swapping in a JS UMAP/t-SNE and
richer features is an obvious next step.

## Roadmap

- Pattern save/load and export (MIDI / audio).
- Optional t-SNE/UMAP projection and MFCC features.
- Per-step parameter locks; more than 8 tracks.
- File System Access API for re-reading folders without re-picking.

## License

MIT — see [LICENSE](LICENSE).
