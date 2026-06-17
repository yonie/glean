#!/usr/bin/env python3
"""Add the iconic vintage machines to digitakt-out in BOTH views:
  - KITS/<machine>/   (browsable kit, original filenames)
  - category buckets  (folded in, prefixed with the machine name for provenance/dedup)

Classifies category placement by relpath keywords (reuses sort_to_buckets rules).
Non-destructive copies, skips __MACOSX. Respects the 800MB total cap.

  python add_machines.py            # dry run
  python add_machines.py --commit
"""
import os, sys, shutil
from sort_to_buckets import classify, BUCKETS

FULL = r"E:\Samples\IV VINTAGE DRUM MACHINES\IV VINTAGE DRUM MACHINES\Vintage Drum Machines"
OUT  = r"E:\Samples\digitakt-out"

MACHINES = [
    "Oberheim DMX", "Oberheim DX", "Emu SP12", "Emu Drumulator", "Linn LM1",
    "Linn 9000", "Akai MPC-60", "Sequential Circuits Drumtraks", "Simmons SDSV",
    "Simmons SDS-5", "Casio RZ-1", "Korg Minipops", "Roland CR-8000",
    "Roland CompuRhythm 1000",
]

def uniq(path):
    if not os.path.exists(path): return path
    stem, ext = os.path.splitext(path); i = 2
    while os.path.exists(f"{stem}__{i}{ext}"): i += 1
    return f"{stem}__{i}{ext}"

def main():
    commit = "--commit" in sys.argv
    plan_kit, plan_cat, unsorted = [], [], []
    for m in MACHINES:
        mdir = os.path.join(FULL, m)
        if not os.path.isdir(mdir):
            print(f"!! missing: {m}"); continue
        for root, dirs, files in os.walk(mdir):
            dirs[:] = [d for d in dirs if d != "__MACOSX"]
            for f in files:
                if not f.lower().endswith(".wav"): continue
                ap = os.path.join(root, f)
                rel = os.path.relpath(ap, mdir)
                plan_kit.append((m, ap, f))
                b = classify(rel)
                if b is None:
                    unsorted.append((m, rel)); continue
                plan_cat.append((b, m, ap, f))

    # report
    cat_by = {}; size_cat = 0; size_kit = 0
    for b, m, ap, f in plan_cat:
        cat_by.setdefault(b, 0); cat_by[b] += 1; size_cat += os.path.getsize(ap)
    for m, ap, f in plan_kit:
        size_kit += os.path.getsize(ap)
    print("=== folding into categories ===")
    for b in BUCKETS:
        if cat_by.get(b): print(f"  {b:9s} {cat_by[b]:4d}")
    print(f"  category files: {len(plan_cat)}  ({size_cat/1024/1024:.1f} MB)")
    print(f"  kit files     : {len(plan_kit)}  ({size_kit/1024/1024:.1f} MB)  across {len(MACHINES)} kits")
    if unsorted:
        print(f"  UNSORTED (kit only, not in a category): {len(unsorted)}")
        for m, r in unsorted[:20]: print(f"     [{m}] {r}")

    ex = 0
    for r,_,fs in os.walk(OUT):
        for f in fs:
            if f.lower().endswith('.wav'): ex += os.path.getsize(os.path.join(r,f))
    proj = ex + size_cat + size_kit
    print(f"\nexisting: {ex/1024/1024:.1f} MB -> projected: {proj/1024/1024:.1f} MB (cap 800)")

    if not commit:
        print("\n(dry run -- add --commit)"); return
    if proj > 800*1024*1024:
        print("ABORT: over budget"); sys.exit(1)
    # kits
    for m, ap, f in plan_kit:
        d = os.path.join(OUT, "KITS", m); os.makedirs(d, exist_ok=True)
        shutil.copy2(ap, uniq(os.path.join(d, f)))
    # categories (machine-prefixed)
    for b, m, ap, f in plan_cat:
        d = os.path.join(OUT, b); os.makedirs(d, exist_ok=True)
        shutil.copy2(ap, uniq(os.path.join(d, f"{m} {f}")))
    print(f"\ncopied {len(plan_kit)} kit files + {len(plan_cat)} category files")

if __name__ == "__main__":
    main()
