# CFChart top-10,000 model improvement plan

## Goal and current state

Use the completed top-10,000 Codeforces cohort to improve two user-facing features: official-rating forecasts and practice recommendations. Keep training offline and inference local to the extension. Promote a model only after it improves on data reserved before model development.

As checked on 2026-11-12, `ml/data/top10000/users` contains 10,000 JSON files and `ml/data/top10000/top10000_handles.txt` contains 10,000 handles. **File count alone is not a completeness or quality audit.** No `ml/artifacts/top10000-overnight` artifact exists yet. The bundled predictor is the validated `cfchart-top5000-v1`; the latest recommender policy is `adaptive-baseline-v2`, with the older `adaptive-baseline-v1` retained as the experiment comparison. The existing `ml/artifacts/recommender` artifact was trained on a much smaller cohort and is not the extension's recommender policy.

This is an offline development plan, not an instruction to install any newly trained model automatically.

## Technology choices and readiness

| Candidate | Purpose | Readiness and decision rule |
| --- | --- | --- |
| LightGBM quantile regression | Strong tabular baseline for 30/90-day forecasts | Already used by CFChart. Retrain first to isolate the effect of the larger dataset. |
| Two-stage participation and rating-change model | Represent the probability of no rated contest separately from rating movement after participation | Research candidate. Ship only if it beats the retrained single-stage model on both frozen holdouts and remains compact enough for local inference. |
| Conformalized quantile regression | Calibrate forecast ranges using a separate calibration set | Established method, but temporal drift matters here. Require later-date and subgroup coverage checks before use. |
| Item response theory plus calibrated boosted trees | Estimate user ability, problem difficulty, and acceptance probability on attempted problems | The main recommender experiment. Compare against a simple rating-gap model and the current adaptive policy; require unseen-user calibration and browser performance checks. |
| Learning-to-rank or contextual bandits | Optimize which problems CFChart presents and learns from feedback | **Deferred** until the app has consented impression and outcome logs. Historical Codeforces attempts alone do not show which recommendations users saw, so they cannot validate this policy offline. |

