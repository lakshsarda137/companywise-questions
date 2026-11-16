# Companywise

A dashboard of LeetCode questions by company. You can filter by **sector**, company, difficulty, topic, how recently a company asked a question, which questions are newly added, company HQ, and how many companies ask a question.

The data merges two upstream repos, refreshed daily by GitHub Actions:

- [ayush-that/codejeet](https://github.com/ayush-that/codejeet) (`data/companies/*.csv`, `data/problems/*.json`)
- [snehasishroy/leetcode-companywise-interview-questions](https://github.com/snehasishroy/leetcode-companywise-interview-questions)

## Layout

| Path | What |
|---|---|
| `scripts/build.py` | Clones both upstreams, merges them, and writes `site/data/questions.json` |
| `data/companies.json` | Company → display name, sectors (one or more), HQ region, confidence. Classified by Claude Sonnet with web search |
| `data/seen.txt`, `data/added.json` | Records which company+question pairs have been seen, so the "New" filter works |
| `data/unclassified.txt` | Present only when upstream adds companies that have no sector yet |
| `site/` | Static dashboard (plain HTML/CSS/JS, no build step) |
| `.github/workflows/update.yml` | Daily cron: rebuild, commit the data, deploy to Pages |

## Local

```sh
python3 scripts/build.py              # fetches upstreams into a temp dir
python3 -m http.server -d site 8000   # open http://localhost:8000
```

## When new companies appear

The workflow logs a warning and writes `data/unclassified.txt`. Add entries for those companies to `data/companies.json` using the same shape. Until then they appear under **Unclassified**.
