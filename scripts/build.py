#!/usr/bin/env python3
"""Fetch both upstream repos, merge company-wise LeetCode data, emit site/data/questions.json.

Usage:
  python3 scripts/build.py                      # clone upstreams into a temp dir
  python3 scripts/build.py --sources DIR        # reuse existing clones (DIR/codejeet, DIR/sneh)

State kept in data/ (committed):
  companies.json  slug -> {name, sectors, hq}      (sector classification)
  seen.txt        every "company|problem" pair ever observed (one per line)
  added.json      {"YYYY-MM-DD": ["company|problem", ...]}  pairs first seen on that day
"""
import argparse, csv, datetime as dt, json, os, re, subprocess, sys, tempfile
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "site", "data", "questions.json")

UPSTREAMS = {
    "codejeet": "https://github.com/ayush-that/codejeet",
    "sneh": "https://github.com/snehasishroy/leetcode-companywise-interview-questions",
}

SECTORS = [
    "Big Tech", "Quant / HFT / Trading", "Banking & Investment", "Fintech & Payments",
    "Crypto / Web3", "Enterprise SaaS", "Cloud, Infra & Dev Tools", "AI / ML", "Cybersecurity",
    "Semiconductors & Hardware", "E-commerce & Retail", "Marketplaces & Gig",
    "Social, Media & Streaming", "Gaming", "Adtech & Martech", "Travel & Hospitality",
    "Mobility & Autonomous", "Healthcare & Biotech", "Telecom & Networking",
    "IT Services & Consulting", "Edtech", "Logistics & Supply Chain", "Insurance / Insurtech",
    "Aerospace, Defense & Industrial",
]

# Same company, different LeetCode slugs across the two repos.
ALIAS = {
    "airbus-se": "airbus", "aqr-capital-management-llc": "aqr-capital-management",
    "at-t": "att", "bill-holdings": "bill-com", "edelweiss-group": "edelweiss",
    "keeptruckin": "motive", "ola-cabs": "ola", "palantir-technologies": "palantir",
    "national-payments-corporation-of-india": "npci", "lowe": "lowe-s",
    "apolloio": "apollo-io", "bookingcom": "booking-com", "hrt": "hudson-river-trading",
    "jtg": "josh-technology", "machinezone": "machine-zone", "medianet": "media-net",
    "otterai": "otter-ai", "ponyai": "pony-ai", "pure": "pure-storage", "sumologic": "sumo-logic",
    "tower-research": "tower-research-capital", "veeva": "veeva-systems", "virtu": "virtu-financial",
    "wissen": "wissen-technology", "zeta-suite": "zeta", "snap": "snapchat",
}

# Recency buckets, most recent first. "all" = listed only in the all-time file.
RECENCY = ["30d", "3m", "6m", "older", "all"]
SNEH_FILES = {"thirty-days.csv": "30d", "three-months.csv": "3m", "six-months.csv": "6m",
              "more-than-six-months.csv": "older", "all.csv": "all"}
CJ_TIMEFRAME = {"30_days": "30d", "3_months": "3m", "6_months": "6m",
                "more_than_6m": "older", "all": "all"}
DIFFS = ["Easy", "Medium", "Hard"]


