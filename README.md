# CFChart 2.0

CFChart is a browser extension for **Firefox** and **Chromium-based browsers** (Chrome, Brave, Edge) that brings interactive rating charts, local machine learning rating forecasts, daily practice streaks, and spaced repetition recommendations directly into Codeforces.

---

## Features on Codeforces

### 1. Enhanced Profile Rating Chart
* **Clean, responsive chart panel:** Seamlessly replaces the legacy Flash/image chart directly on Codeforces user profiles with an interactive SVG chart.
* **Proportional time axis:** Displays true elapsed time on the horizontal axis rather than distorted contest intervals.
* **Rank tier coloring & background bands:** Visualizes official Codeforces rating divisions (Newbie, Pupil, Specialist, Expert, Candidate Master, Master, etc.).
* **Contest history table:** Includes a searchable and collapsible table of all rated contests with ranks, deltas, and dates.
* **Native fallback:** If an account is unrated or data is loading, Codeforces native elements remain accessible.

### 2. Local ML Rating Forecasts
* **30-Day and 90-Day horizons:** Predicts expected rating trajectory based on contest momentum and recent practice activity.
* **Calibrated confidence intervals:** Shaded prediction bars illustrate empirical uncertainty margins (85% coverage).
* **Color-coded forecast points:** Forecast dots are colored by their predicted Codeforces rank tier with a dashed trajectory line connecting from the user's latest contest.
* **100% browser-local inference:** Powered by an offline-trained LightGBM quantile regression model (`cfchart-top5000-v1`) trained on real historical Codeforces API data from the top 5,000 active rating cohort. Runs locally in TypeScript with zero remote API calls, telemetry, or server requirements.

### 3. Personal Habit Tracker & Header Flyout
* **Header pill:** Persistent widget in the Codeforces top navigation bar displaying today's progress towards your daily problem goal and your active streak.
* **Habit flyout:** Click the header pill to reveal:
  * **Today's progress:** Live counter of problems solved today vs. your daily target.
  * **Streak counter & heatmap:** 15-day visual activity heatmap showing met, partial, and missed days.
  * **Today's solved problems:** List of problems solved today with direct links and an instant remove button for miscategorized items.
  * **Universal problem counting:** Problems solved anywhere on Codeforces (both recommended problems and regular practice) automatically count toward your daily target.
  * **Daily recommendations:** Intelligent problem suggestions tailored to your skill level.

### 4. In-Page Problem Verdict Bar & Spaced Repetition
* **Post-solve assessment:** On any accepted problem page (`/problemset/problem/...`), CFChart injects an inline verdict bar:
  * **✓ Solved:** Confirms an independent solve. Contributes to your daily goal, maintains your streak, and feeds unassisted skill estimation.
  * **💡 Solved with help:** For problems solved using hints, editorials, or assistance. Maintains your daily goal and streak without falsely inflating your unassisted skill level, and automatically schedules an **Independent Review in 3 days**.
* **Spaced repetition (`revisit` slot):** Exactly 3 days after an assisted solve, the problem re-enters your daily recommendations under the **Independent Review** slot to confirm concept retention.

### 5. Architectural Privacy & Identity Isolation
* **Shadow DOM encapsulation:** All in-page panels are isolated within Shadow DOMs to prevent CSS interference with Codeforces stylesheets.
* **Strict identity separation:** The profile being viewed controls only the chart. Your configured personal handle controls personal progress and recommendations. Visiting other users' profiles never overrides your personal account.
* **Automatic detection:** Detects your signed-in handle from Codeforces navigation links, or lets you enter any handle manually without requiring passwords or API keys.

---

## Installation

### Firefox (Recommended)

#### Option A: Automatic Updates via `.xpi` (Permanent)
1. Download `cfchart.xpi` from the [Latest Release](https://github.com/sangiiko/CFChart/releases/latest).
2. Open `about:addons` in Firefox.
3. Click the gear icon (⚙️) → **Install Add-on From File…** and select `cfchart.xpi`.
4. CFChart will automatically check for updates on future GitHub releases via `updates.json`.

#### Option B: Temporary Add-on (For Developers)
1. Run `npm run build`.
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Click **Load Temporary Add-on…** and select `dist/manifest.json`.

---

### Chrome / Brave / Edge

1. Run `npm run build` (this generates both `dist/` and `dist-chrome/`).
2. Open `chrome://extensions` in your browser.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the **`dist-chrome`** folder.

---

## Machine Learning Forecast Pipeline

CFChart evaluates 26 features per user snapshot:
* **Contest history (8 features):** Current rating, peak rating, contest count, last delta, 5-contest mean delta, 5-contest standard deviation, days since last contest, and rated contests in last 90 days.
* **Practice activity (18 features):** Rolling 7-day, 30-day, and 90-day attempt counts, unique accepted problems, active UTC days, mean relative difficulty, rated problem count, 90-day acceptance rate, dedicated practice solves, and topic tag diversity.

For details on offline data collection, training, monotonic quantile verification, and export, see [ml/README.md](ml/README.md).

---

## Development & Testing

### Prerequisites
* Node.js 18+ and npm
* (Optional for ML training) Python 3.10+

### Scripts
```bash
# Install dependencies
npm install

# Run test suite (Vitest unit and jsdom integration tests)
npm test

# Type-check TypeScript
npm run typecheck

# Build Firefox (dist/) and Chrome (dist-chrome/) packages + cfchart.xpi
npm run build

# Start Vite dev server for popup/dashboard UI development
npm run dev

# Run Python ML test suite
npm run test:ml
```

---

## Project Structure

```text
src/
├── app/             # Shared popup and full-page dashboard settings
├── background/      # Extension service worker / background script, alarms, sync
├── components/      # Reusable UI components (HorizonChart, Recommendations, etc.)
├── content/         # In-page content script, Shadow DOM controllers, verdict bars
├── ml/              # Browser-local ML inference, features, and model registry
├── recommender/     # Adaptive practice engine, spaced repetition, candidate ranking
├── services/        # Codeforces API queue, local cache broker, habit tracking
└── types/           # TypeScript data models and interfaces

ml/                  # Offline LightGBM training pipeline, data collection, and export
public/              # Manifest file and extension icons
scripts/             # Custom build script (esbuild + Vite + Chrome/Firefox packagers)
```

---

## Releases & Updates

Every commit pushed to `main` triggers a GitHub Actions workflow that runs typechecks, executes unit tests, builds both packages, and publishes a new release if the version is bumped:

1. Update the version in `package.json`, `package-lock.json`, and `public/manifest.json`.
2. Commit and push to `origin/main`.
3. The release workflow publishes `cfchart.xpi` and updates `updates.json` automatically for Firefox auto-updates.

---

## License

MIT License. Crafted for the competitive programming community.
