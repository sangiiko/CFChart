import unittest
from .evaluate import doubly_robust
from .trial import analyze_trial


class EvaluationTests(unittest.TestCase):
    def test_known_randomized_value(self):
        rows = [dict(user=str(i), action=a, outcome=int(a == 'a'), logging={'a': .5, 'b': .5},
                     target={'a': 1., 'b': 0.}, predictions={'a': 1., 'b': 0.}) for i, a in enumerate(['a', 'b'] * 10)]
        result = doubly_robust(rows, 100)
        self.assertEqual(result['value'], 1.)
        self.assertEqual(result['effectiveEpisodes'], 10.)
        self.assertFalse(result['causalRatingGain'])

    def test_no_support_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'support'):
            doubly_robust([dict(user='a', action='a', outcome=1, logging={'a': 1., 'b': 0.},
                                target={'a': 0., 'b': 1.}, predictions={'a': 1., 'b': 0.})])

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
