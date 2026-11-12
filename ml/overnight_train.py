"""Collect the top 10,000 rated Codeforces users, then train a forecast candidate.

Run from the repository root: ml/.venv/bin/python -m ml.overnight_train
The collector checkpoints each user and can be safely rerun after interruption.
"""
import argparse
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "ml/data/top10000"
HANDLES = OUTPUT / "top10000_handles.txt"
USERS = OUTPUT / "users"


def progress(done, total, phase):
    percent = min(100.0, done * 100.0 / max(total, 1))
    width = 40
    filled = int(width * percent / 100)
    print(f"\r[{('#' * filled).ljust(width, '.')}] {percent:6.2f}% | {phase}", end="\n" if percent >= 100 else "\r", flush=True)


def fetch_top_handles():
    print("[startup 1/4] Connecting to Codeforces to refresh the current rated-user ranking...", flush=True)
    started = time.monotonic()
    req = urllib.request.Request(
        "https://codeforces.com/api/user.ratedList?activeOnly=false&includeRetired=true",
        headers={"User-Agent": "CFChart-research-collector/1.0"},
    )
    with urllib.request.urlopen(req, timeout=60) as response:
        print("[startup 1/4] Ranking response received; decoding rated users...", flush=True)
        payload = json.load(response)
    if payload.get("status") != "OK":
        raise RuntimeError(payload.get("comment", "Codeforces API error"))
    rated = sorted(payload["result"], key=lambda row: row.get("rating", -1), reverse=True)
    handles = list(dict.fromkeys(row["handle"] for row in rated if row.get("rating") is not None))[:10000]
    if len(handles) != 10000:
        raise RuntimeError(f"API returned only {len(handles)} rated handles; refusing an incomplete target")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    HANDLES.write_text("\n".join(handles) + "\n", encoding="utf-8")
    print(f"[startup 1/4] Saved {len(handles)} highest-rated handles in {time.monotonic()-started:.1f}s: {HANDLES}", flush=True)


