# CFChart UI/UX redesign plan

## Goal

Make CFChart feel like one focused product across Codeforces pages, the extension popup, and the full dashboard. A user should quickly understand **today's practice**, **their rating history and forecast**, and **the next useful action**. Keep the restrained blue and neutral identity established by the new problem timer. Use current design-system ideas where they improve clarity and control; do not copy another product's visual brand.

This is a design and implementation plan. It does not change rating calculations, recommendation policy, storage contracts, or the problem timer's saved state.

## What exists today

| Surface | Current implementation | Observed UX issue | Intended role |
| --- | --- | --- | --- |
| Toolbar pill and popover | `TopBarHabitPill.tsx`, `content.css` | The popover combines account setup, goal editing, streak, heatmap, sync warnings, recommendations, solved list, and refresh controls in a 355px panel. | Glance at progress and open one relevant next action. |
| Profile panel | `ProfileHorizonCard.tsx`, `HorizonChart.tsx` | A second profile header and many small labels compete with the chart. Forecast status appears below the chart and can be easy to miss. | Explain official history first, then a clearly marked estimate. |
| Popup | `PracticeApp.tsx`, `styles.css` | An intro paragraph, full daily card, heatmap, recommendations, setup, and two bottom actions share a fixed 380px width. | Answer “What should I do now?” in a few seconds. |
| Full dashboard | `DashboardApp.tsx` reuses `PracticeApp` | The wider page is essentially the popup stretched to 620px, so it does not use the space for analysis or planning. | Give room for history, trends, recommendations, and controls. |
| Recommendation cards | `PracticeRecommendations.tsx`, two separate CSS definitions | Each card shows a link, result select, save, and skip before the user opens the problem. Similar cards differ between popup and popover. | Help a user choose a problem, then record the outcome at the right time. |
| Problem page | `ProblemTimerWidget.tsx`, `ProblemVerdictBar.tsx` | The timer was recently simplified, but outcome actions still look like a separate visual system. | Support the current problem without interrupting it. |

The profile screenshot and packaged timer fixture were reviewed. This inventory is a code and fixture audit, not user research; the discovery phase below must validate which problems actually slow people down.

## Design direction

