# Top-10,000 model experiment results

Date: 2026-11-12. Source: public Codeforces histories in `ml/data/top10000/users`.
The frozen training/evaluation plan is in `ml/TOP10000_MODEL_PLAN.md`.

## Cohort audit

- Target handles and user JSON files: 10,000 each; no extra files.
- Collector-marked complete histories: 10,000.
- Histories eligible for a forecast requiring at least three contests: 9,981; 19 have fewer than three.
- 15,405,567 submissions, 410,260 rating records, 8.96 GB of user JSON.
- Per-file checksums and exclusions: `ml/artifacts/top10000-audit/manifest.json` and `report.json`; visual report: `report.html`.

The `coverage.complete` flag reflects collector pagination. It cannot independently prove that Codeforces exposed every deleted or revised historical event. Problem ratings and tags are collection-time metadata.

## Registered forecast split

- Training labels must mature by **2025-06-30 00:00 UTC**.
- Later-time and unseen-user holdouts start **2025-10-01 00:00 UTC**, after a 90-day purge.
- Stable handle hashing reserves approximately 20% of users.
- 572,501 training snapshots, 89,123 later-time snapshots, and 22,072 unseen-user snapshots.

The gate code now enforces >3% MAE improvement over the better of unchanged-rating and momentum baselines at both horizons, 70–90% interval coverage, no >10% regression in rating bands with at least 30 rows, adequate users/rows, and native/Python/TypeScript parity. This matches the stated release criteria more closely than the previous sample-and-coverage-only gate.

| Model and split | 30-day MAE | 30-day unchanged MAE | 30-day coverage | 90-day MAE | 90-day unchanged MAE | 90-day coverage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Initial top-10k, later time | 11.96 | 6.56 | 92.5% | 17.90 | 13.69 | 93.6% |
| Initial top-10k, unseen users | 13.17 | 7.61 | 90.9% | 19.76 | 16.00 | 91.8% |
| Corrected 80% interval, later time | 11.95 | 6.56 | 83.8% | 17.90 | 13.69 | 85.4% |
| Corrected 80% interval, unseen users | 13.15 | 7.61 | 82.4% | 19.75 | 16.00 | 82.9% |

The first candidate used 5th/95th and 4th/96th percentile endpoints despite an 80% interval specification. The corrected candidate uses 10th/90th percentiles. Both remain **disabled** because their median errors lose to unchanged rating; the corrected coverage is in the intended range. Native export and TypeScript parity passed. Candidate reports are in `ml/artifacts/top10000-candidate` and `ml/artifacts/top10000-candidate-80pct`.

On one common 2026-06-01 snapshot per 1,971 unseen users, the initial top-10k candidate reduced 30-day MAE from 27.39 for the bundled `cfchart-top5000-v1` model to 13.08, and 90-day MAE from 34.57 to 18.91. This fixed-date comparison is useful, but the unchanged-rating baseline and full temporal holdouts prevent promotion. The same-user comparison is in `ml/artifacts/top10000-candidate/comparison.json`.

### Participation-aware research result

Only 22.7% of training snapshots had a rated contest within 30 days; 33.2% did within 90 days. A two-stage experiment predicts participation, then conditional rating change, carrying rating forward when predicted participation is below 50%.

| Split | 30-day two-stage / unchanged MAE | 90-day two-stage / unchanged MAE |
| --- | ---: | ---: |
| Later time | 6.70 / 6.56 | 13.27 / 13.69 |
| Unseen users | 7.71 / 7.61 | 14.98 / 16.00 |

This helps at 90 days but loses at 30 days. It has no calibrated ranges or browser runtime, so it is **research only**. Report: `ml/artifacts/top10000-two-stage/report.json`.

## Recommender experiments

Episodes are first attempts at distinct problems. A problem later accepted by that user is a positive episode; a problem attempted but never accepted in the collected history is a negative episode. Unattempted problems are not labeled. The training sample evenly spans each user's career, capped at 100 episodes per user: 830,926 episodes from all 10,000 files. The label is *historical acceptance on a self-selected attempt*, not independent solving or learning gain.

The regularized logistic model improved markedly over the fixed rating-gap baseline on both holdouts. Its artifact is an offline candidate in `ml/artifacts/top10000-recommender`.

The richer LightGBM candidate uses relative difficulty, historical rating, recent attempts and solves, prior solves sharing a tag, time since the last attempt, and tag count. All recent-activity features are computed before the episode's first attempt. A separate **2025-01-01 to 2025-09-30** block calibrates the probabilities. Later-time and unseen-user evaluations begin **2025-10-01**.

| Evaluation | Fitted logistic log loss | Boosted log loss | Fitted logistic Brier | Boosted Brier | Fitted logistic calibration error | Boosted calibration error |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Later time: 48,301 episodes | 0.2391 | 0.2229 | 0.0625 | 0.0587 | 0.0166 | 0.0084 |
| Unseen users: 12,502 episodes | 0.2282 | 0.2092 | 0.0601 | 0.0556 | 0.0103 | 0.0051 |

The boosted candidate passes the **offline acceptance-prediction gate** and its exported trees match native LightGBM predictions to `2.3e-16` on parity samples. The compact JSON artifact is about 236 KB. It remains **not deployable**: the extension does not yet have a parity-checked runtime feature pipeline for these seven inputs, and public Codeforces data cannot measure how users respond to problems CFChart actually recommends. See `ml/artifacts/top10000-recommender-boosted/{candidate.json,report.json}`.

## Release decision and next work

1. **Keep `cfchart-top5000-v1` installed.** Neither new forecast candidate clears the declared accuracy gates. The 90-day two-stage result warrants further work on calibrated intervals and 30-day behavior, using a fresh development split before touching the frozen holdouts again.
2. **Keep the boosted model out of the recommender policy.** This report evaluated against `adaptive-baseline-v1`; the current recency-aware `adaptive-baseline-v2` policy has not been evaluated here. Acceptance prediction is not yet a demonstrated improvement to the displayed recommendation list.
3. Add a browser evaluator and exact feature parity for the boosted artifact, then evaluate calibration and latency in the extension. Use local recommendation assignments and opt-in outcome feedback to measure the policy itself; do not treat unseen problems as failures.
4. Once a candidate passes its remaining gates, perform explicit installation, build, browser smoke checks, and rollback review. No candidate was installed in this experiment.

All results are observational and come from a cohort selected for current high rating. Earlier low-rated periods are included, but selection remains relevant when generalizing beyond this cohort.
