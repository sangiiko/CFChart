"""Explicit-handle, bounded, resumable public Codeforces API collection."""
import argparse
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


class BudgetExhausted(Exception):
    pass


def atomic_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False))
    os.replace(temporary, path)


class Client:
    def __init__(self, output, budget, interval):
        self.state_path = output / "collector-state.json"
        self.remaining = budget
        self.interval = max(2.1, interval)
        state = json.loads(self.state_path.read_text()) if self.state_path.exists() else {}
        self.last_started = state.get("lastStarted", 0)

    def request(self, method, **params):
        error = None
        for attempt in range(3):
            if self.remaining <= 0:
                raise BudgetExhausted()
            time.sleep(max(0, self.last_started + self.interval - time.time()))
            self.last_started = time.time()
            self.remaining -= 1
            atomic_json(self.state_path, {"lastStarted": self.last_started})
            url = f"https://codeforces.com/api/{method}?{urllib.parse.urlencode(params)}"
            print(f"  API {method} attempt {attempt + 1}/3; {self.remaining} requests remain", flush=True)
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "CFChart-training-collector/1.0"})
                with urllib.request.urlopen(req, timeout=30) as response:
                    data = json.load(response)
                if data.get("status") != "OK":
                    raise ValueError(data.get("comment", "Codeforces API failed"))
                return data["result"]
            except (urllib.error.URLError, ValueError, TimeoutError) as exc:
                error = exc
                if attempt < 2:
                    print(f"  Request failed ({exc}); retrying after {2 ** (attempt + 1)}s", flush=True)
                    time.sleep(2 ** (attempt + 1))
        raise RuntimeError(f"{method} failed after bounded retries: {error}")


def collect_handle(client, path, handle, page_size):
    snapshot = json.loads(path.read_text()) if path.exists() else {
        "handle": handle, "source": "codeforces-public-api", "ratings": [], "submissions": [], "coverage": {"complete": False},
        "nextFrom": 1,
        "metadataWarning": "Problem difficulty and tags reflect collection time, not historical availability.",
    }
    if not snapshot.get("ratingsFetchedAt"):
        snapshot["ratings"] = client.request("user.rating", handle=handle)
        snapshot["ratingsFetchedAt"] = int(time.time())
        atomic_json(path, snapshot)
        print(f"  Saved {len(snapshot['ratings'])} contest ratings for {handle}", flush=True)
    while not snapshot["coverage"]["complete"]:
        page_from = snapshot["nextFrom"]
        print(f"  {handle}: requesting submissions {page_from}–{page_from + page_size - 1} (saved so far: {len(snapshot['submissions'])})", flush=True)
        page = client.request("user.status", handle=handle, **{"from": snapshot["nextFrom"], "count": page_size})
        merged = {s["id"]: s for s in snapshot["submissions"]}
        merged.update({s["id"]: s for s in page})
        snapshot["submissions"] = sorted(merged.values(), key=lambda s: s["creationTimeSeconds"], reverse=True)
        snapshot["nextFrom"] += len(page)
        snapshot["submissionsFetchedAt"] = int(time.time())
        snapshot["coverage"] = {
            "complete": len(page) < page_size,
            "oldestSubmissionTimeSeconds": min((s["creationTimeSeconds"] for s in merged.values()), default=None),
        }
        atomic_json(path, snapshot)
        print(f"  {handle}: checkpoint saved; received {len(page)}; total {len(snapshot['submissions'])}; complete={snapshot['coverage']['complete']}; nextFrom={snapshot['nextFrom']}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--handles", type=Path, required=True, help="UTF-8 file; one public handle per line; # comments allowed")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-requests", type=int, default=25, help="Total request budget including retries")
    parser.add_argument("--interval", type=float, default=2.1, help="Minimum seconds between starts; floor 2.1")
    parser.add_argument("--page-size", type=int, default=1000)
    args = parser.parse_args()
    if args.max_requests < 1 or not 1 <= args.page_size <= 10000:
        parser.error("Use a positive request budget and page size 1–10000")
    handles = list(dict.fromkeys(line.split("#", 1)[0].strip() for line in args.handles.read_text().splitlines()))
    handles = [h for h in handles if h]
    if not handles or any(not re.fullmatch(r"[A-Za-z0-9_.-]{1,24}", h) for h in handles):
        parser.error("Handles must be explicit valid Codeforces handles")
    args.output.mkdir(parents=True, exist_ok=True)
    # Exclusive creation prevents multiple collectors from defeating the shared rate limit.
    lock = args.output / "collector.lock"
    try:
        lock_fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        parser.error("Collector lock exists. Stop concurrent collectors; after a crash remove collector.lock manually.")
    os.close(lock_fd)
    client = Client(args.output, args.max_requests, args.interval)
    try:
        total_handles = len(handles)
        for handle_index, handle in enumerate(handles, 1):
            path = args.output / "users" / f"{handle.lower()}.json"
            if path.exists():
                try:
                    saved = json.loads(path.read_text())
                    state = f"resume at submission {saved.get('nextFrom', 1)}; {len(saved.get('submissions', []))} saved; complete={saved.get('coverage', {}).get('complete', False)}"
                except Exception:
                    state = "existing checkpoint unreadable; collector will report an error"
            else:
                state = "new user"
            pct = (handle_index - 1) * 100 / max(total_handles, 1)
            bar = "█" * int(pct // 4) + "░" * (25 - int(pct // 4))
            print(f"\n[{bar}] {pct:6.2f}% | user {handle_index:,}/{total_handles:,} | {handle} | {client.remaining:,} requests left | {state}", flush=True)
            collect_handle(client, args.output / "users" / f"{handle.lower()}.json", handle, args.page_size)
            pct = handle_index * 100 / max(total_handles, 1)
            bar = "█" * int(pct // 4) + "░" * (25 - int(pct // 4))
            print(f"[{bar}] {pct:6.2f}% | finished user {handle_index:,}/{total_handles:,} | {handle}", flush=True)
    except BudgetExhausted:
        print("Request budget reached. Re-run the same command to resume.")
    finally:
        lock.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