1. **Glanceable, then explorable.** Show one summary and one primary action in compact surfaces. Put history, settings, and detailed explanations one step deeper. Apple's current design principles emphasize hierarchy, agency, and concise language; Microsoft's Fluent 2 emphasizes focus and low visual noise. [Apple](https://developer.apple.com/design/human-interface-guidelines/design-principles/), [Fluent 2](https://fluent2.microsoft.design/design-principles).
2. **Expressive only where useful.** Use typography, spacing, and restrained color to make the next action obvious. Google describes Material 3 Expressive as more glanceable and responsive; for CFChart, this means clearer status and layout changes, not bouncing animations or decorative gradients. [Google](https://blog.google/products-and-platforms/platforms/android/material-3-expressive-android-wearos-launch/).
3. **Make data provenance visible.** Official Codeforces rating, a model forecast, a practice scenario, locally recorded outcomes, cached data, and incomplete sync must each have unmistakable labels. Never let visual similarity imply equal certainty.
4. **Keep people in control.** Refresh, retry, change account, dismiss, undo, and inspect the original chart should be understandable and recoverable. In-page UI should never unexpectedly replace the user's task flow.
5. **Accessible by default.** Use semantic controls, keyboard-visible focus, text equivalents for charts, reflow at narrow widths, adequate contrast, and reduced-motion behavior. Target WCAG 2.2 AA as the release gate, with selected stronger practices where practical. [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [W3C reflow guidance](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).

## Information architecture

| Location | First view | One level deeper | Keep out of the first view |
| --- | --- | --- | --- |
| Toolbar pill | Today `2 / 3`, sync/unknown marker when relevant | Small popover with progress, next problem, and account link | Full heatmap, repeated recommendation forms, detailed sync explanation |
| Popup | Today's goal, one recommended problem, one clear action | “More practice” and “Settings” disclosures or full dashboard links | Chart analysis, long onboarding copy, full history |
| Full dashboard | Overview of progress and next session | Dedicated Practice, Progress, and Settings sections | Duplicate controls that are already in the popup unless depth adds value |
| Profile injection | Official rating history and a short forecast summary | Forecast interval details, contest table, data freshness details | Repeated profile header and large status paragraphs |
| Problem injection | Compact timer and outcome action when relevant | Timer settings and outcome explanation | Goal configuration and recommendation list |

The popup and dashboard should share data and design primitives but have **different compositions**. Keep the toolbar popover lighter than the popup. The three core journeys are: connect a handle, choose and complete a practice problem, and interpret a rating forecast without confusing it with official results.

## Shared visual and interaction system

Create a small token layer used by the popup/dashboard stylesheet and the content script's Shadow DOM stylesheet. The host page must not control CFChart's contrast, but CFChart should choose a coherent light or dark palette where supported.

| Token group | Initial rule to prototype |
| --- | --- |
| Type | System UI font; body copy about 14–16px, labels rarely below 12px, tabular numerals for ratings, timers, and counts. Test at 200% text zoom. |
| Color | Neutral surfaces and text, CFChart blue for the primary action, semantic amber/red/green only for state. Keep Codeforces rating-tier colors in the chart with labels or patterns so color is not the sole cue. |
| Spacing | A consistent 4/8px rhythm; align summary numbers, labels, and actions across surfaces. |
| Shape | Quiet 1px borders, 6–10px radii, little or no default shadow. Reserve elevation for an actual popover. |
| Components | One primary button per compact view; consistent secondary/text buttons, cards, notices, disclosures, inputs, and status labels. |
| Motion | Short state transitions only when they explain a change. No animation for every timer tick, chart update, or sync poll. Honor `prefers-reduced-motion`. [Apple motion](https://developer.apple.com/design/human-interface-guidelines/motion), [W3C animation guidance](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions). |

Use CSS custom properties and container queries so the same component adapts to a narrow popover, a wider popup, and a full page. Define component variants in one place rather than copying `.practice-task` and button styles into two stylesheets. Prefer native controls and semantic HTML; only add ARIA where native semantics do not cover the interaction.

## Surface designs

### 1. Toolbar and popover

- Pill: retain the compact goal count. Show a concise syncing/unknown indicator only when it changes interpretation of the count. Keep the hit target comfortable and label the expanded state.
- Popover: put today's status and a single “Continue practice” action at the top. Put the 30-day heatmap and solved list in disclosures; keep account and goal editing under Settings. Preserve the distinction between the signed-in Codeforces page account and the handle tracked by CFChart.
- Do not make an incomplete history look like zero progress. Show the loaded submission count and a specific “Continue sync” action in the detailed view.
- Restore focus to the pill on close; support Escape and click outside without losing unsaved form edits silently.

### 2. Popup and onboarding

- New user: one short handle form, a plain privacy statement, and a clear next step. Explain that public Codeforces data is used and no password is needed.
- Returning user: show goal progress, one recommended problem, and a secondary route to the dashboard. Move setup and full explanation behind Settings.
- When history is syncing, show progress and what is available now; avoid a blank or apparently broken recommendation area. Distinguish loading, cached, partial, error, and complete states.
- Treat the popup as a short visit. Do not require multiple forms and a long scroll to begin practice.

### 3. Profile chart and forecast

- Put the chart's question in the heading: “Rating history,” followed by current rating and last official update. Remove duplicate profile identity where Codeforces already shows it.
- Make official history a solid line. Use a visually different forecast treatment, a labeled interval, and a direct sentence such as “Model estimate for 30 days: 1,850 (range 1,760–1,930).” Show the data date and coverage next to that estimate.
- Keep the forecast explanation adjacent to the forecast, including what the range means and when it is unavailable. Do not display a made-up number while inputs are incomplete.
- Add a short text summary and preserve the contest-history table as an equivalent route to the data. Chart points must be inspectable by keyboard as well as pointer; avoid forcing hundreds of Tab stops when history is long. Apple's chart guidance calls for context, summary, and accessible navigation. [Apple charts](https://developer.apple.com/design/human-interface-guidelines/charts), [W3C complex images](https://www.w3.org/WAI/tutorials/images/complex/).
- Review the rank-band colors at common widths and in grayscale. Use labels, line styles, and a legend alongside color.

### 4. Recommendation and problem flow

- Show the reason for each recommendation in a short, concrete line: difficulty fit, target skill, or review timing. Keep the recommendation link and estimated effort prominent.
- Default to one “next problem” card; show additional choices on demand. Move “Solved,” “Solved with help,” and “Skip” into an outcome step after the user attempts or opens the task. Preserve the existing local feedback semantics.
- Align the problem page verdict controls visually with the timer. An outcome should confirm what was saved, offer a recovery path for an accidental click, and preserve elapsed time recording.
- Do not use a predicted rating gain as a promise or as the primary reason for a recommendation.

### 5. Full dashboard

- Give the dashboard a purpose beyond a larger popup: session plan, practice history, progress trends, and account/settings. Use a simple section navigation and responsive layout.
- Show counts with denominators and coverage. A heatmap cell needs a date and count in text or accessible description, and unknown days must look different from zero-solve days.
- Keep advanced diagnostics (sync details, raw data freshness, model information) available without placing them in the main task path.

## Implementation sequence and review gates

| Phase | Work | Deliverable | Exit gate |
| --- | --- | --- | --- |
| 0. Baseline | Capture current popup, dashboard, popover, profile, recommendation, and problem states at desktop and narrow widths. Audit keyboard flow, contrast, reflow, loading, error, cached, and incomplete-sync states. Run 3–5 short task observations if users are available. | Screenshot/state inventory and prioritized issue list | Identify the top three task failures or confusion points; record the current task completion baseline. |
| 1. Foundations | Define tokens, typography, spacing, component variants, content rules, and light/dark behavior. Build a small state gallery using real components and fixture data. | Shared design tokens and component examples | Contrast and focus checks pass; no token depends on Codeforces host CSS. |
| 2. Core journeys | Redesign the popup/onboarding, toolbar popover, and recommendation card flow. Keep the same API and storage contracts. | Usable “connect → choose → complete” journey | Users can find the next task and record an outcome without instruction; state-specific copy remains truthful. |
| 3. Data views | Redesign profile chart and forecast, then give the full dashboard a distinct analysis layout. | Accessible chart, forecast summary, dashboard sections | Users can distinguish official data from estimates; keyboard and text alternatives cover the chart. |
| 4. In-page polish | Unify verdict controls with the timer, tighten placement around Codeforces content, and test popover positioning. | Consistent problem-page UI | No page-content obstruction or broken Codeforces controls in supported browsers. |
| 5. Release | Compare before/after task outcomes, run automated and manual accessibility checks, test Firefox and Chrome packages, then roll out. | Release-ready screenshots, QA report, migration notes | Acceptance criteria below pass and no data or timer-state regression appears. |

Each phase should be a reviewable change. Begin with screenshots and flows before rewriting components. Reuse the current timer as the visual reference for restraint, but check its accessibility in the same audit.

### Proposed code map

- Add shared token and primitive styles under `src/ui/`; consume them from `src/app/styles.css` and `src/content/content.css`, with Shadow DOM scoped token values for in-page UI.
- Split `PracticeApp.tsx` into popup-specific overview and reusable account/practice sections. Give `DashboardApp.tsx` its own composition while both use the same service calls.
- Refactor `TopBarHabitPill.tsx` into the summary pill plus small popover sections. Reuse the recommendation card from `PracticeRecommendations.tsx` instead of maintaining separate layouts.
- Refactor `ProfileHorizonCard.tsx` into history, forecast, and data-status sections. Improve `HorizonChart.tsx` alongside a text summary and table, retaining its existing data types.
- Update `ProblemVerdictBar.tsx` styling and interaction after the shared component rules settle. Keep `ProblemTimerWidget.tsx` behavior and saved-state shape intact.
- Start with CSS and current React components; add a UI dependency only if a concrete accessibility or interaction need cannot be met cleanly with the existing stack.

## Acceptance criteria

- At 320 CSS px equivalent width and 200% text zoom, primary tasks remain available without horizontal page scrolling; chart areas may use their own intentional data viewport. [W3C reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).
- Core controls work by keyboard in a logical order, retain visible focus, and have usable target size. WCAG 2.2 AA minimum target guidance is 24×24 CSS px or adequate spacing; use roughly 40px targets for primary actions where space permits. [W3C target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum), [focus appearance](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance).
- Normal text reaches at least 4.5:1 contrast and essential non-text UI at least 3:1. Status never relies on color alone. [WCAG 2.2](https://www.w3.org/TR/WCAG22/).
- A user can tell whether a displayed number is official, forecast, a local practice count, or an incomplete/cached value without reading a long explanation.
- The popup has one obvious primary action in each state; the full dashboard adds useful depth instead of repeating the popup.
- The full suite of existing behavior tests passes. Add interaction and browser checks for the redesigned paths, including persistence, feedback recording, and Shadow DOM isolation.
- In task testing, compare against the phase-0 baseline. Target at least 90% unassisted completion of “connect a handle,” “start a recommended problem,” and “find the forecast range”; investigate any task that gets slower or more confusing.

## Boundaries and risks

- Design changes must not silently change rating forecasts, recommendation rankings, saved practice outcomes, or per-problem timer state.
- The extension is injected into a third-party page. Its Shadow DOM protects styling, but page width, zoom, language, and native layout vary; validate on live Codeforces pages as well as fixtures.
- “Modern” styling should not reduce legibility. Tiny secondary text, low contrast, motion, and icon-only actions are explicit review risks.
- If a dark palette is added, test every chart band and status state in both palettes. Do not infer a host theme from a single background sample.

## Reference basis

- [Apple Human Interface Guidelines: Design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles/) and [Charts](https://developer.apple.com/design/human-interface-guidelines/charts/)
- [Google: Material 3 Expressive overview](https://blog.google/products-and-platforms/platforms/android/material-3-expressive-android-wearos-launch/)
- [Microsoft Fluent 2: Design principles](https://fluent2.microsoft.design/design-principles) and [Accessibility](https://fluent2.microsoft.design/accessibility)
- [W3C: WCAG 2.2](https://www.w3.org/TR/WCAG22/), [Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), and [Complex images](https://www.w3.org/WAI/tutorials/images/complex/)
