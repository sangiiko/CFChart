"""Fast, respectful collector for top Codeforces users."""
import json
import os
import time
import urllib.request
import urllib.error
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

RATE_LIMIT_INTERVAL = 0.35  # ~2.8 requests per second across all threads
USER_AGENT = "CFChart-training-collector/2.0"
OUTPUT_DIR = Path("ml/data/cohort/users")
HANDLES_FILE = Path("ml/top500_handles.txt")

_lock = threading.Lock()
_last_request_time = 0.0

def safe_request(url):
    global _last_request_time
    for attempt in range(4):
        with _lock:
            now = time.time()
            sleep_needed = _last_request_time + RATE_LIMIT_INTERVAL - now
            if sleep_needed > 0:
                time.sleep(sleep_needed)
            _last_request_time = time.time()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.load(resp)
            if data.get("status") == "OK":
                return data["result"]
            if attempt < 3:
                time.sleep(1.0 * (attempt + 1))
        except Exception as exc:
            if attempt < 3:
                time.sleep(1.0 * (attempt + 1))
            else:
                return None
    return None

def fetch_user(handle):
    user_file = OUTPUT_DIR / f"{handle}.json"
    if user_file.exists():
        try:
            existing = json.loads(user_file.read_text())
            if existing.get("ratings") and existing.get("submissions"):
                return handle, True, "cached"
        except Exception:
            pass

    # 1. Fetch ratings
    ratings = safe_request(f"https://codeforces.com/api/user.rating?handle={handle}")
    if ratings is None:
        return handle, False, "ratings_failed"

    # 2. Fetch submissions
    submissions = safe_request(f"https://codeforces.com/api/user.status?handle={handle}&from=1&count=1000")
    if submissions is None:
        return handle, False, "submissions_failed"

    oldest = min((s["creationTimeSeconds"] for s in submissions), default=None)
    record = {
        "handle": handle,
        "source": "codeforces-public-api",
        "ratings": ratings,
        "ratingsFetchedAt": int(time.time()),
        "submissions": submissions,
        "submissionsFetchedAt": int(time.time()),
        "coverage": {
            "complete": len(submissions) < 1000,
            "oldestSubmissionTimeSeconds": oldest,
        },
        "metadataWarning": "Problem difficulty and tags reflect collection time, not historical availability.",
    }
    tmp_path = user_file.with_suffix(".tmp")
    tmp_path.write_text(json.dumps(record, ensure_ascii=False, separators=(",", ":")))
    os.replace(tmp_path, user_file)
    return handle, True, f"{len(ratings)} contests, {len(submissions)} subs"

def main():
    import sys
    handles_file = Path(sys.argv[1]) if len(sys.argv) > 1 else HANDLES_FILE
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    handles = [line.strip() for line in handles_file.read_text().splitlines() if line.strip()]
    print(f"Reading handles from: {handles_file}")
    print(f"Total handles to process: {len(handles)}")
    success_count = 0
    fail_count = 0
    t0 = time.time()

    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {executor.submit(fetch_user, h): h for h in handles}
        for i, future in enumerate(as_completed(futures), 1):
            h, ok, msg = future.result()
            if ok:
                success_count += 1
            else:
                fail_count += 1
            if i % 50 == 0 or i == len(handles):
                elapsed = time.time() - t0
                rate = i / max(1.0, elapsed)
                print(f"[{i}/{len(handles)}] Success: {success_count}, Failed: {fail_count}, Rate: {rate:.1f} users/s, Elapsed: {elapsed:.1f}s")

    print(f"Done in {time.time() - t0:.1f}s! Total success: {success_count}, Total failed: {fail_count}")

if __name__ == "__main__":
    main()
