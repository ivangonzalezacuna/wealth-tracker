# Ideas

Loose ideas that are not on the [roadmap](../ROADMAP.md) yet. Nothing here is committed work.

## Sign-in screen with the app icon

Show the app icon, the name and a one-line privacy statement above the Google sign-in button, for example: "Your data stays on your device and in your own Drive." The icon is `public/icon.svg`. The text should state exactly what the README says about storage and sync.

## Snapshot month calendar

A 12-month strip for the selected year, shown on the Log data screen and possibly inside the snapshot dialog.

- Logged months are filled, missing months stay empty, and the next open month is a dashed cell with a plus that opens the snapshot dialog.
- Makes gaps visible, which matters because risk summaries and the return heatmap need complete monthly history.
- Natural fit for the planned monthly reminder: the strip shows what the reminder is asking for.
- Reuse the month-grid icon concept (rounded cells, brand blue for logged months, green for the current open month).

Open questions: how to handle multiple years, whether a cell should show the month's total, and how to make the grid keyboard accessible.

## Considered and dropped

- Allocation donut as a Portfolio overview card. Analytics already shows allocation, so it would duplicate it.
- Donut or month grid as the app icon. The rising bars icon tells the "tracking over time" story more clearly and is easier to read at 16px.
