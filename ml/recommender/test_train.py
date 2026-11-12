import json
from pathlib import Path
import tempfile
import unittest
from .train import load_rows_from_exports, load_rows_from_cohort, train, fit, metrics, passes_deployment_gate

# Backward compatibility alias
load_rows = load_rows_from_exports


class PipelineTests(unittest.TestCase):
    def test_deployment_requires_improvement_on_both_holdouts(self):
        good = {'rows': 200, 'users': 20, 'logLoss': .4, 'brier': .14, 'calibrationError': .04}
        baseline = dict(good, logLoss=.5, brier=.2)
        split = {'baseline': baseline, 'candidate': good}
        evaluation = {'future': split, 'unseenUsers': split, 'stratified': {}, 'stratifiedBaseline': {}}
        self.assertTrue(passes_deployment_gate(evaluation))
        evaluation['unseenUsers'] = {'baseline': baseline, 'candidate': dict(good, brier=.21)}
        self.assertFalse(passes_deployment_gate(evaluation))

    def export(self, root, events):
        problem = {'contestId': 1, 'index': 'A', 'rating': 1500, 'slot': 'core', 'plannedMinutes': 30}
        records = [dict(version=1, id=str(i), problemKey='1-A', timestamp=2000+i, provenance='self-report',
                        problem=problem, **e) for i, e in enumerate(events)]
        data = {'version': 1, 'handle': 'Alice', 'ledger': {'version': 1, 'events': records, 'assignments': [
            {'timestamp': 1000, 'problem': problem, 'rating': 1400, 'historyComplete': True}]}}
        (Path(root)/'export.json').write_text(json.dumps(data))

    def test_ambiguous_outcomes_are_not_failures(self):
        with tempfile.TemporaryDirectory() as root:
            self.export(root, [{'outcome': 'assisted', 'minutes': 30}, {'outcome': 'interrupted', 'minutes': 30},
                               {'outcome': 'independent'}, {'outcome': 'timeout', 'minutes': 30}])
            rows, excluded = load_rows_from_exports(root)
            self.assertEqual([r['y'] for r in rows], [0])
            self.assertEqual(excluded['ambiguous_reference_budget_outcome'], 2)
            self.assertEqual(excluded['unknown_or_invalid_minutes'], 1)

    def test_insufficient_data_cannot_deploy(self):
        with tempfile.TemporaryDirectory() as root:
            self.export(root, [{'outcome': 'independent', 'minutes': 20}])
            report = train(root, Path(root)/'output', 3000, source_type='exports')
            self.assertEqual(report['status'], 'insufficient_data')
            self.assertFalse(report['deploymentAllowed'])
            self.assertIsNone(json.loads((Path(root)/'output/candidate.json').read_text())['weights'])

    def test_duplicate_exports_do_not_multiply_evidence(self):
        with tempfile.TemporaryDirectory() as root:
            self.export(root, [{'outcome': 'independent', 'minutes': 20}])
            (Path(root)/'copy.json').write_text((Path(root)/'export.json').read_text())
            rows, excluded = load_rows_from_exports(root)
            self.assertEqual(len(rows), 1)
            self.assertEqual(excluded['duplicate_event'], 1)

    def test_fit_learns_and_difficulty_remains_monotone(self):
        rows = [{'x': [1., x, 0.], 'y': int(x < 0), 'user': str(i)}
                for i, x in enumerate([-1., -.5, .5, 1.]*30)]
        weights = fit(rows)
        self.assertLessEqual(weights[1], 0)
        self.assertLess(metrics(rows, weights)['logLoss'], metrics(rows, [0, 0, 0])['logLoss'])

    def test_cohort_loading_does_not_infer_assistance_or_thinking_time(self):
        with tempfile.TemporaryDirectory() as root:
            user_data = {
                'handle': 'Bob',
                'ratings': [{'contestId': 10, 'ratingUpdateTimeSeconds': 1000, 'oldRating': 1200, 'newRating': 1300}],
                'submissions': [
                    {'id': 1, 'creationTimeSeconds': 1500, 'problem': {'contestId': 10, 'index': 'A', 'rating': 1200, 'tags': ['math']}, 'verdict': 'WRONG_ANSWER'},
                    {'id': 2, 'creationTimeSeconds': 1600, 'problem': {'contestId': 10, 'index': 'A', 'rating': 1200, 'tags': ['math']}, 'verdict': 'OK'},
                    {'id': 3, 'creationTimeSeconds': 1700, 'problem': {'contestId': 10, 'index': 'B', 'rating': 1400, 'tags': ['dp']}, 'verdict': 'WRONG_ANSWER'},
                ]
            }
            (Path(root)/'bob.json').write_text(json.dumps(user_data))
            rows, excluded = load_rows_from_cohort(root)
            # 2 problems attempted: 10-A (OK) and 10-B (unsolved)
            self.assertEqual(len(rows), 2)
            by_key = {r['key']: r for r in rows}
            self.assertEqual(by_key['10-A']['y'], 1)
            self.assertEqual(by_key['10-B']['y'], 0)
            # Repeated submissions on 10-A are grouped into 1 episode (earliest attempt preserved)
            self.assertEqual(by_key['10-A']['at'], 1500 * 1000)
            self.assertEqual(by_key['10-A']['observed'], 1600 * 1000)
            self.assertEqual(by_key['10-A']['x_boost'][2:4], [0, 0])
            self.assertEqual(by_key['10-B']['x_boost'][2:4], [1, 1])


if __name__ == '__main__':
    unittest.main()
