#!/usr/bin/env python3
"""Sort the curated 'shortlist' vintage drum-machine samples into Digitakt-friendly
category folders, classifying by filename (the source machines label every sound).

Non-destructive: files are COPIED, never moved. Writes a manifest for review.
"""
import os, shutil, csv, re, sys

SRC = r"E:\Samples\IV VINTAGE DRUM MACHINES\IV VINTAGE DRUM MACHINES\shortlist"
OUT = r"E:\Samples\digitakt-out"

# Folders to scaffold (incl. user's empty workflow dirs)
CATEGORIES = ["INCOMING", "RECORDED", "KICKS", "SNARES", "CLAPS", "HATS",
              "TOMS", "PERC", "CYMBALS", "BASS", "LEADS", "FX", "LOOPS"]

# (category, [keywords]) checked in order; first hit wins. Matched on lowercased basename.
RULES = [
    ("CLAPS",   ["clap", "snap"]),                       # incl. FSnap, HR16Snap
    ("SNARES",  ["snare"]),
    ("KICKS",   ["kick", "bassdrum", "bass drum"]),
    ("HATS",    ["hihat", "hi-hat", "hat"]),
    ("CYMBALS", ["crash", "ride", "china", "splash", "cymbal", "cymb",
                 "cup", "edge"]),
    ("TOMS",    ["tom"]),                                # TomHi/Tom01/TomE/...
    ("FX",      ["hiq", "spark", "scratch", "tank", "smack", "thud",
                 "starchime", "noise", "zap"]),
    ("PERC",    ["conga", "bongo", "agogo", "cowbell", "cow", "claves",
                 "clave", "block", "cabasa", "maraca", "shaker", "tambor",
                 "triangle", "timbale", "guiro", "whistle", "quijada",
                 "rimshot", "rim", "sidestick", "ratchet", "perc", "bell"]),
]

def classify(name: str):
    n = name.lower()
    for cat, kws in RULES:
        for kw in kws:
            if kw in n:
                return cat, kw
    return None, None

def build_kits():
    kroot = os.path.join(OUT, "KITS")
    if os.path.isdir(kroot):
        shutil.rmtree(kroot)
    os.makedirs(kroot, exist_ok=True)
    counts = {}
    for machine in sorted(os.listdir(SRC)):
        mpath = os.path.join(SRC, machine)
        if not os.path.isdir(mpath):
            continue
        dst_dir = os.path.join(kroot, machine)
        os.makedirs(dst_dir, exist_ok=True)
        n = 0
        for root, _, files in os.walk(mpath):
            for f in files:
                if f.lower().endswith(".wav"):
                    shutil.copy2(os.path.join(root, f), os.path.join(dst_dir, f))
                    n += 1
        counts[machine] = n
    print("=== KITS (by machine) ===")
    for m in sorted(counts):
        print(f"{counts[m]:4d}  {m}")
    print(f"---- {sum(counts.values())} files across {len(counts)} kits ----\n")

def main():
    # Wipe & rebuild auto-managed category folders (never touch INCOMING/RECORDED user dirs).
    for c in CATEGORIES:
        path = os.path.join(OUT, c)
        if c not in ("INCOMING", "RECORDED") and os.path.isdir(path):
            shutil.rmtree(path)
        os.makedirs(path, exist_ok=True)

    manifest, counts, unsorted = [], {}, []
    used = {}  # dest path -> count, to dodge collisions

    for root, _, files in os.walk(SRC):
        for f in files:
            if not f.lower().endswith(".wav"):
                continue
            cat, kw = classify(f)
            machine = os.path.basename(root)
            if cat is None:
                unsorted.append((machine, f))
                continue
            dst_dir = os.path.join(OUT, cat)
            dst = os.path.join(dst_dir, f)
            if os.path.exists(dst):  # collision across machines -> suffix
                stem, ext = os.path.splitext(f)
                i = used.get(dst, 1) + 1
                used[dst] = i
                dst = os.path.join(dst_dir, f"{stem}__{i}{ext}")
            shutil.copy2(os.path.join(root, f), dst)
            counts[cat] = counts.get(cat, 0) + 1
            manifest.append((cat, machine, f, kw))

    with open(os.path.join(OUT, "_manifest.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["category", "source_machine", "filename", "matched_keyword"])
        for row in sorted(manifest):
            w.writerow(row)

    print("=== copied per category ===")
    for c in CATEGORIES:
        if counts.get(c):
            print(f"{counts[c]:4d}  {c}")
    total = sum(counts.values())
    print(f"---- {total} files sorted ----")
    if unsorted:
        print(f"\n!!! {len(unsorted)} UNSORTED (need review):")
        for m, f in unsorted:
            print(f"   [{m}] {f}")
    else:
        print("\nAll files classified. No leftovers.\n")
    build_kits()

if __name__ == "__main__":
    main()
