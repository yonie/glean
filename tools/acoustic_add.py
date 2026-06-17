#!/usr/bin/env python3
"""Add curated ACOUSTIC drums (Real Drums Vol.1) to digitakt-out -- into the category
buckets AND as a coherent kit under KITS/. Excludes the BONUS demo-track songs.

Real Drums has clean category folders, so we classify by folder (filenames are cryptic
RD_* codes). Curated by size (smallest/tightest one-shots first, per category) to fit
the budget, since acoustic hits are large and go in twice (categories + kit).

  python acoustic_add.py            # dry run
  python acoustic_add.py --commit
"""
import os, sys, shutil

SRC = r"E:\Samples\Real Drums Vol. 1"
OUT = r"E:\Samples\digitakt-out"
KIT = os.path.join(OUT, "KITS", "Real Drums Vol.1")

# per-category cap (keep the N smallest files) -> controls total size
CAP = {"KICKS":10, "SNARES":14, "TOMS":14, "CYMBALS":12, "HATS":8, "CLAPS":8, "PERC":18}

def bucket_for(relpath):
    p = relpath.lower().replace("\\", "/")
    if "demo" in p: return None
    if "/hi hat" in p or "hihat" in p: return "HATS"
    if p.startswith("cymbals"): return "CYMBALS"     # crash/ride/splash
    if p.startswith("kick"): return "KICKS"
    if p.startswith("snare"): return "SNARES"
    if p.startswith("toms"): return "TOMS"
    if p.startswith("claps"): return "CLAPS"
    if p.startswith("percussion"): return "PERC"
    return None

def main():
    commit = "--commit" in sys.argv
    by = {}
    for root, dirs, files in os.walk(SRC):
        dirs[:] = [d for d in dirs if d != "__MACOSX"]
        for f in files:
            if not f.lower().endswith(".wav"): continue
            ap = os.path.join(root, f)
            rel = os.path.relpath(ap, SRC)
            b = bucket_for(rel)
            if b is None: continue
            by.setdefault(b, []).append((os.path.getsize(ap), ap, f))

    chosen = []
    print("=== curated acoustic selection (smallest-first per category) ===")
    tot = 0
    for b in ["KICKS","SNARES","TOMS","CYMBALS","HATS","CLAPS","PERC"]:
        lst = sorted(by.get(b, []))[:CAP.get(b, 99)]
        s = sum(x[0] for x in lst)
        tot += s
        chosen += [(b, ap, f) for _, ap, f in lst]
        print(f"  {b:9s} {len(lst):3d}  {s/1024/1024:6.1f} MB")
    print(f"  SET TOTAL    {len(chosen):3d}  {tot/1024/1024:6.1f} MB  (x2 for categories+kit = {2*tot/1024/1024:.1f} MB)")

    # current size + projection
    ex = 0
    for r,_,fs in os.walk(OUT):
        for f in fs:
            if f.lower().endswith(".wav"): ex += os.path.getsize(os.path.join(r,f))
    print(f"\nexisting: {ex/1024/1024:.1f} MB  ->  projected: {(ex+2*tot)/1024/1024:.1f} MB  (cap 800)")

    if not commit:
        print("\n(dry run -- add --commit)"); return
    if ex + 2*tot > 800*1024*1024:
        print("ABORT: over budget"); sys.exit(1)
    os.makedirs(KIT, exist_ok=True)
    n = 0
    for b, ap, f in chosen:
        for dst_dir in (os.path.join(OUT, b), KIT):
            os.makedirs(dst_dir, exist_ok=True)
            dst = os.path.join(dst_dir, f)
            if os.path.exists(dst):
                stem, ext = os.path.splitext(f); i = 2
                while os.path.exists(os.path.join(dst_dir, f"{stem}__{i}{ext}")): i += 1
                dst = os.path.join(dst_dir, f"{stem}__{i}{ext}")
            shutil.copy2(ap, dst); n += 1
    print(f"\ncopied {n} files ({len(chosen)} into categories + {len(chosen)} into KITS/Real Drums Vol.1)")

if __name__ == "__main__":
    main()
