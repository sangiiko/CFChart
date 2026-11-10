# Browser-local rating forecasts

CFChart supports **LightGBM quantile regression** without requiring a Python server or a browser ML framework at runtime. Python trains six small nonlinear tree ensembles offline; the extension evaluates their versioned JSON locally. The chart integration stays independent of the model implementation.

**No trained weights ship with this repository.** `src/ml/registry.ts` intentionally exports `null`. Until a model trained on real historical data passes the gates below, the UI reports that ML forecasting is unavailable. The optional practice scenario remains a separately labeled heuristic; it is never presented as a learned forecast.

## Forecast definition

Predict official rating **30 and 90 days after a UTC snapshot**, with 10th/50th/90th quantiles. The target carries the last official rating forward if the user does not participate in a rated contest. Ratings may decrease. The two horizons are separate predictions; the UI must not invent daily predictions or force an increasing curve between them.

Features use only events at or before the snapshot: current and peak-as-of rating, contest count, recent deltas/volatility, rated-contest recency/frequency, accepted unique tasks, active UTC days, attempt counts, relative difficulty, acceptance rate, practice activity, and tag diversity. Empty statistics use zero; missing history is a prerequisite failure, not zero activity. Feature order and preprocessing live in `ml/features.py` and `src/ml/features.ts`; runtime parity is tested.

Minimum inference history: three rated contests and coverage of the last 90 days of submissions (or a complete lifetime history). Known submission snapshots older than 24 hours require refresh. Ratings outside the training range are rejected. The daily habit tracker uses the user's local day; **ML windows use UTC** for reproducible training/inference.

## Set up offline tools

Run from the repository root. Python 3.10+ and the project's Node dependencies are required.

```bash
python3 -m venv ml/.venv
ml/.venv/bin/python -m pip install -r ml/requirements.txt
npm install
```

The browser bundle does not depend on these Python packages. LightGBM is used solely during offline collection/training/export verification.

## Collect an explicit cohort

Create a UTF-8 `handles.txt` with one public Codeforces handle per line. Choose a representative cohort across rating bands, practice frequency, and inactivity; selecting only successful active users creates biased forecasts. Do not put passwords or API keys in this file.

```bash
ml/.venv/bin/python -m ml.collect --handles handles.txt --output ml/data/cohort --max-requests 50
```

- Only public `user.rating` and paginated `user.status` endpoints are requested. No API key is required.
- Requests start at least 2.1 seconds apart, including across resumptions. Transient/API failures have at most three attempts; retries consume the same global request budget.
- The command exits after the budget and writes progress after each successful page. Repeat it to resume. Completed handles are skipped.
- One collector may use an output directory at a time. A crashed process can leave `collector.lock`; remove that lock only after verifying no collector is running.
- Use a new output directory for a new dated collection. Existing completed records are immutable; this avoids silently mixing refreshes and partially collected history.
- User JSON records include rating/submission observation dates and coverage. Training snapshots require their features and future labels to be covered by the observed data. Newer users without adequate history are excluded with no fabricated labels.
- This collector deliberately requires an explicit list and a request budget. A population dataset is not downloaded automatically during extension installation or training tests.

Raw public submissions contain handles, activity timestamps, and source metadata. Data and generated artifacts are ignored by Git under `ml/data` and `ml/artifacts`; publish a cohort or artifact only after reviewing its provenance and limitations.

## Train, evaluate, and export

```bash
ml/.venv/bin/python -m ml.train \
  --data ml/data/cohort \
  --output ml/artifacts/v1 \
  --version cfchart-v1 \
  --allow-retrospective-metadata
```

The command writes:

- `model.json`: feature schema, six ensembles, version, prerequisites, and gates; `validated` is false unless every gate passes.
- `report.json`: sample/user counts, date cutoffs, accuracy against unchanged-rating and recent-momentum baselines, quantile loss, interval coverage/width, quantile crossings, and rating-band results.
- `parity.json`: a small set of real native-LightGBM predictions and feature vectors with raw inputs, used to verify the actual TypeScript evaluator.

