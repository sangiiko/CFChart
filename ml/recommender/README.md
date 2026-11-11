# Practice-outcome research pipeline

This pipeline trains and evaluates practice recommendation models using available public Codeforces data (`--cohort`) or explicitly shared CFChart practice exports (`--exports`). It is separate from the official-rating forecasting pipeline. No upload service is enabled.

## Training with Public Codeforces Cohort

To train on the public Codeforces cohort:

```sh
python3 -m ml.recommender.train --cohort ml/data/cohort/users --output ml/artifacts/recommender --cutoff 2024-01-01 --max-users 200
python3 -m unittest ml.recommender.test_train ml.recommender.test_evaluate -v
```

This pipeline fits a regularized hierarchical logistic model on observed problem attempts during contests and practice ($Y \in \{0, 1\}$).
- **Target:** Historical problem acceptance on Codeforces.
- **Assistance:** Unknown. Never inferred to be unassisted or independent.
- **Thinking time:** Unknown. Never inferred from submission timestamps.
- **Mechanics:** Problems never attempted are not labeled as failures. Repeated wrong submissions are grouped by problem into a single attempt episode.
- **Monotonicity:** Greater relative difficulty cannot increase predicted solve probability ($\beta_{\text{diff}} \le 0$).
- **Evaluation:** Strict chronological split (past labels only in training) and disjoint unseen-user holdout. Reports log loss, Brier score, reliability curves by decile, and rating-band stratification (<1200, 1200-1500, 1500-1800, 1800+).

## Training with Consented Exports

To train on user-exported ledgers:

```sh
python3 -m ml.recommender.train --exports /path/to/consented-exports --output ml/artifacts/recommender-pilot --cutoff 2026-11-01 --budget 30
```

## Unsupported Models and Gating

Unsupported models (competing assistance hazard models, retention half-life from memory probes, causal 90-day rating trials) remain explicitly disabled with `deploymentAllowed: false` and `validated: false`. The extension uses the working adaptive fallback baseline.

Tests verify mechanics, monotonicity, data splits, and gating.
