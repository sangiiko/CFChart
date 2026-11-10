# CFChart 🎯 (Firefox WebExtension)

**CFChart** is a browser extension for competitive programmers on **Codeforces** designed around a single, powerful daily habit: **Solve 2 problems a day consistently**.

It draws directly over Codeforces to track your daily progress and visualizes your rating future using an authentic **Codeforces-style Rating Horizon Predictor**: past contests are rendered in their vibrant earned rank colors, while the future projection extends out as an elegant **dashed slate-grey ghost trajectory** that you turn into colorful reality through daily practice.

---

## 🌟 Key Features

1. **In-Page Codeforces Integration (`codeforces.com`)**:
   - **Top-Bar Habit Pill**: Seamlessly injected into the Codeforces navigation bar (`🔥 Streak | Today: 1/2 🎯`).
   - **Profile Horizon Card**: Injected right above the Codeforces profile graph (`/profile/<handle>`) with a toggle switch: `[✨ CFChart Horizon] | [Original Codeforces Graph]`.
   - **Auto-Detection**: Automatically detects your logged-in Codeforces username so no manual login setup is needed.

2. **The "Grey Ghost" Rating Horizon Predictor**:
   - **Authentic Codeforces Aesthetics**: Includes official background tier bands (Newbie gray, Pupil green, Specialist cyan, Expert blue, Candidate Master purple, Master orange, Grandmaster red).
   - **Visual Contrast**: Earned past contest ratings are vibrantly colored; future projections are rendered in **dashed slate-grey (`#64748b`)** with a translucent grey confidence envelope.
   - **Practice Horizon Simulator**: Interactive sliders allow you to test what-if scenarios (e.g. 2 vs 3 problems/day, +150 difficulty offset, 3/6/12 months timeframe) and see your projected rating and milestone dates adjust in real time.
   - **Milestone Target Cards**: Exact estimated calendar dates and problems remaining to cross into Specialist (1400), Expert (1600), Candidate Master (1900), etc.

3. **Daily "2 Problems a Day" Habit Engine**:
   - Live query of accepted submissions (`verdict === 'OK'`) for today.
   - Circular SVG progress ring (`0/2`, `1/2`, `2/2`).
   - Active daily streak counter with flame indicator.
   - 30-day consistency heatmap.
   - Daily Workout: 2 curated unsolved problems (1 warmup/consolidation + 1 growth challenge) ready to solve in 1 click.

4. **Toolbar Ambient Badge & Extension Popup**:
   - Firefox toolbar badge displays your live status (`0/2`, `1/2`, or `✓`).
   - Compact popup view (`popup.html`) when browsing any other website.
   - Dedicated full-screen horizon dashboard (`dashboard.html`).

---

## 🚀 How to Install & Run in Firefox

### 1. Build the Extension
```bash
npm install
npm run build
```
The compiled, ready-to-load extension will be located in the `dist/` directory.

### 2. Load into Firefox
1. Open Firefox and navigate to `about:debugging` in the address bar.
2. In the left sidebar, click **This Firefox**.
3. Under **Temporary Extensions**, click **Load Temporary Add-on...**.
4. Browse to your `CFChart/dist/` directory and select `manifest.json`.
5. CFChart is now installed! You will see the CFChart icon on your Firefox toolbar.

### 3. Try It on Codeforces
- Navigate to `https://codeforces.com/`.
- Look at the top navigation bar to see your daily habit badge: `🔥 0d | Today: 0/2 🎯`.
- Visit any profile (e.g., `https://codeforces.com/profile/tourist` or your own handle) to experience the **CFChart Rating Horizon** chart with interactive simulation sliders!

---

## 🛠️ Development & Testing

```bash
# Run unit tests (habit tracking, prediction models)
npm test

# Run Vite development server
npm run dev
```

---

## 📂 Project Structure

```
CFChart/
├── manifest.json              # Public manifest source template
├── public/
│   ├── manifest.json          # Firefox WebExtension MV3 manifest
│   └── icons/                 # Extension icons (16, 32, 48, 128px)
├── src/
│   ├── types/
│   │   └── codeforces.ts      # TypeScript interfaces
│   ├── services/
│   │   ├── codeforcesApi.ts   # Public API calls with caching & rate limiting
│   │   ├── habitTracker.ts    # 2-problem habit engine, streaks, & heatmaps
│   │   ├── predictorModel.ts  # Science-backed rating projection & milestone dates
│   │   └── storage.ts         # Firefox storage abstraction with localStorage fallback
│   ├── components/
│   │   ├── HorizonChart.tsx   # Recharts Codeforces-styled chart (colored past, grey future)
│   │   ├── PracticeSimulator.tsx # Interactive simulation sliders
│   │   ├── MilestoneGrid.tsx  # Next rank milestone checkpoint cards
│   │   ├── DailyHabitRing.tsx # Radial progress for 0/2, 1/2, 2/2
│   │   ├── RecommendedCard.tsx# Daily workout problem cards
│   │   └── HandleConnectModal.tsx # Profile switcher dialog
│   ├── content/
│   │   ├── index.tsx          # Codeforces in-page content script injector
│   │   └── components/
│   │       ├── TopBarHabitPill.tsx    # Header navbar habit widget
│   │       └── ProfileHorizonCard.tsx # In-page profile horizon card & toggle
│   ├── background/
│   │   └── index.ts           # Periodic alarms & toolbar badge updater
│   ├── popup/
│   │   ├── PopupApp.tsx       # Toolbar popup application
│   │   └── main.tsx
│   └── dashboard/
│       ├── DashboardApp.tsx   # Full tab dashboard application
│       └── main.tsx
├── dist/                      # Final packaged Firefox WebExtension
└── scripts/
    └── build.js               # Multi-stage build script
```
