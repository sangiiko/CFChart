"""Train, evaluate and export six LightGBM quantile models for 30/90-day rating."""
import argparse
import hashlib
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from .collect import atomic_json
from .export import export_booster, predict
from .features import DAY, FEATURE_NAMES, build_features, covers_history, rating_at

HORIZONS = (30, 90)
QUANTILES = (0.1, 0.5, 0.9)


def held_out_user(handle):
    # Fixed before training; do not tune this split after inspecting scores.
    return int(hashlib.sha256(handle.lower().encode()).hexdigest()[:8], 16) % 5 == 0


def make_examples(snapshots, stride_days=28):
    examples = []
    for snapshot in snapshots:
        ratings = sorted(snapshot["ratings"], key=lambda r: r["ratingUpdateTimeSeconds"])
        if not ratings:
            continue
        observation_end = min(snapshot.get("ratingsFetchedAt", 0), snapshot.get("submissionsFetchedAt", 0))
        start = (ratings[0]["ratingUpdateTimeSeconds"] // DAY + 91) * DAY
        stop = observation_end - max(HORIZONS) * DAY
        for as_of in range(start, int(stop) + 1, stride_days * DAY):
            past = [r for r in ratings if r["ratingUpdateTimeSeconds"] <= as_of]
            if len(past) < 3 or not covers_history(snapshot, as_of):
                continue
            x = build_features(snapshot, as_of)
            examples.append({"handle": snapshot["handle"], "asOf": as_of, "x": x,
                             "y": [rating_at(ratings, as_of + days * DAY) for days in HORIZONS],
                             "snapshot": snapshot})
    return examples


def split_examples(examples, train_end=None, test_start=None):
    dates = sorted({row["asOf"] for row in examples})
    if len(dates) < 8:
        raise ValueError("At least eight distinct snapshot dates are needed")
    train_end = train_end or dates[int(len(dates) * 0.6)]
    test_start = test_start or dates[int(len(dates) * 0.8)]
    if train_end >= test_start:
        raise ValueError("Training label cutoff must precede test snapshots")
    train = [r for r in examples if not held_out_user(r["handle"]) and r["asOf"] + 90 * DAY <= train_end]
    temporal = [r for r in examples if not held_out_user(r["handle"]) and r["asOf"] >= test_start]
    unseen = [r for r in examples if held_out_user(r["handle"]) and r["asOf"] >= test_start]
    if len(train) < 50 or not temporal or not unseen:
        raise ValueError("Insufficient train/temporal/unseen-user data (need >=50 train rows and both holdouts)")
    return train, temporal, unseen, {"trainLabelsEnd": train_end, "testStarts": test_start, "purgeDays": 90}


def array(rows):
    return np.asarray([row["x"] for row in rows], dtype=np.float64)


def evaluate(rows, models):
    x = array(rows)
    result = {"rows": len(rows), "users": len({r["handle"] for r in rows}), "horizons": {}}
    for h_index, horizon in enumerate(HORIZONS):
        actual = np.asarray([r["y"][h_index] for r in rows], dtype=np.float64)
        raw = np.column_stack([models[(horizon, q)].predict(x) for q in QUANTILES])
        ordered = np.sort(raw, axis=1)
        lower, median, upper = ordered.T
        unchanged = x[:, 0]
        # Historical contest momentum, extrapolated using observed 90-day participation.
        trend = unchanged + x[:, 4] * (x[:, 7] / 90 * horizon)
        absolute = np.abs(actual - median)
        bands = {}
        for label, lo, hi in (("under1200", -np.inf, 1200), ("1200to1899", 1200, 1900), ("1900plus", 1900, np.inf)):
            selected = (unchanged >= lo) & (unchanged < hi)
            if selected.any():
                bands[label] = {"rows": int(selected.sum()), "mae": float(absolute[selected].mean()),
                                "unchangedMae": float(np.abs(actual[selected] - unchanged[selected]).mean())}
        result["horizons"][str(horizon)] = {
            "mae": float(absolute.mean()), "medianAbsoluteError": float(np.median(absolute)),
            "unchangedMae": float(np.abs(actual - unchanged).mean()),
            "trendMae": float(np.abs(actual - trend).mean()),
            "intervalCoverage": float(np.mean((actual >= lower) & (actual <= upper))),
            "meanIntervalWidth": float(np.mean(upper - lower)),
            "quantileCrossingRate": float(np.mean(np.any(np.diff(raw, axis=1) < 0, axis=1))),
            "pinballLoss": {str(q): float(np.mean(np.maximum(q * (actual - raw[:, i]), (q - 1) * (actual - raw[:, i]))))
                            for i, q in enumerate(QUANTILES)},
            "ratingBands": bands,
        }
    return result


def passes_gate(report, min_rows=100, min_users=10):
    if report["rows"] < min_rows or report["users"] < min_users:
        return False
    for metrics in report["horizons"].values():
        baseline = min(metrics["unchangedMae"], metrics["trendMae"])
        if not metrics["mae"] < baseline * 0.97:
            return False
        if not 0.70 <= metrics["intervalCoverage"] <= 0.90:
            return False
        for band in metrics["ratingBands"].values():
            if band["rows"] >= 30 and band["mae"] > band["unchangedMae"] * 1.1:
                return False
    return True


def compact_snapshot(row):
    snapshot = row["snapshot"]
    as_of = row["asOf"]
    return {"ratings": [r for r in snapshot["ratings"] if r["ratingUpdateTimeSeconds"] <= as_of],
            "submissions": [s for s in snapshot["submissions"] if as_of - 90 * DAY < s["creationTimeSeconds"] <= as_of],
            "coverage": snapshot.get("coverage", {})}


def train(snapshots, output, version, mechanics_only=False, allow_retrospective=False, rounds=200,
          train_end=None, test_start=None):
    import lightgbm as lgb

    rows = make_examples(snapshots)
    training, temporal, unseen, split = split_examples(rows, train_end, test_start)
    x = array(training)
    models = {}
    exported = []
    for index, horizon in enumerate(HORIZONS):
        y = np.asarray([r["y"][index] for r in training], dtype=np.float64)
        dataset = lgb.Dataset(x, label=y, feature_name=list(FEATURE_NAMES), free_raw_data=False)
        for quantile in QUANTILES:
            model = lgb.train({"objective": "quantile", "alpha": quantile, "learning_rate": 0.05,
                               "num_leaves": 15, "min_data_in_leaf": 20, "max_bin": 63,
                               "verbosity": -1, "seed": 42, "num_threads": 1,
                               "deterministic": True, "force_col_wise": True}, dataset, num_boost_round=rounds)
            models[(horizon, quantile)] = model
            exported.append({"horizonDays": horizon, "quantile": quantile, "trees": export_booster(model)})
    validation_rows = temporal + unseen
    parity_error = 0.0
    for entry in exported:
        native = models[(entry["horizonDays"], entry["quantile"])].predict(array(validation_rows))
        converted = np.asarray([predict(entry["trees"], r["x"]) for r in validation_rows])
        parity_error = max(parity_error, float(np.max(np.abs(native - converted))))
    temporal_report = evaluate(temporal, models)
    unseen_report = evaluate(unseen, models)
    genuine = all(s.get("source") == "codeforces-public-api" for s in snapshots)
    gate = {"temporalPassed": passes_gate(temporal_report), "usersPassed": passes_gate(unseen_report),
            "parityPassed": parity_error <= 1e-7, "retrospectiveMetadata": True,
            "runtimeParityPassed": False,
            "genuineData": genuine, "mechanicsOnly": mechanics_only,
            "retrospectiveAcknowledged": allow_retrospective}
    validated = all(gate[k] for k in ("temporalPassed", "usersPassed", "parityPassed", "runtimeParityPassed", "genuineData")) \
        and not mechanics_only and allow_retrospective
    model = {"schemaVersion": 1, "version": version, "featureNames": FEATURE_NAMES,
             "validated": validated, "trainedAt": datetime.now(timezone.utc).isoformat(),
             "minimumContests": 3, "minimumHistoryDays": 90, "gate": gate, "models": exported}
    model["ratingRange"] = [float(x[:, 0].min()), float(x[:, 0].max())]
    report = {"version": version, "validated": validated, "trainingRows": len(training),
              "trainingUsers": len({r["handle"] for r in training}), "split": split,
              "temporal": temporal_report, "heldOutUsers": unseen_report, "gate": gate,
              "nativeExportMaxError": parity_error,
              "limitations": [
                  "Problem ratings/tags reflect collection time; historical backtests use retrospective metadata.",
                  "Accepted submissions do not measure time studying, outside practice, or solution copying.",
                  "Intervals are quantile estimates with held-out coverage checks, not a universal coverage guarantee.",
                  "Repeated snapshots share users and are correlated; row counts are not independent sample counts.",
                  "No causal claim is made about changing daily practice volume.",
              ],
              "gateSpecification": {"minRowsPerHoldout": 100, "minUsersPerHoldout": 10,
                                    "minimumMaeImprovement": 0.03, "coverageRange": [0.7, 0.9],
                                    "subgroupMaxMaeRatio": 1.1, "subgroupMinimumRows": 30}}
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    atomic_json(output / "model.json", model)
    atomic_json(output / "report.json", report)
    fixture = {"source": "native-lightgbm", "model": model, "samples": []}
    for row in validation_rows[::max(1, len(validation_rows) // 8)][:8]:
        fixture["samples"].append({"snapshot": compact_snapshot(row), "asOf": row["asOf"], "features": row["x"],
                                   "predictions": [{"horizonDays": h, "quantile": q,
                                                    "value": float(models[(h, q)].predict(np.asarray([row["x"]]))[0])}
                                                   for h in HORIZONS for q in QUANTILES]})
    atomic_json(output / "parity.json", fixture)
    # Run the actual shipped TypeScript preprocessing/evaluator against native
    # LightGBM outputs. An absent Node environment leaves the artifact disabled.
    repository = Path(__file__).resolve().parents[1]
    vitest = repository / "node_modules" / ".bin" / "vitest"
    if vitest.exists():
        environment = dict(os.environ, CFCHART_PARITY_FIXTURE=str((output / "parity.json").resolve()))
        try:
            result = subprocess.run([str(vitest), "run", "src/ml/__tests__/forecast.test.ts"],
                                    cwd=repository, env=environment, capture_output=True, text=True, timeout=120)
            gate["runtimeParityPassed"] = result.returncode == 0
            if result.returncode:
                report["runtimeParityError"] = result.stdout[-4000:] + result.stderr[-4000:]
        except (OSError, subprocess.TimeoutExpired) as error:
            report["runtimeParityError"] = str(error)
    else:
        report["runtimeParityError"] = "Install project Node dependencies to verify the TypeScript runtime"
    model["validated"] = report["validated"] = all(gate[k] for k in (
        "temporalPassed", "usersPassed", "parityPassed", "runtimeParityPassed", "genuineData")) \
        and not mechanics_only and allow_retrospective
    atomic_json(output / "model.json", model)
    atomic_json(output / "report.json", report)
    atomic_json(output / "parity.json", fixture)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, required=True, help="Collector output directory")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--version", required=True, help="Version label, e.g. cfchart-2026-11-10-v1")
    parser.add_argument("--mechanics-only", action="store_true", help="Force non-deployable output for experiments")
    parser.add_argument("--allow-retrospective-metadata", action="store_true", help="Acknowledge historical ratings/tags limitation; required for validated export")
    parser.add_argument("--rounds", type=int, default=200)
    parser.add_argument("--train-end", type=int, help="Optional fixed UTC epoch seconds; all training labels must end by this date")
    parser.add_argument("--test-start", type=int, help="Optional fixed UTC epoch seconds; holdouts start here")
    args = parser.parse_args()
    if args.rounds < 1:
        parser.error("rounds must be positive")
    snapshots = [json.loads(path.read_text()) for path in sorted((args.data / "users").glob("*.json"))]
    if not snapshots:
        parser.error("No collected user snapshots found under data/users")
    try:
        report = train(snapshots, args.output, args.version, args.mechanics_only,
                       args.allow_retrospective_metadata, args.rounds, args.train_end, args.test_start)
    except ValueError as error:
        parser.error(str(error))
    print(json.dumps({"validated": report["validated"], "gate": report["gate"], "output": str(args.output)}, indent=2))


if __name__ == "__main__":
    main()
