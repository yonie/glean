#!/usr/bin/env python3
"""XO-style audio content categorizer for sample files with unhelpful filenames.

When filenames DON'T tell you what a sound is (the messy vintage tree, random dumps),
this analyzes the actual audio -- the same kind of features XLN XO uses -- and routes
each .wav to a Digitakt bucket by how the sound behaves, ignoring its name.

NOT needed for well-labeled packs (shortlist, Legowelt) -- filename sorting is more
reliable there. Use this only for unlabeled material.

Features per sample:
  duration, onset count, attack time, RMS decay, spectral centroid (brightness),
  zero-crossing rate (noisiness), spectral flatness (tonal vs noise), fundamental
  pitch (via librosa.yin on low frames).

Modes:
  python audio_categorize.py --src DIR [--src DIR ...]            # dry-run report
  python audio_categorize.py --src DIR --commit --out OUTDIR      # copy into buckets
  python audio_categorize.py --validate DIR                       # score vs filename labels

Requires: librosa, numpy, soundfile (all present on this machine).
Tune thresholds with --validate against the shortlist (known answers) before trusting
it on unlabeled files.
"""
import os, sys, shutil, argparse
import numpy as np

try:
    import librosa
except ImportError:
    sys.exit("librosa not installed: pip install librosa soundfile")

SR = 22050  # analysis rate; plenty for feature extraction

def extract(path):
    y, sr = librosa.load(path, sr=SR, mono=True)
    if y.size == 0:
        return None
    dur = len(y) / sr
    rms = librosa.feature.rms(y=y)[0]
    peak_i = int(np.argmax(rms)) if rms.size else 0
    # attack: time from start to RMS peak
    hop = 512
    attack = peak_i * hop / sr
    # decay: frames after peak above 10% of peak
    if rms.size:
        thr = rms.max() * 0.1
        post = rms[peak_i:]
        decay = int(np.sum(post > thr)) * hop / sr
    else:
        decay = 0.0
    cent = float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr)))
    zcr = float(np.mean(librosa.feature.zero_crossing_rate(y)))
    flat = float(np.mean(librosa.feature.spectral_flatness(y=y)))  # 0 tonal .. 1 noise
    onsets = librosa.onset.onset_detect(y=y, sr=sr, units="frames")
    n_onsets = int(len(onsets))
    # fundamental pitch estimate (robust-ish): use yin on a low range
    try:
        f0 = librosa.yin(y, fmin=40, fmax=2000, sr=sr)
        f0 = f0[np.isfinite(f0)]
        pitch = float(np.median(f0)) if f0.size else 0.0
    except Exception:
        pitch = 0.0
    return dict(dur=dur, attack=attack, decay=decay, cent=cent, zcr=zcr,
                flat=flat, onsets=n_onsets, pitch=pitch)

def classify(ft):
    """Heuristic decision tree. Returns a bucket name. Thresholds calibrated at
    SR=22050 (Nyquist 11025) against the shortlist via --validate. Audio-only drum
    classification has a real ceiling -- pitched perc (congas/bongos) overlaps toms,
    snares overlap perc -- so expect ~65-70%, not 95%. Use filenames when available."""
    if ft is None:
        return "FX"
    dur, cent, zcr, flat = ft["dur"], ft["cent"], ft["zcr"], ft["flat"]
    pitch, attack, decay, onsets = ft["pitch"], ft["attack"], ft["decay"], ft["onsets"]
    p = pitch or 0.0

    # 1) Loops: clearly long & rhythmic (tightened to avoid ringing cymbals)
    if dur > 2.2 and onsets >= 6:
        return "LOOPS"

    tonal = flat < 0.015          # clearly harmonic/pitched
    sustained = decay > 0.7       # rings/holds a long time

    # 2) Tonal/melodic family (synth material)
    if tonal and (sustained or dur > 1.0):
        if attack > 0.1 or dur > 2.8:       # slow swell / long hold -> pad
            return "PADS"
        if 0 < p < 150:                     # low fundamental -> bass
            return "BASS"
        return "LEADS"

    # 3) Percussive family. SR-appropriate gates. ORDER MATTERS: dark/pitched first,
    # snare/clap (mid) before the bright hat/cymbal gate so snares aren't grabbed.
    noisy = zcr > 0.08 or flat > 0.08

    # kicks: very dark + short (pitch often undetectable on subs, so allow p==0)
    if p < 120 and cent < 1600 and decay < 0.55:
        return "KICKS"
    # toms: pitched mid, clean-ish, not endlessly ringing
    if (120 <= p <= 320) and cent < 2600 and flat < 0.12 and decay < 0.7:
        return "TOMS"
    # ringing broadband -> cymbal (before snare; crashes can sit mid-centroid)
    if noisy and decay > 0.75 and cent > 3200:
        return "CYMBALS"
    # clap: noisy, several micro-transients, short, not super bright
    if noisy and onsets >= 3 and dur < 0.55 and cent < 6000:
        return "CLAPS"
    # snare: noisy mid body, below the hat brightness floor
    if noisy and 1500 < cent < 5000:
        return "SNARES"
    # hats / cymbals: genuinely bright
    if cent >= 5000:
        return "CYMBALS" if (decay > 0.5 and cent > 5500) else "HATS"
    return "PERC"

