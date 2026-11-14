import unittest
from .evaluate import (
    doubly_robust,
    snips_estimate,
    direct_method_estimate,
    policy_overlap_diagnostics,
)
from .parity_audit import generate_parity_fixtures, build_acceptance_features_py
from .trial import analyze_trial


class EvaluationTests(unittest.TestCase):
    def test_known_randomized_value(self):
        rows = [
            dict(
                user=str(i),
                action=a,
                outcome=int(a == 'a'),
                logging={'a': 0.5, 'b': 0.5},
                target={'a': 1.0, 'b': 0.0},
                predictions={'a': 1.0, 'b': 0.0},
            )
            for i, a in enumerate(['a', 'b'] * 10)
        ]
        result = doubly_robust(rows, 100)
        self.assertEqual(result['value'], 1.0)
        self.assertEqual(result['effectiveEpisodes'], 10.0)
        self.assertFalse(result['causalRatingGain'])

        snips = snips_estimate(rows, 100)
        self.assertAlmostEqual(snips['value'], 1.0)
        self.assertEqual(snips['effectiveEpisodes'], 10.0)
        self.assertFalse(snips['causalRatingGain'])

        dm = direct_method_estimate(rows, 100)
        self.assertAlmostEqual(dm['value'], 1.0)
        self.assertFalse(dm['causalRatingGain'])

        overlap = policy_overlap_diagnostics(rows)
        self.assertEqual(overlap['episodes'], 20)
        self.assertAlmostEqual(overlap['effectiveEpisodes'], 10.0)
        self.assertAlmostEqual(overlap['effectiveSampleRatio'], 0.5)
        self.assertTrue(overlap['overlapAdequate'])

    def test_no_support_is_rejected(self):
        bad_row = [
            dict(
                user='a',
                action='a',
                outcome=1,
                logging={'a': 1.0, 'b': 0.0},
                target={'a': 0.0, 'b': 1.0},
                predictions={'a': 1.0, 'b': 0.0},
            )
        ]
        with self.assertRaisesRegex(ValueError, 'support'):
            doubly_robust(bad_row)
        with self.assertRaisesRegex(ValueError, 'support'):
            snips_estimate(bad_row)
        with self.assertRaisesRegex(ValueError, 'support'):
            policy_overlap_diagnostics(bad_row)

    def test_analyze_trial_computes_itt_difference_and_tracks_missingness(self):
        rows = [
            {'user': 'u1', 'arm': 0, 'baselineRating': 1400, 'followupRating': 1450, 'completeFollowup': True},
            {'user': 'u2', 'arm': 0, 'baselineRating': 1500, 'followupRating': 1510, 'completeFollowup': True},
            {'user': 'u3', 'arm': 1, 'baselineRating': 1400, 'followupRating': 1500, 'completeFollowup': True},
            {'user': 'u4', 'arm': 1, 'baselineRating': 1500, 'followupRating': 1580, 'completeFollowup': True},
            {'user': 'u5', 'arm': 1, 'baselineRating': 1600, 'followupRating': None, 'completeFollowup': False},
        ]
        res = analyze_trial(rows, replicates=200)
        self.assertAlmostEqual(res['differenceInMeanGain'], 60.0)  # (100+80)/2 - (50+10)/2 = 90 - 30 = 60
        self.assertEqual(res['missingUsers'][1], 1)
        self.assertEqual(res['missingUsers'][0], 0)
        self.assertTrue(res['incompleteFollowup'])
        self.assertFalse(res['causalClaimAllowed'])

    def test_analyze_trial_rejects_repeated_users(self):
        rows = [
            {'user': 'u1', 'arm': 0, 'baselineRating': 1400, 'followupRating': 1450, 'completeFollowup': True},
            {'user': 'u1', 'arm': 0, 'baselineRating': 1400, 'followupRating': 1450, 'completeFollowup': True},
        ]
        with self.assertRaisesRegex(ValueError, 'Repeated users'):
            analyze_trial(rows)

    def test_parity_audit_fixtures_respect_boundaries_and_censoring(self):
        fixtures = generate_parity_fixtures()
        self.assertEqual(len(fixtures['cases']), 3)
        self.assertEqual(fixtures['cases'][0]['features'], [0.0, 0.5, 3, 2, 2, 5.0, 3])
        self.assertAlmostEqual(fixtures['cases'][0]['probability'], 0.8657825564820225, places=12)
        # Attempted problem is excluded from first-attempt features
        attempted_prob = {'contestId': 13, 'index': 'C', 'name': 'Censored', 'rating': 1700, 'tags': ['dp']}
        self.assertIsNone(
            build_acceptance_features_py(
                attempted_prob,
                fixtures['submissions'],
                fixtures['ratings'],
                fixtures['asOfMs'],
            )
        )


if __name__ == '__main__':
    unittest.main()
