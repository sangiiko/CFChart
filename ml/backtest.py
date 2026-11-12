"""Backtest the bundled forecast model and write a standalone visual HTML report."""
import argparse
import html
import json
import math
from collections import defaultdict
from pathlib import Path

from .features import DAY, build_features, rating_at, covers_history
from .export import predict


def score(model, x):
    result = {}
    for entry in model["models"]:
        key = (entry["horizonDays"], entry["quantile"])
        result[key] = predict(entry["trees"], x)
    return result


def load_examples(data_dir, stride, model):
    paths = sorted((data_dir / "users").glob("*.json"))
    examples = []
    skipped = 0
    total = len(paths)
    print(f"Loading {total:,} user files; building and scoring historical snapshots...", flush=True)
    for file_index, path in enumerate(paths, 1):
        try:
            user = json.loads(path.read_text(encoding="utf-8"))
            ratings = sorted(user.get("ratings", []), key=lambda r: r["ratingUpdateTimeSeconds"])
            if not ratings:
                skipped += 1
                continue
            observed = min(user.get("ratingsFetchedAt", 0), user.get("submissionsFetchedAt", 0))
            start = (ratings[0]["ratingUpdateTimeSeconds"] // DAY + 91) * DAY
            stop = observed - 90 * DAY
            for as_of in range(start, int(stop) + 1, stride * DAY):
                past = [r for r in ratings if r["ratingUpdateTimeSeconds"] <= as_of]
                if len(past) < 3 or not covers_history(user, as_of):
                    continue
                actual = [rating_at(ratings, as_of + h * DAY) for h in (30, 90)]
                if any(v is None for v in actual):
                    continue
                x = build_features(user, as_of)
                predictions = score(model, x)
                examples.append({"handle": user.get("handle", path.stem), "asOf": as_of,
                                 "rating": x[0], "x": x, "actual": actual,
                                 "pred": [predictions[(h, .5)] for h in (30, 90)],
                                 "low": [predictions[(30, .05)], predictions[(90, .04)]],
                                 "high": [predictions[(30, .95)], predictions[(90, .96)]],
                                 "trend": [x[0] + x[4] * (x[7] / 90 * h) for h in (30, 90)]})
        except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
            skipped += 1
        if file_index == 1 or file_index % 25 == 0 or file_index == total:
            pct = file_index * 100 / max(total, 1)
            print(f"\r[{('=' * int(pct // 2)).ljust(50, '.')}] {pct:6.2f}% | users {file_index:,}/{total:,} | snapshots {len(examples):,} | skipped {skipped:,}", end="\n" if file_index == total else "\r", flush=True)
    return examples, len(paths), skipped


def stats(rows, idx):
    actual = [r["actual"][idx] for r in rows]
    pred = [r["pred"][idx] for r in rows]
    base = [r["rating"] for r in rows]
    trend = [r["trend"][idx] for r in rows]
    mae = lambda a, b: sum(abs(x-y) for x, y in zip(a, b)) / len(a)
    return {"mae": mae(actual, pred), "unchanged": mae(actual, base), "momentum": mae(actual, trend),
            "coverage": sum(r["low"][idx] <= r["actual"][idx] <= r["high"][idx] for r in rows) / len(rows),
            "width": sum(r["high"][idx] - r["low"][idx] for r in rows) / len(rows)}


def svg_chart(rows, idx, title):
    w, h, left, right, top, bottom = 820, 300, 58, 18, 28, 42
    actual = [r["actual"][idx] for r in rows]
    predicted = [r["pred"][idx] for r in rows]
    lowv = max(0, min(actual + predicted) - 150)
    highv = max(actual + predicted) + 150
    def px(i): return left + i * (w-left-right) / max(1, len(rows)-1)
    def py(v): return top + (highv-v) * (h-top-bottom) / max(1, highv-lowv)
    grid=[]
    for tick in range(int(lowv//500*500), int(highv+500), 500):
        y=py(tick)
        grid.append(f'<line x1="{left}" y1="{y:.1f}" x2="{w-right}" y2="{y:.1f}" stroke="#e8edf5"/><text x="{left-9}" y="{y+4:.1f}" text-anchor="end" class="axis">{tick}</text>')
    band=' '.join(f'{px(i):.1f},{py(r["low"][idx]):.1f}' for i,r in enumerate(rows))+' '+' '.join(f'{px(i):.1f},{py(r["high"][idx]):.1f}' for i,r in reversed(list(enumerate(rows))))
    actual_pts=' '.join(f'{px(i):.1f},{py(r["actual"][idx]):.1f}' for i,r in enumerate(rows))
    pred_pts=' '.join(f'{px(i):.1f},{py(r["pred"][idx]):.1f}' for i,r in enumerate(rows))
    return f'''<section class="chart"><div class="charthead"><h2>{title}</h2><span>Snapshots ordered by date · 80% prediction interval</span></div><svg viewBox="0 0 {w} {h}" role="img" aria-label="{title} historical forecasts versus actual ratings">{''.join(grid)}<polygon points="{band}" fill="#5d8ef0" opacity=".16"/><polyline points="{actual_pts}" fill="none" stroke="#17223b" stroke-width="2"/><polyline points="{pred_pts}" fill="none" stroke="#547ff2" stroke-width="2"/><text x="{left}" y="{h-10}" class="axis">Earlier snapshots</text><text x="{w-right}" y="{h-10}" text-anchor="end" class="axis">Later snapshots</text></svg><div class="legend"><i class="actual"></i> Actual rating <i class="forecast"></i> Model median <i class="interval"></i> Model interval</div></section>'''


def make_report(rows, model, users_seen, skipped, output):
    rows.sort(key=lambda r: r["asOf"])
    by_h = {h: stats(rows, i) for i,h in enumerate((30,90))}
    mae30=by_h[30]["mae"]
    improvement=100*(by_h[30]["unchanged"]-mae30)/by_h[30]["unchanged"] if by_h[30]["unchanged"] else 0
    cards=''.join(f'<article class="metric"><span>{label}</span><strong>{value}</strong><small>{caption}</small></article>' for label,value,caption in [
        ('Historical snapshots',f'{len(rows):,}',f'{len({r["handle"] for r in rows}):,} users scored'),
        ('30-day forecast MAE',f'{by_h[30]["mae"]:.0f} pts',f'{improvement:+.1f}% vs unchanged-rating baseline'),
        ('90-day forecast MAE',f'{by_h[90]["mae"]:.0f} pts',f'Baseline: {by_h[90]["unchanged"]:.0f} pts MAE'),
        ('80% interval coverage',f'{by_h[90]["coverage"]*100:.1f}%',f'90-day · average width {by_h[90]["width"]:.0f} pts')])
    table=''.join(f'<tr><th>{h} days</th><td>{m["mae"]:.1f}</td><td>{m["unchanged"]:.1f}</td><td>{m["momentum"]:.1f}</td><td>{m["coverage"]*100:.1f}%</td><td>{m["width"]:.1f}</td></tr>' for h,m in by_h.items())
    charts=svg_chart(rows,0,'30-day rating forecasts')+svg_chart(rows,1,'90-day rating forecasts')
    generated=__import__('datetime').datetime.now().astimezone().strftime('%Y-%m-%d %H:%M %Z')
    doc=f'''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>CFChart Forecast Backtest</title><style>
    *{{box-sizing:border-box}}body{{margin:0;background:#f3f6fb;color:#17223b;font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}}main{{max-width:1050px;margin:40px auto;padding:0 22px}}header{{padding:30px;border-radius:18px;background:linear-gradient(125deg,#15274d,#3159a9);color:white;box-shadow:0 15px 38px #243d752b}}.eyebrow{{font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:.72}}h1{{font-size:32px;margin:7px 0}}header p{{margin:0;opacity:.8}}.cards{{display:grid;grid-template-columns:repeat(4,1fr);gap:13px;margin:18px 0}}.metric,.chart,.tablebox,.note{{background:white;border:1px solid #e4eaf3;border-radius:14px;box-shadow:0 5px 18px #263c6410}}.metric{{padding:17px}}.metric span,.metric small{{display:block;color:#71809a;font-size:12px}}.metric strong{{display:block;font-size:27px;letter-spacing:-1px;margin:7px 0}}.chart{{padding:20px;margin:14px 0}}.charthead{{display:flex;justify-content:space-between;align-items:baseline;gap:10px}}h2{{font-size:17px;margin:0}}.charthead span,.axis,.legend{{font-size:11px;color:#7b879b}}svg{{width:100%;margin-top:12px}}.legend{{display:flex;align-items:center;gap:7px}}.legend i{{display:inline-block;width:18px;height:3px;margin-left:12px;background:#17223b}}.legend .forecast{{background:#547ff2}}.legend .interval{{height:10px;background:#d9e4ff}}.tablebox{{padding:20px;overflow:auto}}table{{border-collapse:collapse;width:100%;text-align:right;margin-top:12px}}th,td{{padding:10px;border-bottom:1px solid #edf0f5}}th:first-child,td:first-child{{text-align:left}}thead{{color:#74819a;font-size:12px}}.note{{margin-top:15px;padding:18px;color:#68758b;font-size:12px}}@media(max-width:720px){{.cards{{grid-template-columns:repeat(2,1fr)}}.charthead{{display:block}}h1{{font-size:25px}}}}@media print{{body{{background:white}}main{{margin:0 auto}}.metric,.chart,.tablebox{{box-shadow:none}}}}</style></head><body><main><header><div class="eyebrow">CFChart · Model audit</div><h1>Forecast backtest</h1><p>{html.escape(model.get('version','unknown'))} · generated {generated}</p></header><div class="cards">{cards}</div>{charts}<section class="tablebox"><h2>Baseline scorecard</h2><table><thead><tr><th>Horizon</th><th>Model MAE ↓</th><th>Stay-put MAE</th><th>Momentum MAE</th><th>Interval coverage</th><th>Mean interval</th></tr></thead><tbody>{table}</tbody></table></section><aside class="note">Evaluated {len(rows):,} historical snapshots from {len({r['handle'] for r in rows}):,} users ({users_seen:,} source files; {skipped} skipped). Snapshots require three prior contests, 90-day submission-history coverage, and matured outcomes. Problem difficulty and tags are current metadata applied retrospectively, so this is an exploratory backtest, not a prospective guarantee. Dates and snapshots may overlap for the same users.</aside></main></body></html>'''
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(doc,encoding='utf-8')
    return by_h


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data',type=Path,default=Path('ml/data/cohort'),help='Collected cohort directory')
    parser.add_argument('--model',type=Path,default=Path('src/ml/model.json'),help='Bundled model JSON')
    parser.add_argument('--output',type=Path,default=Path('ml/artifacts/backtest.html'))
    parser.add_argument('--stride-days',type=int,default=28,help='Days between historical snapshots')
    args=parser.parse_args()
    if args.stride_days < 1: parser.error('stride-days must be positive')
    model=json.loads(args.model.read_text(encoding='utf-8'))
    if not model.get('models') or not model.get('validated'):
        parser.error('The selected model has no weights or is not marked validated')
    print(f"Using model {model.get('version')} from {args.model}", flush=True)
    print(f"Reading cohort from {args.data} (snapshot stride: {args.stride_days} days)", flush=True)
    rows,n,skipped=load_examples(args.data,args.stride_days,model)
    if not rows: parser.error('No eligible matured historical snapshots found in the selected data')
    print(f"Scoring complete: {len(rows):,} eligible snapshots. Rendering HTML report...", flush=True)
    metrics=make_report(rows,model,n,skipped,args.output)
    print(f"Model: {model.get('version')} | users with history: {n:,} | snapshots scored: {len(rows):,}")
    for horizon,m in metrics.items():
        print(f"{horizon:>2}d MAE {m['mae']:.1f} | unchanged {m['unchanged']:.1f} | momentum {m['momentum']:.1f} | interval coverage {m['coverage']*100:.1f}%")
    print(f"Visual report: {args.output.resolve()}")


if __name__=='__main__': main()