LABELS = ["KICKS","SNARES","CLAPS","HATS","TOMS","CYMBALS","PERC",
          "BASS","LEADS","PADS","FX","LOOPS"]

def iter_wavs(roots):
    for src in roots:
        for root, dirs, files in os.walk(src):
            dirs[:] = [d for d in dirs if d != "__MACOSX"]
            for f in files:
                if f.lower().endswith(".wav"):
                    yield os.path.join(root, f)

# filename-truth for validation (mirrors the reliable keyword logic)
TRUTH = [
    ("CLAPS",["clap","snap"]),("SNARES",["snare"]),("KICKS",["kick","basedrum","bassdrum"]),
    ("HATS",["hihat","hat"]),("CYMBALS",["crash","ride","cymbal","cymb","china","splash"]),
    ("TOMS",["tom"]),("PERC",["conga","bongo","agogo","cowbell","clave","shaker","perc",
    "tambo","timbale","rim","maraca","block","cabasa"]),("BASS",["bass"]),("PADS",["pad","atmos","string"]),
    ("LEADS",["lead","synth","brass","piano","arp"]),("LOOPS",["loop","sequence"]),("FX",["fx","laser"]),
]
def truth_label(name):
    n = name.lower()
    for lab, kws in TRUTH:
        if any(k in n for k in kws):
            return lab
    return None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", action="append", default=[])
    ap.add_argument("--out")
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--validate")
    args = ap.parse_args()

    if args.validate:
        total = correct = skipped = 0
        confusion = {}
        for p in iter_wavs([args.validate]):
            truth = truth_label(os.path.basename(p))
            if truth is None:
                skipped += 1; continue
            pred = classify(extract(p))
            total += 1
            if pred == truth:
                correct += 1
            else:
                confusion[(truth, pred)] = confusion.get((truth, pred), 0) + 1
        print(f"validated {total} labeled files (skipped {skipped} unlabeled)")
        print(f"accuracy: {correct}/{total} = {100*correct/max(total,1):.1f}%")
        print("top confusions (truth -> predicted):")
        for (t,pr), c in sorted(confusion.items(), key=lambda x:-x[1])[:15]:
            print(f"  {c:3d}  {t:8s} -> {pr}")
        return

    if not args.src:
        sys.exit("need --src DIR (or --validate DIR)")
    counts = {}
    plan = []
    for p in iter_wavs(args.src):
        b = classify(extract(p))
        counts[b] = counts.get(b, 0) + 1
        plan.append((b, p))
    print("=== predicted buckets ===")
    for b in LABELS:
        if counts.get(b):
            print(f"  {b:9s} {counts[b]:5d}")
    print(f"  TOTAL     {sum(counts.values()):5d}")

    if args.commit:
        if not args.out:
            sys.exit("--commit needs --out OUTDIR")
        for b, p in plan:
            d = os.path.join(args.out, b)
            os.makedirs(d, exist_ok=True)
            dst = os.path.join(d, os.path.basename(p))
            if os.path.exists(dst):
                stem, ext = os.path.splitext(os.path.basename(p))
                i = 2
                while os.path.exists(os.path.join(d, f"{stem}__{i}{ext}")):
                    i += 1
                dst = os.path.join(d, f"{stem}__{i}{ext}")
            shutil.copy2(p, dst)
        print(f"\ncopied {len(plan)} files into {args.out}")
    else:
        print("\n(dry run -- add --commit --out OUTDIR to copy)")

if __name__ == "__main__":
    main()
