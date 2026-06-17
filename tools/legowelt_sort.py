#!/usr/bin/env python3
"""Sort Legowelt sample packs into Digitakt category buckets by filename/folder.

These packs are descriptively named (drum packs have category folders; synth packs
have category prefixes like '106 Bass', 'BASS-', 'Bass-'), so filename classification
is reliable -- no audio analysis needed.

Two modes:
  python legowelt_sort.py            # DRY RUN: report per-bucket count+size, no copy
  python legowelt_sort.py --commit   # copy, honouring SYNTH_CAP per (pack,bucket)

Non-destructive (copies). Excludes __MACOSX junk. Stays within an 800MB total budget.
"""
import os, shutil, sys

OUT = r"E:\Samples\digitakt-out"
SOURCES = [
    r"E:\Samples\Legowelt Drum Wizardry Sample Pack",
    r"E:\Samples\Legowelt Drumnibus Samplepack",
    r"E:\Samples\Legowelt Juno 106 Samples",
    r"E:\Samples\Legowelt_DX-FILES_SamplePack",
    r"E:\Samples\Legowelt-Elektrovolt-RolandJV2080sampleKit",
]

# Per (pack, bucket) cap on number of files, applied to the big generic synth buckets
# to fit the size budget. None elsewhere = take all. Tuned after the dry run.
SYNTH_CAP = {"LEADS": 60}   # the giant generic 'Synth' category lands here

BUCKETS = ["KICKS","SNARES","CLAPS","HATS","TOMS","PERC","CYMBALS",
           "BASS","LEADS","PADS","FX","LOOPS"]

RULES = [
    ("KICKS",   ["basedrum","bassdrum","bass drum","kickdrum","kick"]),
    ("SNARES",  ["snaredrum","snare"]),
    ("CLAPS",   ["clap","snap"]),
    ("HATS",    ["hihat","hi-hat","hat"]),
    ("CYMBALS", ["crash","ride","cymbal","china","splash"]),
    ("TOMS",    ["tom"]),
    ("PERC",    ["percussion","perc","conga","bongo","agogo","cowbell","clave",
                 "shaker","tambo","timbale","maraca","woodblock","block","cabasa",
                 "rimshot","rim","sidestick","triangle","guiro"]),
    ("BASS",    ["bass"]),
    ("PADS",    ["pad","atmos","ambient","string"]),
    ("LEADS",   ["lead","synth","brass","epiano","e-piano","piano","rhodes",
                 "organ","pluck","bell","arp","chord","stab","ethno","flute",
                 "choir","vox","voice","guitar","key"]),
    ("LOOPS",   ["sequence","loop","groove"]),
    ("FX",      ["fx","sfx","noise","laser","riser","sweep","zap","burst"]),
]

def classify(relpath: str):
    n = relpath.lower()
    for bucket, kws in RULES:
        for kw in kws:
            if kw in n:
                return bucket
    return None

def collect():
    """Return list of (pack, bucket, abspath, size, filename), plus unsorted list."""
    items, unsorted = [], []
    for src in SOURCES:
        pack = os.path.basename(src)
        for root, dirs, files in os.walk(src):
            dirs[:] = [d for d in dirs if d != "__MACOSX"]
            for f in files:
                if not f.lower().endswith(".wav"):
                    continue
                ap = os.path.join(root, f)
                rel = os.path.relpath(ap, src)
                b = classify(rel)
                if b is None:
                    unsorted.append((pack, rel))
                    continue
                items.append((pack, b, ap, os.path.getsize(ap), f))
    return items, unsorted

def human(n):
    return f"{n/1024/1024:7.1f} MB"

def select(items):
    """Apply SYNTH_CAP per (pack,bucket); drum packs unaffected. Largest-first trim
    so we keep more, smaller, diverse samples within a capped bucket."""
    by = {}
    for it in items:
        by.setdefault((it[0], it[1]), []).append(it)
    chosen = []
    for (pack, bucket), lst in by.items():
        cap = SYNTH_CAP.get(bucket)
        if cap and len(lst) > cap and "Drum" not in pack:
            lst = sorted(lst, key=lambda x: x[3])[:cap]  # keep the cap smallest
        chosen.extend(lst)
    return chosen

def report(items, unsorted, title):
    print(f"\n===== {title} =====")
    per_bucket = {}
    per_pack = {}
    for pack, b, ap, size, f in items:
        per_bucket.setdefault(b, [0,0]); per_bucket[b][0]+=1; per_bucket[b][1]+=size
        per_pack.setdefault(pack, [0,0]); per_pack[pack][0]+=1; per_pack[pack][1]+=size
    print("-- per bucket --")
    tot=0; totn=0
    for b in BUCKETS:
        if b in per_bucket:
            n,s = per_bucket[b]; tot+=s; totn+=n
            print(f"  {b:9s} {n:4d}  {human(s)}")
    print(f"  {'TOTAL':9s} {totn:4d}  {human(tot)}")
    print("-- per pack --")
    for pack in per_pack:
        n,s = per_pack[pack]
        print(f"  {n:4d}  {human(s)}  {pack}")
    if unsorted:
        print(f"-- UNSORTED: {len(unsorted)} --")
        for p,r in unsorted[:30]:
            print(f"   [{p}] {r}")
    return tot

def main():
    commit = "--commit" in sys.argv
    items, unsorted = collect()
    report(items, unsorted, "ALL CANDIDATES (pre-budget)")
    chosen = select(items)
    total = report(chosen, [], "SELECTED (after SYNTH_CAP)")

    # add current on-disk size of category folders we won't rebuild (shortlist phase1 + KITS)
    existing = 0
    for root, _, files in os.walk(OUT):
        for f in files:
            if f.lower().endswith('.wav'):
                existing += os.path.getsize(os.path.join(root, f))
    print(f"\nExisting digitakt-out wav size: {human(existing)}")
    print(f"Legowelt selection adds:        {human(total)}")
    print(f"Projected total:                {human(existing+total)}  (cap 800.0 MB)")

    if not commit:
        print("\n(dry run -- rerun with --commit to copy)")
        return
    if existing+total > 800*1024*1024:
        print("\nABORT: over 800MB budget. Lower SYNTH_CAP."); sys.exit(1)
    for b in BUCKETS:
        os.makedirs(os.path.join(OUT, b), exist_ok=True)
    copied = 0
    for pack, b, ap, size, f in chosen:
        dst = os.path.join(OUT, b, f)
        if os.path.exists(dst):
            stem, ext = os.path.splitext(f)
            i = 2
            while os.path.exists(os.path.join(OUT, b, f"{stem}__{i}{ext}")):
                i += 1
            dst = os.path.join(OUT, b, f"{stem}__{i}{ext}")
        shutil.copy2(ap, dst); copied += 1
    print(f"\nCopied {copied} files into digitakt-out.")

if __name__ == "__main__":
    main()
