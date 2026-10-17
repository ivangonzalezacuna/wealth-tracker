# Responsive controls and presentation

The application uses its existing theme tokens for native form controls,
readable metric labels and numeric chart tables. Financial calculations and
stored values are unchanged.

## Native-first month fields

Goal targets, milestone deadlines, snapshots and retirement planning retain
`input type="month"` and the browser's picker where supported. Goal and milestone
inputs are visible and keyboard-reachable rather than hidden behind a
`showPicker()` button.

Browsers without native month support expose the same field as text, with a
`YYYY-MM` example and explicit validation of the year, month and applicable
minimum/maximum. Optional goal dates can still be cleared; milestone deadlines
remain disabled until a valid goal date exists.

The input follows the effective application light/dark `color-scheme`. The
browser or operating system still controls the native popup's colors, language
and layout; exact theme-token matching is not guaranteed. There is no custom
calendar or replacement ARIA widget.

## Limited native-select enhancement

The account contribution interval and transaction type selectors opt into
`appearance: base-select` and `::picker(select)` only when both are supported and
the environment has a fine pointer and hover. Their option panels then use
application surface, text, border and selection colors.

Mobile and unsupported engines keep their normal native selectors. Escape
closes an open select before dismissing its containing dialog.

## Readability and feedback

- KPI labels wrap rather than truncate their metric names.
- Holdings headers wrap within their columns.
- Holding details distinguish position lifecycle (held/closed) from allocation
  participation (active/inactive).
- Drawdown axis labels retain fractional tick values.
- Chart data tables right-align explicitly identified numeric columns, including
  formatted currency and percentage values, across pagination. Dates and labels
  keep their normal alignment.
- Corrected transaction-name errors clear after typing or security autocomplete.
- CSV import instructions explain sign-in and temporary sync restrictions
  without suggesting that disabled import is available.

Focused unit tests cover validation, correction, clearing, modal keyboard
handling, numeric-column metadata, position labels and drawdown tick labels.
Real-device native popup appearance, screen-reader behavior and forced-colors
rendering still need manual review.
