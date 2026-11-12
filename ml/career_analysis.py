"""Compare historical practice and rating growth in top-cohort and comparison users.

Creates a self-contained HTML report plus machine-readable JSON. Uses historical
landmarks: prior 90-day activity predicts the next 180-day rating change.
"""
import argparse
import html
import json
import math
import random
import statistics
import time
from collections import defaultdict
from pathlib import Path

DAY = 86400


def quantile(values, q):
    if not values: return 0
    a=sorted(values); pos=(len(a)-1)*q; lo=int(pos); hi=min(lo+1,len(a)-1)
    return a[lo]*(hi-pos)+a[hi]*(pos-lo)


def make_rows(path, is_top):
    try: d=json.loads(path.read_text(encoding='utf-8'))
    except Exception: return []
    ratings=sorted(d.get('ratings',[]),key=lambda x:x.get('ratingUpdateTimeSeconds',0))
    subs=d.get('submissions',[])
    if not ratings: return []
    # One landmark every 180 days; rating is carried forward between contests.
    start=ratings[0]['ratingUpdateTimeSeconds']+365*DAY
    end=min(d.get('ratingsFetchedAt',0),d.get('submissionsFetchedAt',0))-180*DAY
    if end<=start:return []
    rows=[]; ri=0; current=None
    landmarks=list(range(start,end+1,180*DAY))
    for ts in landmarks:
        while ri<len(ratings) and ratings[ri]['ratingUpdateTimeSeconds']<=ts:
            current=ratings[ri]['newRating'];ri+=1
        if current is None:continue
        future=next((r['newRating'] for r in ratings if r['ratingUpdateTimeSeconds']>ts+180*DAY),None)
        # rating_at(ts + horizon): last rating by target date, carried forward
        future=current
        for r in ratings:
            if r['ratingUpdateTimeSeconds']>ts+180*DAY:break
            future=r['newRating']
        last_at=next((r['newRating'] for r in reversed(ratings) if r['ratingUpdateTimeSeconds']<=ts),current)
        past_subs=[s for s in subs if ts-90*DAY<s.get('creationTimeSeconds',0)<=ts]
        accepted={}
        for s in past_subs:
            if s.get('verdict')=='OK':
                p=s.get('problem') or {}; key=(p.get('contestId',s.get('contestId')),p.get('index'),p.get('name'))
                accepted[key]=s
        contests=sum(ts-90*DAY<r['ratingUpdateTimeSeconds']<=ts for r in ratings)
        rows.append({'handle':d.get('handle',path.stem),'top':is_top,'date':ts,'year':time.gmtime(ts).tm_year,
                     'rating':last_at,'gain':future-last_at,'accepted':len(accepted),'attempts':len(past_subs),
                     'active_days':len({s.get('creationTimeSeconds',0)//DAY for s in past_subs}),
                     'contests90':contests})
    return rows


def matched_summary(rows):
    # Match comparison and top-cohort windows on 100-point rating and 2-year calendar bins.
    groups=defaultdict(lambda:{'top':[],'control':[]})
    for r in rows:
        key=(int(r['rating']//100)*100,(r['year']//2)*2)
        groups[key]['top' if r['top'] else 'control'].append(r)
    matched=[]
    for key,g in groups.items():
        if not g['top'] or not g['control']:continue
        matched.append((key,g))
    return matched


def summarize(rows):
    bins=defaultdict(list)
    for r in rows:
        bins[(int(r['rating']//100)*100,(r['year']//2)*2,r['top'])].append(r)
    output=[]
    for (rating,period,top),group in bins.items():
        if len(group)<5:continue
        cut=quantile([r['accepted'] for r in group],.5)
        low=[r for r in group if r['accepted']<=cut]; high=[r for r in group if r['accepted']>cut]
        if not low or not high:continue
        output.append({'ratingBand':f'{rating}-{rating+99}','period':f'{period}-{period+1}',
          'group':'Top 10k' if top else 'Comparison','n':len(group),
          'lowPracticeN':len(low),'highPracticeN':len(high),
          'lowMedianAccepted90':statistics.median(r['accepted'] for r in low),
          'highMedianAccepted90':statistics.median(r['accepted'] for r in high),
          'lowMedianGain180':statistics.median(r['gain'] for r in low),
          'highMedianGain180':statistics.median(r['gain'] for r in high),
          'lowMedianContests90':statistics.median(r['contests90'] for r in low),
          'highMedianContests90':statistics.median(r['contests90'] for r in high)})
    return output


def report_html(summary, meta, output):
    # Combine strata with equal weight so large cohorts do not dominate all results.
    agg={}
    for group in ('Top 10k','Comparison'):
        cells=[s for s in summary if s['group']==group]
        agg[group]={k:(statistics.mean(s[k] for s in cells) if cells else 0) for k in ('lowMedianGain180','highMedianGain180','lowMedianAccepted90','highMedianAccepted90')}
        agg[group]['strata']=len(cells)
    cards=''.join(f'<article><span>{name}</span><b>{meta[key]:,}</b><small>{caption}</small></article>' for name,key,caption in [('Top 10k users','top_users','members with usable history'),('Comparison users','control_users','existing cohort outside top 10k'),('Matched rating/time strata','matched_strata','rating bands × two-year periods')])
    def panel(group):
        a=agg[group]; low=a['lowMedianGain180'];high=a['highMedianGain180']; mx=max(1,abs(low),abs(high),100)
        return f'<section class="panel"><h2>{group}</h2><p>{a["strata"]} matched strata · equal-weight average of stratum medians</p><div class="bars"><div><label>Lower practice: {a["lowMedianAccepted90"]:.0f} accepted problems / 90d</label><i style="width:{min(100,abs(low)/mx*100):.1f}%;background:#91a4c5"></i><b>{low:+.0f} rating pts / 180d</b></div><div><label>Higher practice: {a["highMedianAccepted90"]:.0f} accepted problems / 90d</label><i style="width:{min(100,abs(high)/mx*100):.1f}%;background:#4778ed"></i><b>{high:+.0f} rating pts / 180d</b></div></div></section>'
    top=panel('Top 10k'); control=panel('Comparison')
    table=''.join(f'<tr><td>{html.escape(s["group"])}</td><td>{s["ratingBand"]}</td><td>{s["period"]}</td><td>{s["n"]}</td><td>{s["lowMedianAccepted90"]:.0f} / {s["highMedianAccepted90"]:.0f}</td><td>{s["lowMedianGain180"]:+.0f} / {s["highMedianGain180"]:+.0f}</td><td>{s["lowMedianContests90"]:.0f} / {s["highMedianContests90"]:.0f}</td></tr>' for s in summary)
    doc=f'''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>CFChart Career Practice Analysis</title><style>*{{box-sizing:border-box}}body{{margin:0;background:#f2f5fa;color:#192642;font:15px/1.55 system-ui,sans-serif}}main{{max-width:1100px;margin:36px auto;padding:0 22px}}header{{padding:30px;border-radius:18px;color:white;background:linear-gradient(125deg,#142348,#3e67b7)}}header small{{opacity:.75;letter-spacing:2px;text-transform:uppercase}}h1{{margin:6px 0;font-size:30px}}header p{{margin:0;opacity:.85}}.cards{{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:16px 0}}article,.panel,.tablebox,.note{{background:#fff;border:1px solid #e3e9f2;border-radius:13px;padding:18px;box-shadow:0 5px 18px #25395b0c}}article span,article small{{display:block;color:#77849b;font-size:12px}}article b{{display:block;font-size:27px;margin:4px 0}}.grid{{display:grid;grid-template-columns:1fr 1fr;gap:14px}}h2{{margin:0 0 3px;font-size:17px}}.panel p{{margin:0;color:#78849a;font-size:12px}}.bars{{margin-top:20px}}.bars div{{margin:14px 0}}label{{display:block;font-size:12px;color:#5f6d84}}.bars i{{display:block;height:12px;border-radius:9px;margin:7px 0}}.bars b{{font-size:18px}}.tablebox{{margin-top:14px;overflow:auto}}table{{border-collapse:collapse;width:100%;font-size:12px}}td,th{{padding:9px;border-bottom:1px solid #edf0f5;text-align:right;white-space:nowrap}}td:first-child,th:first-child{{text-align:left}}.note{{margin-top:14px;color:#66748b;font-size:12px}}@media(max-width:700px){{.grid,.cards{{grid-template-columns:1fr}}}}</style></head><body><main><header><small>CFChart · Observational cohort study</small><h1>Practice before rating change</h1><p>Historical 90-day accepted-problem activity vs rating change in the following 180 days</p></header><div class="cards">{cards}</div><div class="grid">{top}{control}</div><section class="tablebox"><h2>Matched rating and calendar strata</h2><p>Higher vs lower practice split at each group’s within-stratum median.</p><table><thead><tr><th>Cohort</th><th>Starting rating</th><th>Period</th><th>Windows</th><th>Accepted problems low / high</th><th>Rating gain low / high</th><th>Contests low / high</th></tr></thead><tbody>{table}</tbody></table></section><aside class="note"><b>Interpretation:</b> These are associations among historical windows, not causal effects. Top-10k membership is based on current selection; the comparison group comes from the existing cohort and is not a random sample. Each user contributes repeated windows. The summary balances rating/time strata equally, but does not control motivation, study time, coaching, problem difficulty, or selection into contests. Problem tags and ratings may be retrospective. A positive rating change can include effects from contests after the practice window. Files parsed: {meta['parsed']:,}; unusable: {meta['skipped']:,}. Generated {time.strftime('%Y-%m-%d %H:%M %Z')}.</aside></main></body></html>'''
    output.parent.mkdir(parents=True,exist_ok=True);output.write_text(doc,encoding='utf-8')


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--top-data',type=Path,default=Path('ml/data/top10000/users'));p.add_argument('--comparison-data',type=Path,default=Path('ml/data/cohort/users'));p.add_argument('--output',type=Path,default=Path('ml/artifacts/career-analysis.html'));p.add_argument('--json',type=Path,default=Path('ml/artifacts/career-analysis.json'));args=p.parse_args()
    top_paths=list(args.top_data.glob('*.json')); control_paths=list(args.comparison_data.glob('*.json')); top_set={x.stem.lower() for x in top_paths};control_paths=[x for x in control_paths if x.stem.lower() not in top_set]
    print(f'Users to scan: top cohort {len(top_paths):,}; non-overlapping comparison {len(control_paths):,}',flush=True)
    rows=[]; bad=0; allp=[(x,True) for x in top_paths]+[(x,False) for x in control_paths]
    for i,(path,istop) in enumerate(allp,1):
        r=make_rows(path,istop)
        if r:rows.extend(r)
        else:bad+=1
        if i%100==0 or i==len(allp):print(f'\rProcessed {i:,}/{len(allp):,} users ({i*100/max(1,len(allp)):.1f}%) · historical windows {len(rows):,}',end='\n' if i==len(allp) else '',flush=True)
    summary=summarize(rows); matched=matched_summary(rows)
    meta={'top_users':len(top_paths),'control_users':len(control_paths),'parsed':len(allp)-bad,'skipped':bad,'windows':len(rows),'matched_strata':len(matched)}
    args.json.parent.mkdir(parents=True,exist_ok=True);args.json.write_text(json.dumps({'meta':meta,'strata':summary},indent=2),encoding='utf-8');report_html(summary,meta,args.output)
    print(json.dumps(meta,indent=2));print(f'HTML report: {args.output.resolve()}');print(f'JSON details: {args.json.resolve()}')

if __name__=='__main__':main()
