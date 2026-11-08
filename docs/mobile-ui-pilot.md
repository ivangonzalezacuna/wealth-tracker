# Mobile UI pilot

Open the app with `?mobile-ui=1` before its section hash, for example
`http://localhost:5173/?mobile-ui=1#settings/advanced`. Remove the parameter and
reload to return to the existing layout. The pilot applies at widths up to 640px.
Desktop and tablet layouts, financial calculations, permissions and sync are unchanged.

## Navigation

- The compact bottom dock hides after 48px of downward scrolling below the first
  80px of the page and returns after 10px upward, without a recall pill. Keyboard and
  assistive-technology focus reveal it; its controls stay in the accessibility tree.
- Tiny direction reversals do not toggle the dock. Hiding only transforms the
  navigation, so document height and content coordinates stay stable.
- The dock returns within one dock height plus 16px of the page end. Bottom
  clearance is fixed at the dock height plus 8px, including the safe area, rather
  than shrinking and expanding as the dock moves. This keeps the last content
  accessible without an empty hidden-dock tail, scroll clamping or layout jumps.
  Existing card margins can add a small gap; browser tests cap the actual
  long-view section-end clearance at 24px. Naturally short pages still have
  unused viewport space, which is not artificial scroll padding.
- Portfolio, Log data and Settings use the same visible, non-sticky segmented
  sub-tabs, with 36px targets and restrained horizontal padding.
- Reselecting any active dock tab returns to the top. In Settings this does not
  repaint the form or discard unsaved fields.
- Warning dots only show help when hovered directly, never over the whole tab.
  Clicking or tapping a navigation dot selects the tab instead of consuming the
  click. Holdings shows the allocation warning in its content, so touch users do
  not need a tooltip to understand it. Card-level help remains available.
- Projections and chart controls remain local to their cards. Browser Back policy
  is unchanged.

## Layout decision

| Layout                  | Section change                | Strength                                              | Trade-off                                           |
| ----------------------- | ----------------------------- | ----------------------------------------------------- | --------------------------------------------------- |
| Visible segmented tabs  | One tap                       | Familiar, discoverable and consistent across sections | A compact row above content                         |
| Header picker and sheet | Two taps                      | Saves one row                                         | Hides choices and adds a second interaction pattern |
| Persistent bottom dock  | One tap                       | Most predictable access                               | Permanently occupies 57px plus safe area            |
| Directional bottom dock | One tap after upward recovery | More reading room on long views                       | Needs physical-device scroll testing                |

The recommended pilot pairs visible segmented tabs with a responsive directional
dock. Settings has only three views, so a sheet adds more interaction than it
saves. Keep the hierarchy consistent: app section at the bottom, sibling views
above content, explanations in the affected view. This avoids gesture-only
navigation, floating recall controls and oversized touch controls.

The previous 100px hide threshold and 250ms cooldown felt sluggish. The revised
48px/10px thresholds retain directional accumulation; 140ms hysteresis limits
rehiding but never delays an upward reveal. Tiny alternating movements do not
toggle the dock.

## Scroll regression

The exploratory native `dialog.showModal()` sheet moved WebKit's background page
from 0px to 101px when opened. The Settings picker has now been removed in favour
of direct tabs. Existing dialogs still use the app's
[modal shell](../src/ui/modalShell.ts), body scroll lock and focus trap. Initial
and restored focus use `preventScroll`, so focusing a control does not request
scrolling its ancestor page into view.

[Browser regressions](../tests/e2e/mobile-navigation.spec.ts) cover active-section
reselection, draft retention, exact scroll thresholds, direction reversal,
keyboard recovery, warning-dot selection, nested editor scrolling, consistent
section controls, phone widths and unchanged wider layouts. Run with:

```sh
corepack yarn test:e2e mobile-navigation.spec.ts
```

Before broader rollout, test physical iOS/Android devices in browser and installed
mode, especially software keyboards, safe areas, fast flings, rubber-band edges,
VoiceOver/TalkBack and large text. Browser automation does not replace those checks.
