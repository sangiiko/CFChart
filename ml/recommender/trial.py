"""Analyze completed user-randomized trials, retaining inactive participants.

Input is one record per assigned user with baselineRating, followupRating (null
only for genuinely missing follow-up), arm, user, and completeFollowup boolean.
No-contest follow-up must supply baselineRating again and completeFollowup=true.
This simple unadjusted intention-to-treat comparator does not implement ANCOVA.
"""
import random
import math


def analyze_trial(rows, replicates=2000, seed=0):
    seen, groups, missing = set(), {0: [], 1: []}, {0: 0, 1: 0}
    for row in rows:
        if row['user'] in seen:
            raise ValueError('Repeated users are not independent trial units')
        seen.add(row['user'])
        arm = row['arm']
        if arm not in groups:
            raise ValueError('Invalid randomized arm')
        if not row['completeFollowup'] or row['followupRating'] is None:
            missing[arm] += 1
            continue
        values = [row['baselineRating'], row['followupRating']]
        if any(not isinstance(x,(float,int)) or not math.isfinite(x) for x in values):
            raise ValueError('Invalid rating; unrated entrants need a different endpoint')
        groups[arm].append(values[1]-values[0])
    if any(len(g)<2 for g in groups.values()):
        raise ValueError('At least two observed users per arm required for mechanics')
    mean = lambda values: sum(values)/len(values)
    rng = random.Random(seed)
    samples = sorted(mean(rng.choices(groups[1],k=len(groups[1])))-mean(rng.choices(groups[0],k=len(groups[0]))) for _ in range(replicates))
    return {'differenceInMeanGain': mean(groups[1])-mean(groups[0]),
            'interval95': [samples[int(.025*replicates)], samples[min(replicates-1,int(.975*replicates))]],
            'observedUsers': {k:len(v) for k,v in groups.items()}, 'missingUsers': missing,
            'incompleteFollowup': any(missing.values()), 'causalClaimAllowed': False,
            'requiredReview': 'Verify randomization, preregistration, power, missingness sensitivity, participation and burden guardrails.'}
