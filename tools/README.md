# tools — sample library prep

Python scripts that sort/curate a raw sample collection into clean, browsable category
folders (e.g. for an Elektron Digitakt, or to feed the web app). They classify **by
filename/folder keywords**, which is reliable when packs are descriptively named.

> Note: these were written against a specific machine layout and have hard-coded source
> paths near the top of each file. Edit `SRC`/`OUT`/`SOURCES` before running elsewhere.
> `python <script>.py` does a dry run; add `--commit` to actually copy.

| script | what it does |
|---|---|
| `sort_to_buckets.py` | **Canonical** generic sorter. `--src DIR …` → category buckets by relpath keywords; folder names rescue cryptic filenames. `--budget MB` cap, `--commit` to copy. Edit `RULES` to retune. |
| `digitakt_sort.py` | First sorter (a curated vintage shortlist) + builds a `KITS/` view. Re-run-safe; writes `_manifest.csv`. |
| `legowelt_sort.py` | One pack-specific run with a per-category `SYNTH_CAP`; superseded by `sort_to_buckets.py`. |
| `acoustic_add.py` | Pulls a curated, size-capped acoustic kit into both categories and `KITS/`. |
| `add_machines.py` | Adds machines to BOTH a `KITS/<machine>/` view and category folders (machine-prefixed for provenance). Imports `classify` from `sort_to_buckets.py`. |
| `audio_categorize.py` | **Audio-content** classifier (FFT/feature heuristics) for UNLABELED files. `--validate DIR` scores it against filename labels. |

## Filename sorting vs. audio analysis

Sorting by filename/folder is ~100% accurate when names are descriptive, and instant.
Audio-content classification (`audio_categorize.py`) only reaches ~57% on a validation
set — pitched percussion overlaps toms, a single clap ≈ a snare, etc. So: **prefer
filename sorting; reach for audio analysis only on genuinely unlabeled dumps**, and expect
to hand-review. (The web app's similarity map uses the same feature ideas, but for
*browsing* rather than hard classification.)