def sh(*args, cwd=None):
    return subprocess.run(args, cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


def fetch(dest):
    os.makedirs(dest, exist_ok=True)
    cj, sn = os.path.join(dest, "codejeet"), os.path.join(dest, "sneh")
    if not os.path.isdir(cj):
        sh("git", "clone", "-q", "--depth", "1", "--filter=blob:none", "--sparse", UPSTREAMS["codejeet"], cj)
        sh("git", "sparse-checkout", "set", "data/companies", "data/problems", cwd=cj)
    if not os.path.isdir(sn):
        sh("git", "clone", "-q", "--depth", "1", UPSTREAMS["sneh"], sn)


def repo_meta(path):
    try:
        return {"sha": sh("git", "rev-parse", "--short", "HEAD", cwd=path),
                "date": sh("git", "log", "-1", "--format=%cs", cwd=path)}
    except Exception:
        return {}


def slug_from_url(url):
    m = re.search(r"/problems/([^/?#]+)", url or "")
    return m.group(1) if m else None


def pct(s):
    try:
        return round(float(str(s).strip().rstrip("%")), 1)
    except ValueError:
        return None


def canon(c):
    c = c.strip().lower()
    return ALIAS.get(c, c)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sources")
    ap.add_argument("--today", default=dt.date.today().isoformat())
    a = ap.parse_args()
    src = a.sources or tempfile.mkdtemp(prefix="cwq-")
    fetch(src)
    cj_dir, sn_dir = os.path.join(src, "codejeet"), os.path.join(src, "sneh")

    problems = {}                       # slug -> dict(id,title,diff,acc,topics)
    pairs = defaultdict(lambda: {"rec": set(), "freq": {}, "src": 0})

    def note_problem(slug, pid, title, diff, acc=None, topics=None):
        p = problems.setdefault(slug, {"id": None, "title": None, "diff": None, "acc": None, "topics": []})
        if pid and str(pid).isdigit() and not p["id"]:
            p["id"] = int(pid)
        p["title"] = p["title"] or title
        p["diff"] = p["diff"] or (diff if diff in DIFFS else None)
        if acc is not None and p["acc"] is None:
            p["acc"] = acc
        if topics and not p["topics"]:
            p["topics"] = topics

    def note_pair(company, slug, bucket, freq, bit):
        e = pairs[(company, slug)]
        e["rec"].add(bucket)
        e["src"] |= bit
        if freq is not None:
            e["freq"][bucket] = max(e["freq"].get(bucket, 0), freq)

    # codejeet: data/problems/*.json (canonical metadata), data/companies/*.csv
    pdir = os.path.join(cj_dir, "data", "problems")
    for f in os.listdir(pdir) if os.path.isdir(pdir) else []:
        if not f.endswith(".json"):
            continue
        try:
            d = json.load(open(os.path.join(pdir, f), encoding="utf-8"))
        except Exception:
            continue
        if d.get("slug"):
            note_problem(d["slug"], d.get("id"), d.get("title"), d.get("difficulty"),
                         pct(d.get("acceptance_rate")), d.get("topics") or [])

    cdir = os.path.join(cj_dir, "data", "companies")
    for f in sorted(os.listdir(cdir)):
        if not f.endswith(".csv"):
            continue
        company = canon(f[:-4])
        for r in csv.DictReader(open(os.path.join(cdir, f), encoding="utf-8")):
            slug = slug_from_url(r.get("URL"))
            bucket = CJ_TIMEFRAME.get((r.get("Timeframe") or "").strip())
            if not slug or not bucket:
                continue
            topics = [t.strip() for t in (r.get("Topics") or "").split(",") if t.strip()]
            note_problem(slug, r.get("ID"), r.get("Title"), r.get("Difficulty"), pct(r.get("Acceptance %")), topics)
            note_pair(company, slug, bucket, pct(r.get("Frequency %")), 1)

    # snehasishroy: <company>/<bucket>.csv
    for d in sorted(os.listdir(sn_dir)):
        full = os.path.join(sn_dir, d)
        if d.startswith(".") or not os.path.isdir(full) or d == "src":
            # "src" is the Java scraper dir in that repo... unless it's a company with CSVs
            if d != "src" or not os.path.exists(os.path.join(full, "all.csv")):
                continue
        company = canon(d)
        for fname, bucket in SNEH_FILES.items():
            fp = os.path.join(full, fname)
            if not os.path.exists(fp):
                continue
            for r in csv.DictReader(open(fp, encoding="utf-8")):
                slug = slug_from_url(r.get("URL"))
                if not slug:
                    continue
                note_problem(slug, r.get("ID"), r.get("Title"), r.get("Difficulty"), pct(r.get("Acceptance %")))
                note_pair(company, slug, bucket, pct(r.get("Frequency %")), 2)

    # ---- first-seen tracking ---------------------------------------------------------
    os.makedirs(DATA, exist_ok=True)
    seen_fp, added_fp = os.path.join(DATA, "seen.txt"), os.path.join(DATA, "added.json")
    first_run = not os.path.exists(seen_fp)
    seen = set() if first_run else set(open(seen_fp).read().split())
    added = json.load(open(added_fp)) if os.path.exists(added_fp) else {}
    keys = {f"{c}|{p}" for c, p in pairs}
    new = sorted(keys - seen)
    if new and not first_run:
        added[a.today] = sorted(set(added.get(a.today, [])) | set(new))
    with open(seen_fp, "w") as fh:
        fh.write("\n".join(sorted(seen | keys)) + "\n")
    meta_fp = os.path.join(DATA, "meta.json")
    meta = json.load(open(meta_fp)) if os.path.exists(meta_fp) else {}
    meta.setdefault("tracking_since", a.today)
    json.dump(meta, open(meta_fp, "w"), indent=1)
    json.dump(added, open(added_fp, "w"), indent=0, sort_keys=True)
    first_seen = {k: day for day, ks in added.items() for k in ks}

    # ---- emit compact columnar JSON ----------------------------------------------------
    cls_fp = os.path.join(DATA, "companies.json")
    cls = json.load(open(cls_fp)) if os.path.exists(cls_fp) else {}
    companies = sorted({c for c, _ in pairs})
    cidx = {c: i for i, c in enumerate(companies)}
    pslugs = sorted(problems, key=lambda s: (problems[s]["id"] or 10**9, s))
    pidx = {s: i for i, s in enumerate(pslugs)}
    topics = sorted({t for p in problems.values() for t in p["topics"]})
    tidx = {t: i for i, t in enumerate(topics)}
    days = sorted(added)
    didx = {d: i + 1 for i, d in enumerate(days)}       # 0 = baseline / not new

    out_pairs = {"c": [], "p": [], "r": [], "f": [], "s": [], "n": []}
    ccount = defaultdict(int)
    for (c, p), e in sorted(pairs.items(), key=lambda kv: (cidx[kv[0][0]], pidx[kv[0][1]])):
        rec = min(RECENCY.index(b) for b in e["rec"])
        freq = e["freq"].get("all", max(e["freq"].values(), default=0))
        out_pairs["c"].append(cidx[c]); out_pairs["p"].append(pidx[p])
        out_pairs["r"].append(rec); out_pairs["f"].append(freq or 0)
        out_pairs["s"].append(e["src"]); out_pairs["n"].append(didx.get(first_seen.get(f"{c}|{p}"), 0))
        ccount[c] += 1

    def cinfo(c):
        info = cls.get(c, {})
        name = info.get("name") or c.replace("-", " ").title()
        secs = [SECTORS.index(s) for s in info.get("sectors", []) if s in SECTORS]
        return [c, name, secs, info.get("hq", ""), ccount[c], 1 if info.get("confidence") == "low" else 0]

    payload = {
        "generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "trackingSince": meta["tracking_since"],
        "sources": {"codejeet": {"url": UPSTREAMS["codejeet"], **repo_meta(cj_dir)},
                    "sneh": {"url": UPSTREAMS["sneh"], **repo_meta(sn_dir)}},
        "sectors": SECTORS, "recency": RECENCY, "diffs": DIFFS, "topics": topics, "days": days,
        "companies": [cinfo(c) for c in companies],
        "problems": [[problems[s]["id"] or 0, s, problems[s]["title"] or s,
                      DIFFS.index(problems[s]["diff"]) if problems[s]["diff"] else -1,
                      problems[s]["acc"], [tidx[t] for t in problems[s]["topics"]]] for s in pslugs],
        "pairs": out_pairs,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump(payload, fh, separators=(",", ":"))

    unclassified = [c for c in companies if c not in cls]
    print(f"companies={len(companies)} problems={len(pslugs)} pairs={len(pairs)} topics={len(topics)} "
          f"new_today={0 if first_run else len(new)} unclassified={len(unclassified)} "
          f"size={os.path.getsize(OUT)//1024}KB")
    if unclassified:
        print("UNCLASSIFIED:", " ".join(unclassified[:50]), "..." if len(unclassified) > 50 else "")
        with open(os.path.join(DATA, "unclassified.txt"), "w") as fh:
            fh.write("\n".join(unclassified) + "\n")
    elif os.path.exists(os.path.join(DATA, "unclassified.txt")):
        os.remove(os.path.join(DATA, "unclassified.txt"))


if __name__ == "__main__":
    sys.exit(main())
