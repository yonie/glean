#!/usr/bin/env python3
"""Generic filename/folder sample sorter -> Digitakt category buckets.

Canonical sorter for ANY well-named pack (the Legowelt run was the first instance of
this; this generalizes it). Classifies by keywords in the relative path (folder names
count, which rescues packs with cryptic filenames but tidy folders, e.g. Alesis SR16).
Audio analysis is NOT used -- it tops out ~57% (see audio_categorize.py); filenames are
far more reliable when present.

  python sort_to_buckets.py --src DIR [--src DIR ...]            # dry run + budget check
  python sort_to_buckets.py --src DIR ... --commit               # copy into digitakt-out

Non-destructive (copies). Skips __MACOSX. Refuses to exceed --budget MB total (default
800) for the whole digitakt-out folder.
"""
import os, sys, shutil, argparse

OUT = r"E:\Samples\digitakt-out"
BUCKETS = ["KICKS","SNARES","CLAPS","HATS","TOMS","PERC","CYMBALS",
           "BASS","LEADS","PADS","FX","LOOPS"]

RULES = [
    ("KICKS",   ["basedrum","bassdrum","bass drum","kickdrum","kick","kik","bd "]),
    ("SNARES",  ["snaredrum","snare","sd "]),
    ("CLAPS",   ["clap","snap","handclap"]),
    ("HATS",    ["hihat","hi-hat","hi hat","hat","openhat","closedhat","hh"]),
    ("CYMBALS", ["crash","ride","cymbal","cymb","china","splash"]),
    ("TOMS",    ["tom"]),
    ("PERC",    ["percussion","perc","conga","bongo","agogo","cowbell","clave",
                 "shaker","tambo","tamb","timbale","timb","maraca","woodblock",
                 "block","cabasa","rimshot","rim","sidestick","stick","triangle",
                 "guiro","quijada","whistle","bell"]),
    ("BASS",    ["bass","sub"]),
    ("PADS",    ["pad","atmos","ambient","string"]),
    ("LEADS",   ["lead","synth","brass","epiano","e-piano","piano","rhodes",
                 "organ","pluck","arp","chord","stab","ethno","flute",
                 "choir","vox","voice","guitar","key"]),
    ("LOOPS",   ["sequence","loop","groove","break","beat"]),
    ("FX",      ["fx","sfx","noise","laser","riser","sweep","zap","burst",
                 "glitch","impact","hit","typhoon","scratch"]),
]

def classify(relpath):
    n = relpath.lower()
    for bucket, kws in RULES:
        for kw in kws:
            if kw in n:
                return bucket
    return None

def collect(srcs):
    items, unsorted = [], []
    for src in srcs:
        pack = os.path.basename(os.path.normpath(src))
        for root, dirs, files in os.walk(src):
            dirs[:] = [d for d in dirs if d != "__MACOSX"]
            for f in files:
                if not f.lower().endswith(".wav"):
                    continue
                ap = os.path.join(root, f)
                rel = os.path.relpath(ap, src)
                b = classify(rel)
                if b is None:
                    unsorted.append((pack, rel)); continue
                items.append((pack, b, ap, os.path.getsize(ap), f))
    return items, unsorted

def human(n): return f"{n/1024/1024:7.1f} MB"

def existing_size():
    tot = 0
    for root, _, files in os.walk(OUT):
        for f in files:
            if f.lower().endswith(".wav"):
                tot += os.path.getsize(os.path.join(root, f))
    return tot

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", action="append", required=True)
    ap.add_argument("--budget", type=float, default=800.0, help="MB cap for whole digitakt-out")
    ap.add_argument("--commit", action="store_true")
    args = ap.parse_args()

    items, unsorted = collect(args.src)
    per_b, per_p = {}, {}
    for pack, b, ap_, size, f in items:
        per_b.setdefault(b,[0,0]); per_b[b][0]+=1; per_b[b][1]+=size
        per_p.setdefault(pack,[0,0]); per_p[pack][0]+=1; per_p[pack][1]+=size
    print("=== per bucket ===")
    tot=totn=0
    for b in BUCKETS:
        if b in per_b:
            n,s=per_b[b]; tot+=s; totn+=n
            print(f"  {b:9s} {n:5d}  {human(s)}")
    print(f"  {'TOTAL':9s} {totn:5d}  {human(tot)}")
    print("=== per pack ===")
    for p,(n,s) in per_p.items():
        print(f"  {n:5d}  {human(s)}  {p}")
    if unsorted:
        print(f"=== UNSORTED: {len(unsorted)} (review) ===")
        for p,r in unsorted[:40]:
            print(f"   [{p}] {r}")

    ex = existing_size()
    print(f"\nExisting digitakt-out: {human(ex)}")
    print(f"This selection adds:   {human(tot)}")
    print(f"Projected total:       {human(ex+tot)}  (cap {args.budget:.0f} MB)")

    if not args.commit:
        print("\n(dry run -- add --commit to copy)"); return
    if (ex+tot) > args.budget*1024*1024:
        print("\nABORT: would exceed budget. Trim sources."); sys.exit(1)
    for b in BUCKETS:
        os.makedirs(os.path.join(OUT, b), exist_ok=True)
    n=0
    for pack, b, src_ap, size, f in items:
        d = os.path.join(OUT, b); dst = os.path.join(d, f)
        if os.path.exists(dst):
            stem,ext = os.path.splitext(f); i=2
            while os.path.exists(os.path.join(d, f"{stem}__{i}{ext}")): i+=1
            dst = os.path.join(d, f"{stem}__{i}{ext}")
        shutil.copy2(src_ap, dst); n+=1
    print(f"\nCopied {n} files. New total: {human(existing_size())}")

if __name__ == "__main__":
    main()
