# Mobile layout

At widths up to 640px the app uses a phone layout automatically: a compact bottom
dock for the five sections, the same sub-tabs as wider screens, and app-like touch
feedback. Desktop and tablet layouts, financial calculations, permissions and sync
are unchanged.

## Navigation dock

- One rule applies on every view. The dock hides after 40px of downward scrolling
  and returns after 10px upward, without a recall pill. Travel resets when the
  direction changes, so tiny reversals never toggle it.
- The dock stays visible in the first 64px of a page and within one dock height
  plus 16px of its end, so the last content is never left above an empty gap.
  Views with less than four dock heights of scroll keep it pinned, because hiding
  would gain no reading room and would flicker against the end zone.
- Only width changes reset the dock. Mobile browsers change the viewport height
  while their URL bar collapses, which previously revealed the dock mid-scroll.
- Lazy content and scroll anchoring can move the page without input. Those frames
  only count when wheel, touch or key input happened in the last 500ms.
- Hiding only transforms the dock, so document height and content coordinates stay
  stable. Bottom clearance is the dock height plus 8px, including the safe area.
- Keyboard and assistive-technology focus reveal the dock; its controls stay in the
  accessibility tree. Reselecting the active section returns to the top without
  repainting Settings forms or discarding drafts.

## Controls and motion

- Tab icons share one 16px square frame on a 24px grid with matching 1.7px strokes.
- On phones, Portfolio, Log data and Settings sub-tabs use one segmented control at
  the compact btn-sm size, with a white pill marking the active view. Wider screens
  keep their existing sub-tab buttons.
- The active highlight in the dock, the desktop tab bar and every sub-tab row
  slides to the selected tab ([tabIndicator.ts](../src/ui/tabIndicator.ts)). Rows
  that were hidden snap into place when shown. Reduced motion disables the slide.
- Taps show no browser highlight, and focus rings appear only for keyboard focus.
- On phones, "Add monthly snapshot" becomes a compact "+ Snapshot" button on the
  Log sub-tab row, and an icon-only square button below 360px. Its accessible name
  is unchanged.
- Warning dots only show help when hovered directly. Tapping a navigation dot
  selects its tab. Holdings explains allocation warnings in its content.

## Scroll regression

The exploratory native `dialog.showModal()` sheet moved WebKit's background page
from 0px to 101px when opened, so Settings uses direct tabs instead. Dialogs use
the app's [modal shell](../src/ui/modalShell.ts), body scroll lock and focus trap.
Initial and restored focus use `preventScroll`.

[Browser regressions](../tests/e2e/mobile-navigation.spec.ts) cover the dock rule
on every view, URL-bar resizes, thresholds, direction reversal, page-end clearance,
keyboard recovery, icon geometry, sliding highlights, the snapshot action, warning
dots, phone widths and unchanged wider layouts. Run with:

```sh
corepack yarn test:e2e mobile-navigation.spec.ts
```

Physical iOS and Android checks remain worthwhile for software keyboards, safe
areas, fast flings, rubber-band edges, VoiceOver, TalkBack and large text.
