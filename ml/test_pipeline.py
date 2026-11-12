"""Mechanics tests use synthetic data and must never produce deployed weights."""
import json
import tempfile
import unittest
from pathlib import Path

from .collect import BudgetExhausted, collect_handle
from .export import evaluate_tree, export_tree
from .features import DAY, FEATURE_NAMES, build_features, covers_history
from .train import held_out_user, make_examples, passes_gate, split_examples, train
from .install import install


def synthetic_snapshots():
    snapshots = []
    start = 1609459200
    for user in range(30):
        ratings = []
        submissions = []
        rating = 950 + user * 35
        for contest in range(40):
            next_rating = rating + ((contest + user) % 7 - 2) * 6
            ratings.append({"contestId": contest, "contestName": f"Synthetic {contest}", "handle": f"fixture{user}",
                            "rank": 500, "ratingUpdateTimeSeconds": start + contest * 28 * DAY,
                            "oldRating": rating, "newRating": next_rating})
            rating = next_rating
            for problem in range(3):
                submissions.append({"id": contest * 3 + problem, "creationTimeSeconds": start + contest * 28 * DAY + problem * DAY,
                                    "verdict": "OK", "author": {"participantType": "PRACTICE"},
                                    "problem": {"contestId": contest, "index": str(problem), "name": "Synthetic fixture task",
                                                "rating": rating + problem * 100, "tags": ["math"]}})
        snapshots.append({"source": "synthetic-mechanics-fixture", "handle": f"fixture{user}",
                          "ratings": ratings, "submissions": submissions, "coverage": {"complete": True},
                          "ratingsFetchedAt": start + 41 * 28 * DAY, "submissionsFetchedAt": start + 41 * 28 * DAY})
    return snapshots


class PipelineTests(unittest.TestCase):
    def test_collection_preserves_partial_progress_and_resumes_without_duplicates(self):
        class FakeClient:
            def __init__(self, pages):
                self.pages = iter(pages)

            def request(self, method, **params):
                value = next(self.pages)
                if isinstance(value, Exception):
                    raise value
                return value

        with tempfile.TemporaryDirectory(prefix="cfchart-collector-test-") as directory:
            path = Path(directory) / "fixture.json"
            rows = [{"id": i, "creationTimeSeconds": 100 + i} for i in (1, 2)]
            with self.assertRaises(BudgetExhausted):
                collect_handle(FakeClient([[], rows, BudgetExhausted()]), path, "fixture", 2)
            partial = json.loads(path.read_text())
            self.assertEqual(partial["nextFrom"], 3)
            self.assertFalse(partial["coverage"]["complete"])
            collect_handle(FakeClient([[rows[0]]]), path, "fixture", 2)
            completed = json.loads(path.read_text())
            self.assertTrue(completed["coverage"]["complete"])
            self.assertEqual(len(completed["submissions"]), 2)

    def test_as_of_features_ignore_future_and_current_peak(self):
        snapshot = synthetic_snapshots()[0]
        as_of = snapshot["ratings"][5]["ratingUpdateTimeSeconds"]
        before = build_features(snapshot, as_of)
        snapshot["ratings"][-1]["newRating"] = 9999
        self.assertEqual(before, build_features(snapshot, as_of))
        self.assertEqual(len(before), len(FEATURE_NAMES))
        self.assertEqual(before[2], 6)
        self.assertFalse(covers_history({"coverage": {}}, as_of))
        self.assertTrue(covers_history(snapshot, as_of))

    def test_split_purges_future_labels_and_users(self):
        training, temporal, unseen, split = split_examples(make_examples(synthetic_snapshots()))
        self.assertTrue(all(r["asOf"] + 90 * DAY <= split["trainLabelsEnd"] for r in training))
        self.assertTrue(all(r["asOf"] >= split["testStarts"] for r in temporal + unseen))
        self.assertTrue(all(not held_out_user(r["handle"]) for r in training + temporal))
        self.assertTrue(all(held_out_user(r["handle"]) for r in unseen))
        self.assertFalse({r["handle"] for r in training} & {r["handle"] for r in unseen})

    def test_windowed_feature_extraction_matches_full_history(self):
        snapshot = synthetic_snapshots()[0]
        rows = make_examples([snapshot])
        for row in rows:
            self.assertEqual(row["x"], build_features(snapshot, row["asOf"]))

    def test_numeric_export_semantics_and_rejects_categories(self):
        node = {"split_feature": 0, "threshold": 1.5, "decision_type": "<=", "missing_type": "NaN",
                "default_left": True, "left_child": {"leaf_value": 3}, "right_child": {"leaf_value": -1}}
        tree = export_tree(node)
        self.assertEqual(evaluate_tree(tree, [1.5]), 3)
        self.assertEqual(evaluate_tree(tree, [2]), -1)
        self.assertEqual(evaluate_tree(tree, [float("nan")]), 3)
        with self.assertRaises(ValueError):
            export_tree(dict(node, decision_type="=="))

    def test_gate_rejects_tiny_or_badly_covered_data(self):
        good = {"rows": 100, "users": 10, "horizons": {"30": {
            "mae": 9, "unchangedMae": 10, "trendMae": 11, "intervalCoverage": 0.8, "ratingBands": {}}}}
        self.assertTrue(passes_gate(good))
        self.assertFalse(passes_gate(dict(good, users=9)))
        good["horizons"]["30"]["intervalCoverage"] = 1
        self.assertFalse(passes_gate(good))
        good["horizons"]["30"]["intervalCoverage"] = 0.8
        good["horizons"]["30"]["mae"] = 9.8
        self.assertFalse(passes_gate(good))
        good["horizons"]["30"]["mae"] = 9
        good["horizons"]["30"]["ratingBands"] = {"under1200": {"rows": 30, "mae": 12, "unchangedMae": 10}}
        self.assertFalse(passes_gate(good))

    def test_training_export_native_and_runtime_parity(self):
        try:
            import lightgbm  # noqa: F401
        except ImportError:
            self.skipTest("Install ml/requirements.txt to test actual LightGBM training")
        with tempfile.TemporaryDirectory(prefix="cfchart-ml-test-") as directory:
            report = train(synthetic_snapshots(), directory, "synthetic-test-only", mechanics_only=True, rounds=6)
            model = json.loads((Path(directory) / "model.json").read_text())
            self.assertFalse(model["validated"])
            self.assertFalse(report["gate"]["genuineData"])
            self.assertTrue(report["gate"]["parityPassed"])
            self.assertTrue(report["gate"]["runtimeParityPassed"], report.get("runtimeParityError"))
            self.assertEqual(len(model["models"]), 6)
            with self.assertRaises(ValueError):
                install(directory, Path(__file__).resolve().parents[1])


if __name__ == "__main__":
    unittest.main()