The goal is a measured improvement, not novelty for its own sake. A larger or more complex model is rejected if it loses on the frozen holdouts, is poorly calibrated, or slows the extension substantially. Keep [LightGBM's ranking support](https://lightgbm.readthedocs.io/en/stable/Features.html) and [conformalized quantile regression](https://proceedings.neurips.cc/paper/2019/file/5103c3584b063c431bd1268e9b5e76fb-Paper.pdf) as technical references; each still needs CFChart-specific validation.

## Phase 1 — Freeze and audit the cohort

1. Copy the exact 10,000-handle ranking to a dated, immutable manifest. Record collection start/end, API method, source, and a checksum for each user file. Do not refresh the ranking during an evaluation run.
2. Parse every JSON file and report: valid records, `coverage.complete`, `ratingsFetchedAt`, `submissionsFetchedAt`, submission count, rating count, duplicate handles/IDs, pagination gaps, empty or impossible timestamps, and file sizes. Exclude invalid users with a reason; never silently treat missing activity as zero.
3. Inspect distributions by *historical* rating, year, contests, practice frequency, and inactivity. Today's top-rated selection is a cohort property; the many lower-rated historical periods remain useful for modeling their careers.
4. Freeze a dataset version and exclusion report. Training and evaluation must both refer to that version. Store generated reports under ignored `ml/artifacts` and leave raw public histories out of Git.

**Deliverable:** `ml/artifacts/top10000-audit/{manifest.json,report.json,report.html}`. Proceed only when every target handle is accounted for and incomplete or invalid records are explicitly listed.

## Phase 2 — Register splits and baselines before tuning

1. Reserve users by a stable handle hash. Within the remaining users, reserve a later time block for temporal evaluation. Keep a 90-day gap before rating-forecast holdouts so no training label reaches into the evaluation period. Record exact UTC cutoffs in the audit manifest.
2. Use **as-of** features only: a snapshot can use rating events and submissions at or before its timestamp. Problem difficulty and tags are collection-time metadata; measure results with that limitation stated, and avoid claiming that retrospective tests prove prospective performance.
3. Reproduce the bundled `cfchart-top5000-v1` on the same eligible 30- and 90-day snapshots as every new candidate. Compare against unchanged rating and recent momentum. For recommendation experiments, compare with both `adaptive-baseline-v1` and the current `adaptive-baseline-v2`, plus a rating-gap-only solve-probability baseline.
4. Report results by user as well as by snapshot. Repeated snapshots from one user are correlated; use user-level bootstrap intervals for differences in metrics, and show sample counts in each subgroup.

**Deliverable:** frozen split specification and baseline scorecard with overall and historical-rating-band results. Do not change these holdouts after looking at candidate results.

## Phase 3 — Strengthen the evaluation gates

The README currently specifies stronger forecast criteria than `ml/train.py::passes_gate` enforces: the code checks sample count and broad interval coverage but does not enforce the stated >3% median-MAE improvement, the stated 70–90% interval range, or the rating-band regression limit. Fix that mismatch before a new artifact can be marked validated. Require the same gates on both later-time and unseen-user holdouts, plus native/Python/TypeScript parity and browser bundle checks.

The recommender trainer currently marks a model validated when the training set is merely large enough. Change `validated` and `deploymentAllowed` to depend on predeclared performance gates: better held-out log loss and Brier score than the baseline, acceptable calibration by historical rating band, adequate sample counts, and no material degradation for low-activity or sparse-history users. Record all gates and failures in the artifact report.

**Deliverable:** gate code and a machine-readable decision report. A failed candidate remains an offline artifact; the app keeps its existing model or policy.

## Phase 4 — Improve the official-rating predictor

1. Retrain the existing LightGBM quantile model on the frozen cohort first. This establishes the gain from more data without changing the architecture.
2. Compare a two-stage candidate: predict the probability of at least one rated contest in the horizon, then model rating change conditional on participation. Combine the stages into 30- and 90-day rating distributions, carrying the last official rating forward when there is no contest. This directly reflects how official ratings behave.
3. Calibrate forecast intervals on a separate calibration block. Conformalized quantile regression is a candidate, but evaluate coverage on *later dates* and in rating/activity subgroups; standard exchangeability guarantees do not automatically hold under temporal drift.
4. Select the simpler model unless the new approach improves median error and interval coverage on both frozen holdouts. Check runtime size and inference latency in the browser. Keep the existing version available for rollback.

**Primary measures:** 30/90-day MAE, median absolute error, quantile loss, interval coverage and width, unchanged-rating and momentum comparisons, user-level uncertainty, and subgroup regressions. The UI must continue to show two horizons rather than inventing a daily path.

## Phase 5 — Improve practice recommendations

1. Define the target precisely. Public Codeforces submissions support **acceptance on an attempted problem**. They do not reveal independent solving, thinking time, unseen problem exposure, or whether an unattempted problem would have been solved. Group repeated submissions into one problem episode and use only information known before its first attempt.
2. Train an interpretable item-response-style baseline (user ability relative to problem difficulty), then compare a regularized boosted-tree candidate with historical rating, recent attempts/acceptances, problem rating, tags, and activity recency. Give sparse problems and new users a stable fallback.
3. Calibrate probabilities on later attempted problems from unseen users. Use log loss, Brier score, reliability plots, and rating-band slices; do not create negative labels from unattempted problems.
4. Use calibrated solve probability as one input to the existing session selector. Keep filters for solved/attempted problems, time budget, tag diversity, and pinned tasks. Display a plain explanation of difficulty and selection reason; do not present acceptance probability as a promise of independent success.
5. Record recommendation impressions, clicks, skips, and optional self-reported outcomes locally with explicit provenance. Only after that data exists should learning-to-rank or contextual-bandit policies be evaluated. Public API histories alone cannot identify how users would respond to problems CFChart recommended but they never saw.

**Primary measures:** future/unseen-user log loss, Brier score, calibration, candidate coverage, diversity, latency, and later opt-in recommendation outcomes. A new ranker must improve the actual recommendation experience, not just the attempted-problem classifier.

## Phase 6 — Integrate and release

1. Export a versioned compact artifact and verify Python/native predictions against the TypeScript evaluator. Reject incompatible feature schemas or missing prerequisites.
2. Run typecheck, the relevant model parity and recommender checks, build, and browser smoke checks. Measure extension bundle size and per-profile inference time. Ensure missing or stale histories produce an honest unavailable state.
3. Review the audit, holdout reports, and regression tables before installation. Installing a forecast uses `python -m ml.install --artifact ...`; a recommender candidate needs an equally explicit installer and runtime gate. Keep the current bundled model and adaptive policy as rollback choices.
4. After release, monitor only consented, locally available feedback and compare it with the offline forecast/recommender expectations. Recalibrate or roll back on meaningful deterioration.

## Immediate sequence

1. Audit the 10,000 files and freeze the cohort manifest.
2. Fix the forecast and recommender validation gates.
3. Run the existing forecast trainer on the frozen top-10,000 cohort and compare it with `cfchart-top5000-v1` on identical holdouts.
4. Train the item-response baseline and a boosted-tree recommendation candidate; evaluate them before touching the app policy.
5. Integrate only the candidates that clear the gates, then build and inspect the extension.

Training can take substantial CPU and disk space. Preserve the current installed model until the new artifact and comparison report are complete.

## Execution status — 2026-11-12

The cohort audit, fixed holdouts, validation-gate corrections, full-cohort forecast retraining, participation-aware research experiment, and full-cohort recommender comparisons have been run. The outcomes and release decision are recorded in [`TOP10000_MODEL_RESULTS.md`](TOP10000_MODEL_RESULTS.md). The forecast candidates failed their accuracy gates. The boosted recommender passed its offline attempted-problem prediction gate, but browser feature parity and recommendation-policy evaluation remain. Neither candidate was installed in the extension.
