"""Research candidate: calibrated boosted trees for historical attempt acceptance.

This model is deliberately not installed in the extension. Public API attempts do
not reveal recommendation impressions or independent solving.
"""
import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from scipy.optimize import minimize
from scipy.special import expit, logit

from ml.export import export_booster, predict as predict_export
from .train import fit, load_rows_from_cohort, predict as predict_logistic, passes_deployment_gate

FEATURES = ['relative_difficulty_400', 'rating_centered_1400_400',
            'recent_attempts_90', 'recent_solved_90', 'recent_tag_solved_90',
            'days_since_attempt', 'problem_tag_count']


def summary(rows, probabilities):
    if not rows: return None
    y = np.asarray([r['y'] for r in rows], dtype=np.float64)
    p = np.clip(np.asarray(probabilities), 1e-8, 1-1e-8)
    reliability = []
    for i in range(10):
        mask = (p >= i/10) & (p < (i+1)/10)
        if mask.any():
            reliability.append({'bin': i, 'n': int(mask.sum()),
                                'predicted': float(p[mask].mean()), 'observed': float(y[mask].mean())})
    return {'rows': len(rows), 'users': len({r['user'] for r in rows}),
            'logLoss': float(np.mean(-y*np.log(p)-(1-y)*np.log(1-p))),
            'brier': float(np.mean((p-y)**2)),
            'calibrationError': float(sum(v['n']*abs(v['predicted']-v['observed']) for v in reliability)/len(rows)),
            'reliability': reliability}


def platt_fit(raw, outcomes):
    z = logit(np.clip(raw, 1e-6, 1-1e-6))
    y = np.asarray(outcomes, dtype=np.float64)
    def objective(coefficients):
        score = coefficients[0] + coefficients[1]*z
        loss = np.logaddexp(0, score).mean() - np.dot(y, score)/len(y)
        gradient = np.asarray([np.mean(expit(score)-y), np.mean((expit(score)-y)*z)])
        return float(loss), gradient
    result = minimize(objective, [0., 1.], jac=True, method='L-BFGS-B',
                      bounds=[(None,None), (0,None)], options={'maxiter':100})
    if not result.success: raise RuntimeError(f'Calibration failed: {result.message}')
    return result.x.tolist()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cohort',type=Path,default=Path('ml/data/top10000/users'))
    parser.add_argument('--output',type=Path,default=Path('ml/artifacts/top10000-recommender-boosted'))
    parser.add_argument('--calibration-start',default='2025-01-01')
    parser.add_argument('--test-start',default='2025-10-01')
    parser.add_argument('--episodes-per-user',type=int,default=100)
    parser.add_argument('--rounds',type=int,default=150)
    args=parser.parse_args()
    if args.episodes_per_user < 2 or args.rounds < 1: parser.error('episodes-per-user must be >=2 and rounds positive')
    import lightgbm as lgb
    to_ms=lambda d:int(datetime.fromisoformat(d+'T00:00:00+00:00').timestamp()*1000)
    calibration_start,test_start=to_ms(args.calibration_start),to_ms(args.test_start)
    if calibration_start >= test_start: parser.error('calibration must start before test')
    rows,excluded=load_rows_from_cohort(args.cohort,episodes_per_user=args.episodes_per_user)
    unseen=lambda r:int(r['user'][:8],16)%5==0
    fit_rows=[r for r in rows if not unseen(r) and r['observed']<calibration_start]
    calibration=[r for r in rows if not unseen(r) and r['at']>=calibration_start and r['observed']<test_start]
    future=[r for r in rows if not unseen(r) and r['at']>=test_start]
    heldout=[r for r in rows if unseen(r) and r['at']>=test_start]
    if min(len(fit_rows),len(calibration),len(future),len(heldout))<100:
        raise ValueError('Insufficient rows in one of the frozen splits')
    print(f'Fit {len(fit_rows):,}; calibrate {len(calibration):,}; future {len(future):,}; unseen {len(heldout):,}',flush=True)
    baseline_weights=fit(fit_rows)
    x=np.asarray([r['x_boost'] for r in fit_rows],dtype=np.float32)
    y=np.asarray([r['y'] for r in fit_rows],dtype=np.int8)
    booster=lgb.train({'objective':'binary','learning_rate':.05,'num_leaves':15,
                       'min_data_in_leaf':100,'verbosity':-1,'num_threads':1,
                       'seed':42,'deterministic':True,'force_col_wise':True,
                       'monotone_constraints':[-1,0,0,0,0,0,0]},
                      lgb.Dataset(x,label=y,feature_name=FEATURES),num_boost_round=args.rounds)
    def raw_predict(items):
        return booster.predict(np.asarray([r['x_boost'] for r in items],dtype=np.float32))
    print('Calibrating on the reserved pre-test period...',flush=True)
    raw_calibration=raw_predict(calibration)
    intercept,slope=platt_fit(raw_calibration,[r['y'] for r in calibration])
    def calibrated(items):
        raw=raw_predict(items)
        return expit(intercept+slope*logit(np.clip(raw,1e-6,1-1e-6)))
    evaluation={}
    for name,items in [('future',future),('unseenUsers',heldout)]:
        evaluation[name]={'baseline':summary(items,[predict_logistic(baseline_weights,r) for r in items]),
                          'candidate':summary(items,calibrated(items))}
    evaluation['stratified']={};evaluation['stratifiedBaseline']={}
    for name,lo,hi in [('<1200',0,1200),('1200-1500',1200,1500),('1500-1800',1500,1800),('1800+',1800,float('inf'))]:
        items=[r for r in heldout if lo<=r['rating']<hi]
        if items:
            evaluation['stratified'][name]=summary(items,calibrated(items))
            evaluation['stratifiedBaseline'][name]=summary(items,[predict_logistic(baseline_weights,r) for r in items])
    trees=export_booster(booster)
    samples=fit_rows[:32]
    parity=max(abs(float(booster.predict(np.asarray([r['x_boost']],dtype=np.float32))[0])-expit(predict_export(trees,r['x_boost']))) for r in samples)
    gates_pass=bool(passes_deployment_gate(evaluation) and parity<1e-6)
    artifact={'schemaVersion':1,'target':'historical_acceptance','features':FEATURES,
              'trees':trees,'calibration':{'intercept':intercept,'slope':slope},
              'validatedOffline':gates_pass,'deploymentAllowed':False,
              'reason':'No TypeScript runtime parity or actual recommendation-policy evaluation yet'}
    report={'fitRows':len(fit_rows),'calibrationRows':len(calibration),'futureRows':len(future),
            'unseenRows':len(heldout),'excluded':excluded,'evaluation':evaluation,
            'nativeExportMaxError':parity,'offlineGatePassed':gates_pass,
            'deploymentAllowed':False,'calibrationStart':calibration_start,'testStart':test_start,
            'limitations':['Observed acceptance on self-selected attempts, not independent solving.',
                           'No logged recommendation impressions; ranking quality cannot be inferred.',
                           'Problem ratings and tags may reflect collection-time metadata.']}
    args.output.mkdir(parents=True,exist_ok=True)
    (args.output/'candidate.json').write_text(json.dumps(artifact,separators=(',',':')))
    (args.output/'report.json').write_text(json.dumps(report,indent=2))
    print(json.dumps({'offlineGatePassed':gates_pass,'nativeExportMaxError':parity,
                      'future':evaluation['future'],'unseenUsers':evaluation['unseenUsers']},indent=2),flush=True)


if __name__=='__main__':main()
