"""Freeze and audit a collected Codeforces cohort before model training."""
import argparse
import hashlib
import html
import json
import time
from collections import Counter
from pathlib import Path


def audit(handles_file: Path, users_dir: Path, output: Path):
    handles = [line.strip() for line in handles_file.read_text(encoding="utf-8").splitlines() if line.strip()]
    requested = {h.lower() for h in handles}
    if len(handles) != 10000 or len(requested) != 10000:
        raise ValueError("Expected exactly 10,000 distinct handles in the frozen target list")
    paths = {p.stem.lower(): p for p in users_dir.glob("*.json")}
    rows, reasons = [], Counter()
    generated_at = int(time.time())
    for index, handle in enumerate(handles, 1):
        path = paths.get(handle.lower())
        if path is None:
            reasons["missing_file"] += 1
            rows.append({"handle": handle, "eligible": False, "reasons": ["missing_file"]})
            continue
        raw = path.read_bytes()
        sha = hashlib.sha256(raw).hexdigest()
        issues = []
        try:
            data = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            data = None
            issues.append("invalid_json")
        if data is not None:
            ratings = data.get("ratings", [])
            submissions = data.get("submissions", [])
            coverage = data.get("coverage", {})
            if str(data.get("handle", "")).lower() != handle.lower(): issues.append("handle_mismatch")
            if data.get("source") != "codeforces-public-api": issues.append("unexpected_source")
            if not coverage.get("complete"): issues.append("partial_submissions")
            if len(ratings) < 3: issues.append("fewer_than_three_contests")
            if not data.get("ratingsFetchedAt") or not data.get("submissionsFetchedAt"): issues.append("missing_fetch_timestamp")
            ids = [s.get("id") for s in submissions]
            if len(ids) != len(set(ids)): issues.append("duplicate_submission_ids")
            times = [s.get("creationTimeSeconds") for s in submissions]
            if any(not isinstance(t, int) or t <= 0 or t > generated_at + 86400 for t in times): issues.append("invalid_submission_timestamp")
            if any(not isinstance(r.get("ratingUpdateTimeSeconds"), int) or r["ratingUpdateTimeSeconds"] <= 0 or r["ratingUpdateTimeSeconds"] > generated_at + 86400 for r in ratings): issues.append("invalid_rating_timestamp")
            valid_times = [t for t in times if isinstance(t, int)]
            if valid_times and coverage.get("oldestSubmissionTimeSeconds") != min(valid_times): issues.append("oldest_submission_mismatch")
            if data.get("nextFrom", 1) < len(submissions) + 1: issues.append("pagination_checkpoint_behind")
            if data.get("ratingsFetchedAt", 0) > generated_at + 86400 or data.get("submissionsFetchedAt", 0) > generated_at + 86400: issues.append("future_fetch_timestamp")
            row = {"handle": handle, "file": str(path), "sha256": sha, "bytes": len(raw),
                   "submissions": len(submissions), "ratings": len(ratings),
                   "ratingsFetchedAt": data.get("ratingsFetchedAt"),
                   "submissionsFetchedAt": data.get("submissionsFetchedAt"),
                   "coverageComplete": bool(coverage.get("complete")),
                   "oldestSubmissionTimeSeconds": coverage.get("oldestSubmissionTimeSeconds")}
        else:
            row = {"handle": handle, "file": str(path), "sha256": sha, "bytes": len(raw)}
        row["eligible"] = not issues
        row["reasons"] = issues
        rows.append(row)
        reasons.update(issues)
        if index % 250 == 0 or index == len(handles):
            print(f"Audit {index:,}/{len(handles):,} ({index*100/len(handles):.1f}%) | eligible {sum(r['eligible'] for r in rows):,}", flush=True)
    report = {"schemaVersion": 1, "generatedAt": generated_at, "targetCount": len(handles),
              "fileCount": len(paths), "eligibleCount": sum(r["eligible"] for r in rows),
              "exclusions": dict(reasons), "extraFiles": sorted(set(paths)-requested),
              "totalBytes": sum(r.get("bytes", 0) for r in rows),
              "totalSubmissions": sum(r.get("submissions", 0) for r in rows),
              "totalRatings": sum(r.get("ratings", 0) for r in rows),
              "completeCount": sum(r.get("coverageComplete", False) for r in rows)}
    manifest = {"schemaVersion": 1, "generatedAt": generated_at,
                "handlesSha256": hashlib.sha256(handles_file.read_bytes()).hexdigest(),
                "sourceHandles": str(handles_file), "users": rows}
    output.mkdir(parents=True, exist_ok=True)
    (output / "manifest.json").write_text(json.dumps(manifest, separators=(",", ":")), encoding="utf-8")
    (output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    issue_rows = "".join(f"<tr><td>{html.escape(k)}</td><td>{v:,}</td></tr>" for k,v in reasons.most_common()) or "<tr><td>None</td><td>0</td></tr>"
    page = f'''<!doctype html><html><head><meta charset="utf-8"><title>CFChart cohort audit</title><style>body{{font:16px system-ui;background:#f4f7fb;color:#172443;margin:40px}}main{{max-width:850px;margin:auto}}header{{background:#213d79;color:#fff;padding:28px;border-radius:16px}}.cards{{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:16px 0}}article,section{{background:#fff;padding:20px;border-radius:12px}}b{{display:block;font-size:28px}}table{{width:100%;border-collapse:collapse}}td{{border-bottom:1px solid #edf1f6;padding:8px}}td:last-child{{text-align:right}}small{{color:#6d7b95}}</style></head><body><main><header><h1>Top-10,000 cohort audit</h1><p>Frozen input inventory · {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime(generated_at))}</p></header><div class="cards"><article>Target handles<b>{len(handles):,}</b></article><article>Eligible histories<b>{report['eligibleCount']:,}</b></article><article>Complete histories<b>{report['completeCount']:,}</b></article></div><section><h2>Collected records</h2><p>{report['totalSubmissions']:,} submissions · {report['totalRatings']:,} contest ratings · {report['totalBytes']/1e9:.2f} GB</p><h2>Exclusions and warnings</h2><table>{issue_rows}</table><small>Manifest records per-file checksums and reasons. Completeness reflects the collector's coverage flag; this audit cannot independently prove that the remote API exposed every historical event.</small></section></main></body></html>'''
    (output / "report.html").write_text(page, encoding="utf-8")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--handles", type=Path, default=Path("ml/data/top10000/top10000_handles.txt"))
    parser.add_argument("--users", type=Path, default=Path("ml/data/top10000/users"))
    parser.add_argument("--output", type=Path, default=Path("ml/artifacts/top10000-audit"))
    args = parser.parse_args()
    print(json.dumps(audit(args.handles, args.users, args.output), indent=2))


if __name__ == "__main__": main()