No random row split is used. A stable hash of handles reserves approximately 20% of users. The remaining users provide training and future temporal evaluation. Every training label must mature before the training cutoff, using a 90-day purge; holdout snapshots occur after the test cutoff. Default cutoffs are fixed 60%/80% date positions; pass `--train-end` and `--test-start` UTC epoch seconds to pre-register explicit dates. Do not tune cutoffs, hyperparameters, or cohort selection on the final holdouts.

Deployment gates are checked independently on the future-time and unseen-user sets:

- At least 100 holdout snapshots from at least 10 users in each set.
- Both 30- and 90-day median forecasts improve mean absolute error by over 3% against the better of unchanged rating and recent momentum.
- The nominal 80% interval has observed coverage between 70% and 90% at each horizon.
- Rating bands with at least 30 rows do not exceed unchanged-rating MAE by over 10%.
- Native LightGBM and the Python JSON evaluator agree to `1e-7` on all held-out rows. The trainer then runs Vitest to check the shipped TypeScript preprocessing and all six model outputs against native fixtures.
- Data is marked as genuine Codeforces API collection, retrospective metadata limitations are explicitly acknowledged, and `--mechanics-only` was not used.

These are predeclared engineering release gates, not a claim that 100 correlated snapshots establish general scientific validity. Review user-level uncertainty, cohort coverage, and prospective performance before distribution. No conformal calibration or universal statistical coverage guarantee is claimed.

If any gate fails, export remains a disabled candidate. Training never silently substitutes a formula, synthetic weights, or a tiny pilot model. To experiment on synthetic data use `--mechanics-only`; that flag forces `validated: false`.

## Install a model that passed

Review `report.json` and the cohort provenance first, then run:

```bash
ml/.venv/bin/python -m ml.install --artifact ml/artifacts/v1
npm run build
```

The installer refuses disabled candidates, checks that model/report/parity fixture agree, reruns the TypeScript parity tests, copies `model.json` into `src/ml`, and replaces the null registry with a static local import. The extension loads no remote executable code and makes no model-server requests. Rebuild/reload the extension to use the artifact. Revert `src/ml/registry.ts` to its null export to disable forecasting.

## Known data limits

Problem ratings and tags in today's submission API reflect collection-time metadata. They are **not** an archive of what was known at each historical prediction date. The collector dates and discloses this limitation; `--allow-retrospective-metadata` is required for an otherwise passing model to become eligible. This flag does not remove the bias. A stronger future dataset stores prospective catalog/features and observes outcomes afterward.

Current profile peak rating is never used for historical features: peak rating is derived only from contests preceding the snapshot. Future contests/submissions are excluded. Users who stop competing remain in targets instead of disappearing as missing values. API rejudges and deleted submissions can still alter retrospective histories; collector pages are not an atomic server snapshot.

Accepted submissions do not measure time spent learning, outside practice, mentoring, copied solutions, or future participation choices. Historical associations do not establish that moving a daily-goal slider causes a particular rating gain. Forecasts and practice what-if scenarios remain separate products.

## Tests

```bash
ml/.venv/bin/python -m unittest ml.test_pipeline -v
npm test -- src/ml/__tests__/forecast.test.ts
```

The Python training test uses clearly marked **synthetic mechanics fixtures**, tests native and TypeScript parity, and asserts that its output cannot be deployed. It does not measure forecast quality. No synthetic trained weights are committed.

Technical references: [LightGBM quantile objective](https://lightgbm.readthedocs.io/en/stable/Parameters.html#objective), [LightGBM model dump API](https://lightgbm.readthedocs.io/en/stable/pythonapi/lightgbm.Booster.html#lightgbm.Booster.dump_model), [Codeforces API](https://codeforces.com/apiHelp).