def main():
    print("=" * 78, flush=True)
    print("CFCHART TOP-10,000 COLLECTION AND TRAINING RUNNER STARTING", flush=True)
    print(f"Started at: {time.strftime('%Y-%m-%d %H:%M:%S %Z')}", flush=True)
    print(f"Working directory: {ROOT}", flush=True)
    print("Python is running; preparing command-line options and output folders...", flush=True)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hours", type=float, help="Optional collection deadline; omit to wait for every full history")
    parser.add_argument("--request-budget", type=int, default=20000, help="Requests allowed per collector run; reruns resume")
    parser.add_argument("--interval", type=float, default=2.1, help="Seconds between API requests (Codeforces minimum: 2.1)")
    parser.add_argument("--refresh-handles", action="store_true", help="Replace the saved ranking; omit when resuming a frozen cohort")
    args = parser.parse_args()
    print(f"Options loaded: hours={args.hours or 'unlimited'}, request budget={args.request_budget:,}, interval={args.interval:.2f}s", flush=True)
    if (args.hours is not None and args.hours <= 0) or args.request_budget < 1 or args.interval < 2.1:
        parser.error("hours and request-budget must be positive; interval must be at least 2.1 seconds")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    print(f"[startup 0/4] Output folder ready: {OUTPUT}", flush=True)
    if args.refresh_handles or not HANDLES.exists():
        fetch_top_handles()
    else:
        print(f"[startup 1/4] Resuming the frozen handle list: {HANDLES}", flush=True)
    deadline = time.monotonic() + args.hours * 3600 if args.hours is not None else None
    target = HANDLES.read_text(encoding="utf-8").splitlines()
    target_names = {handle.lower() for handle in target}
    print(f"[startup 2/4] Loaded target list: {len(target):,} handles", flush=True)
    checkpoint = USERS / "molongdadi.json"
    if checkpoint.exists():
        saved = json.loads(checkpoint.read_text(encoding="utf-8"))
        print(f"RESUME CHECKPOINT: molongdadi has {len(saved.get('submissions', []))} submissions saved; nextFrom={saved.get('nextFrom')}; complete={saved.get('coverage', {}).get('complete')}", flush=True)
    else:
        print("[startup 3/4] No molongdadi checkpoint found; will continue from available user checkpoints.", flush=True)
    print(f"[startup 4/4] Entering collection loop. Full progress will print below; target={len(target):,} users.", flush=True)
    while deadline is None or time.monotonic() < deadline:
        complete = set()
        partial = 0
        for path in USERS.glob("*.json"):
            if path.stem.lower() not in target_names:
                continue
            try:
                record = json.loads(path.read_text(encoding="utf-8"))
                if record.get("coverage", {}).get("complete"):
                    complete.add(path.stem.lower())
                else:
                    partial += 1
            except (OSError, json.JSONDecodeError):
                partial += 1
                continue
        collected = len(complete)
        progress(collected, len(target), f"complete {collected:,}/{len(target):,} | partial {partial:,} | remaining {len(target)-collected:,}")
        remaining = len(target) - collected
        if remaining <= 0:
            print("All target handles have collection files.", flush=True)
            break
        print(f"\n{'-'*78}\nCOLLECTION CYCLE START | {remaining:,} target users remain | request budget {args.request_budget:,} | request interval {args.interval:.2f}s", flush=True)
        # Mirror collector output so individual handle/page progress stays visible.
        result = subprocess.run([
            sys.executable, "-u", "-m", "ml.collect", "--handles", str(HANDLES),
            "--output", str(OUTPUT), "--max-requests", str(args.request_budget),
            "--interval", str(args.interval),
        ], cwd=ROOT)
        if result.returncode:
            print(f"\nCOLLECTOR EXITED WITH STATUS {result.returncode}; all completed pages are checkpointed. Retry in 30 seconds.", flush=True)
            for remaining in range(30, 0, -1):
                print(f"\rRetrying collector in {remaining:2d}s...", end="", flush=True)
                time.sleep(1)
            print("\nRETRYING NOW: resuming every unfinished user from its saved checkpoint.", flush=True)
        # Collector returns normally when its request budget is exhausted.
        # Avoid spinning if all remaining work failed without creating snapshots.
        time.sleep(5)
    complete = []
    for path in USERS.glob("*.json"):
        if path.stem.lower() not in target_names:
            continue
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
            if record.get("coverage", {}).get("complete"):
                complete.append(path)
        except (OSError, json.JSONDecodeError):
            continue
    count = len(complete)
    if count == 0:
        raise RuntimeError("No user snapshots collected; refusing to train on an empty cohort")
    if count < len(target):
        raise RuntimeError(f"Collection deadline reached with only {count}/{len(target)} complete histories; refusing to train on partial data")
    print(f"Training on {count} collected users", flush=True)
    print("Collection is complete. Starting local LightGBM training and validation now...", flush=True)
    progress(count, len(target), f"collection complete: {count:,}/{len(target):,} users; training starts")
    train_cmd = [
        sys.executable, "-m", "ml.train", "--data", str(OUTPUT),
        "--output", str(ROOT / "ml/artifacts/top10000-overnight"),
        "--version", "cfchart-top10000-overnight", "--allow-retrospective-metadata",
    ]
    # Training can take time; show a live phase indicator and completion status.
    print("Training model (progress indicator advances when training finishes)...", flush=True)
    started = time.monotonic()
    proc = subprocess.Popen(train_cmd, cwd=ROOT)
    while proc.poll() is None:
        elapsed = int(time.monotonic() - started)
        print(f"\rTraining model... elapsed {elapsed // 60:02d}:{elapsed % 60:02d} | overall {count * 90 / len(target):5.1f}%", end="", flush=True)
        time.sleep(2)
    print()
    if proc.returncode:
        raise subprocess.CalledProcessError(proc.returncode, train_cmd)
    progress(len(target), len(target), "training complete")


if __name__ == "__main__":
    main()
