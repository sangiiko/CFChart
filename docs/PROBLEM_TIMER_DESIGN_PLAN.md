# Problem timer redesign plan

## Direction

Make the timer feel like a quiet utility beside a Codeforces problem: the time is the focal point, the next action is obvious, and settings stay available without occupying the problem page. Use CFChart's neutral surface and blue accent rather than imitating another company's branding or assets.

The design borrows principles, not pixels: Apple's emphasis on a focused hierarchy and clear state feedback, Google's filled/outlined/text button hierarchy and determinate progress, and Microsoft's guidance to give one action primary visual weight. References are listed below.

## What needs improvement in the current component

`src/content/components/ProblemTimerWidget.tsx` and `src/content/content.css` currently show a header icon, title, running/paused badge, full-text mode switch, collapse button, large actions, four preset pills, a second limit selector, elapsed/target footer, and a long warning card. The clock is only 26px while surrounding controls compete for attention. The preset pills and dropdown largely duplicate each other. The idle state is labeled “Paused,” and the collapsed state hides the clock. Expiry copy mixes Vietnamese with the otherwise English interface.

These are presentation problems; preserve the existing stopwatch/countdown, storage, elapsed-time handoff to the verdict bar, and per-problem timer behavior.

## Proposed interaction

### Expanded timer

```text
Practice timer                                      ···   ⌃

           18:42                         [ Pause ]
           of 20 min
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━─────
```

- The clock uses **32–36px tabular numerals** and stays in the same position as digits change. A short label below it says `of 20 min` for countdown or `Elapsed` for stopwatch.
- Show **one filled primary button**: `Start`, `Pause`, or `Resume`. The label describes the next action. Keep the button at least 40px tall and comfortably separated from nearby controls.
- A thin, determinate bar appears **only in countdown mode**. It shows elapsed share of the chosen limit and never implies progress toward solving the problem. At zero it remains full; overtime is shown as text, not as a bar that exceeds 100%.
- Replace the full-text mode switch, preset row, duplicate selector, and reset button with a quiet `···` menu. It contains `Mode: Countdown / Stopwatch`, `Duration: 15 / 20 / 30 / 45 min`, `Custom duration…`, and `Reset timer`. Show the currently selected mode and duration in the menu. Changing the duration applies immediately and keeps elapsed time.
- Use a restrained border and flat surface; remove the emoji, heavy shadow, dashed footer divider, and colored status badge. Use CFChart blue for the active progress and primary action. A single muted status label can say `Paused` or `Over time` when needed.

### Collapsed timer

```text
18:42 left    · Countdown              [ Pause ]   ⌄
```

Collapse must preserve the time and primary action. This is the useful compact state on a long problem statement. Keep the selected mode and running/paused state readable without opening the full card.

### When time runs out

Use a small amber inline message under the clock: `Time limit reached. Take a hint or continue when you're ready.` Include `+5 min` and `Continue` as low-emphasis actions. Avoid a large warning panel, alarm-like styling, or language suggesting the user has failed. Do not auto-pause or open an editorial. Keep the message until the user acts; use an explicit acknowledgement state so it does not reappear needlessly after a rerender.

### Reset and mode changes

`Reset timer` belongs in the menu because it is infrequent and discards elapsed time. Ask for confirmation only when elapsed time is substantial (for example, over one minute); otherwise reset immediately. Switching between countdown and stopwatch preserves elapsed time and clearly updates the clock label. The timer must resume from saved state after navigation or reload, as it does now.

## Responsive behavior

- On a wide problem page, use a compact horizontal card with the clock and primary button aligned on one row.
- At narrow widths, stack the button below the clock and let it fill the card width. Keep the overflow and collapse controls reachable without horizontal scrolling.
- Keep the timer visually subordinate to the problem title and statement. Its collapsed state should fit naturally below the title without pushing the statement far down.
- Match both light and dark page contexts where CFChart supports them; avoid a forced white rectangle against a dark host page. Use local design tokens so Shadow DOM isolation remains intact.

## Accessibility and copy

- Use text labels in addition to icons. The overflow button needs an accessible name such as `Timer settings`; collapse needs `Collapse timer` or `Expand timer` and `aria-expanded`.
- Announce **state transitions** (`Timer started`, `Paused`, `Time limit reached`) through a polite live region. Do not announce every second. The clock itself should have a readable accessible label, for example `18 minutes 42 seconds remaining`.
- Support keyboard operation, visible focus, sufficient color contrast, and reduced-motion preferences. The progress bar needs a label and `aria-valuenow`, `aria-valuemin`, and `aria-valuemax` if exposed as `role="progressbar"`.
- Use consistent English in the default UI; localize all strings together if Vietnamese is added. Suggested short labels: `Practice timer`, `Start`, `Pause`, `Resume`, `Countdown`, `Stopwatch`, `Time limit reached`, `+5 min`, `Continue`, `Reset timer`.

## Implementation sequence

1. **Prototype the states.** Produce one visual sheet for idle, running, paused, collapsed, and expired at desktop and narrow widths. Confirm the hierarchy before touching timer logic.
2. **Refactor the component presentation.** Keep the persisted `StoredTimerState` shape and `onTimeUpdate` contract. Extract small view pieces for clock, actions, settings menu, and expiry notice; keep one source of truth for elapsed time.
3. **Replace the CSS.** Use a small token set for surface, border, text, accent, and warning. Remove redundant pills, badge, emoji, shadow, and footer rules. Use `font-variant-numeric: tabular-nums`.
4. **Check interaction states.** Verify start/pause/resume, changing mode and duration, +5 minutes, reset confirmation, collapse, reload, and the verdict bar's elapsed-time capture. Test with a keyboard and screen reader, and inspect desktop and narrow screenshots in the actual Codeforces page context.
5. **Ship only after visual review.** Compare the new card against the current one for page intrusion, legibility, and ease of starting/pausing. Keep timer mechanics unchanged unless a state bug is found during implementation.

## Acceptance criteria

- A first-time user can identify the remaining or elapsed time and the next action at a glance.
- Expanded timer has one visually dominant action; advanced controls are reachable in one click.
- Collapsed timer still shows time and supports pause/resume.
- Expiry is noticeable without blocking the problem or repeatedly interrupting the user.
- No duplicate duration controls or mixed-language copy remain.
- Existing timer persistence and verdict-bar time handoff continue to work.
- No horizontal overflow at narrow widths, and keyboard/screen-reader use is practical.

## Design references

- [Apple Human Interface Guidelines: Design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles/) — focus, hierarchy, concise copy, and clear feedback.
- [Apple Human Interface Guidelines: Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) — avoid time-limited, self-dismissed information that is hard to process.
- [Google Material Web: Buttons](https://material-web.dev/components/button/) and [Progress indicators](https://material-web.dev/components/progress/) — clear button emphasis and determinate progress.
- [Microsoft Fluent 2: Button](https://fluent2.microsoft.design/components/web/react/core/button/usage) — one primary action in a layout and meaningful labels.
