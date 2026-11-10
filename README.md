# CFChart 2.0

CFChart is a Firefox extension that puts rating history and daily practice tracking directly on Codeforces pages.

## What appears on Codeforces

- **Profile chart:** a clean, responsive rating chart panel directly on Codeforces user profiles. Preserves every official rated-contest result, uses elapsed time on the horizontal axis, displays local LightGBM machine learning rating forecasts, and includes an accessible contest-history table.
- **Personal practice pill:** daily progress in the Codeforces header, with a flyout for your goal, streak, recent activity, solved problems, and practice suggestions.
- **Isolated styles:** extension panels use Shadow DOM so their styles stay inside CFChart.
- **Separate identities:** the profile you view controls its chart. Your configured account controls personal progress. Visiting another person's profile never changes your tracked account.

CFChart can adopt your signed-in account from a verified header profile/logout link when no personal account is configured. Signed-out users can choose a handle in the header flyout or extension popup. No password or Codeforces API key is required.

The toolbar popup manages your account and daily goal. The full-page extension view uses the same practice/settings panel; rating charts live on Codeforces profiles.

## Build and install in Firefox

Use a current Node.js release supported by the dependencies, then run:

```bash
npm ci
npm run build
```

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Choose **Load Temporary Add-on…**.
3. Select **`dist/manifest.json`** from this project.
4. Open Codeforces and visit a profile.
5. **Reload any Codeforces tabs that were already open.**

After changing the code, rebuild, reload the add-on in `about:debugging`, and reload the Codeforces tab. Temporary add-ons must be loaded again after restarting Firefox.

`dist/` is the extension package. Source HTML stays in the repository root; builds never replace source files with generated output. Load the manifest inside `dist/`.

## Daily progress and history coverage

The default goal is two **distinct accepted problems per local calendar day**. Repeated accepted submissions for the same problem count once that day. Solving the same problem on a later day can count for that later day. Failed submissions do not count.

A streak tracks consecutive local days that meet the configured goal. Changing the goal recalculates progress using that goal. CFChart marks incomplete days as unknown instead of treating missing history as inactivity. A `+` indicates a lower bound when available history cannot establish an exact total or streak.

Initial sync fetches recent submissions. For a larger account, use **Continue history sync** in the popup or **Sync more history** in the header flyout to load another older page. CFChart does not silently download an account's entire history. Practice recommendations appear only after the full solved history is available, so known solved problems can be excluded reliably.

## Data loading and refresh

Codeforces requests go through one background queue, with request starts spaced at least 2.1 seconds apart. The queue, retries, and a first-time problem-catalog download can make initial setup take several seconds. Official profile history loads independently of personal recommendations.

Profile data, submissions, and the problem catalog are cached locally. The visible in-page tracker checks for updates every minute and refreshes when you return to the tab. A background alarm refreshes personal progress periodically. **Refresh** requests new data explicitly.

Loading, cached data, incomplete history, and API errors are displayed separately. The original Codeforces chart remains available while Enhanced loads or cannot render. The extension does not invent a rating for an unrated user.

## Machine learning rating forecasts

CFChart includes a bundled LightGBM quantile regression model (`cfchart-v1`) trained on real historical Codeforces API data from the top rated users (including the top 500 active rating cohort). It evaluates 30-day and 90-day rating forecasts with calibrated 80% confidence intervals (10th, 50th, and 90th percentiles) based on contest rating momentum, volatility, and recent practice volume.

The offline LightGBM collection, training, evaluation, and installation workflow is documented in [ml/README.md](ml/README.md). Inference runs purely locally in the browser via native TypeScript decision tree traversal with zero remote inference dependencies or Python server requirements.

## Development and validation

```bash
npm test
npm run build
npm run dev
```

The Vite development server helps inspect extension-page layouts. A standalone web preview cannot connect to the extension's background process; it displays a connection error until loaded as an actual add-on. Verify in-page injection using a built extension and a Codeforces tab.

Validation has distinct scopes:

- **Unit and jsdom integration tests** cover API queue/cache behavior, history coverage, identity separation, native-chart restoration, delayed mounts, reinjection, unrated accounts, scenarios, and ML adapter behavior.
- **Packaged Firefox smoke checks** exercise the built extension using representative Codeforces page fixtures and public API rating data. Fixtures are not a captured live-page compatibility guarantee.
- **Live-site limitation:** the public profile page presented a Cloudflare challenge in the verification environment. Direct rendering on the current live Codeforces profile DOM could not be fully verified there. A local check after installation is still needed.

The optional Python ML tests exercise training/export mechanics with explicitly synthetic fixtures. They do not establish real forecast accuracy or produce a deployable trained model.

## Source layout

```text
src/content/       In-page controller, page adapters, isolated styles, panels
src/components/    Rating chart and scenario controls
src/app/           Shared popup/full-page practice settings
src/background/    Extension messages, refresh alarms, toolbar badge
src/services/      API queue, cache broker, account settings, habit calculations
src/ml/            Local model features, inference, and model registry
ml/                Offline collection, training, evaluation, and documentation
public/            Manifest and extension icons
scripts/build.js   Clean, validated dist/ packaging
```
