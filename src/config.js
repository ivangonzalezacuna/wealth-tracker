/**
 * ─────────────────────────────────────────────────────────────
 *  USER CONFIGURATION  —  edit this file, nothing else.
 * ─────────────────────────────────────────────────────────────
 *  Everything personal lives here: your accounts, your holdings,
 *  your target allocation and your reference notes. The rest of
 *  the app derives from this object, so adapting the dashboard to
 *  a different person means changing only this file.
 *
 *  The defaults below reproduce the original setup exactly.
 */

export const CONFIG = {
  // ── App header ─────────────────────────────────────────────
  app: {
    title:    'Finance Dashboard',
    subtitle: 'ETF portfolio · N26 savings · Ginkgo bAV · Net worth tracker',
  },

  // ── Accounts tracked in each monthly snapshot ──────────────
  //  key   — stable id; also the column name in the Snapshots sheet.
  //          Safe to add/remove accounts later. Avoid RENAMING a key
  //          once data exists (rename = new column = old data ignored).
  //  label — shown in the UI and charts.
  //  color — chart colour.
  //  form  — how the input renders on the Log tab:
  //            label       (defaults to "<label> (€)")
  //            hint        (small grey text after the label, optional)
  //            placeholder (input placeholder, optional)
  accounts: [
    { key: 'tr_portfolio', label: 'TR ETF', color: '#2a78d6',
      form: { label: 'TR ETF portfolio — total value (€)', placeholder: 'TR home screen total' } },
    { key: 'n26', label: 'N26', color: '#1baf7a',
      form: { label: 'N26 — total balance (€)', hint: 'current + savings', placeholder: 'N26 current + savings' } },
    { key: 'bav', label: 'bAV', color: '#eda100',
      form: { label: 'Ginkgo bAV (€)', placeholder: 'from Ginkgo statement' } },
    { key: 'avd', label: 'AVD', color: '#4a3aa7',
      form: { label: 'AVD (€) — optional', placeholder: 'when set up Jan 2027' } },
    { key: 'tr_cash', label: 'TR Cash', color: '#e87ba4',
      form: { label: 'TR Cash / savings (€)', placeholder: '0 if fully invested' } },
  ],

  // ── Holdings: map each ISIN to display metadata ────────────
  //  Order here = display order across the whole app.
  //  acc    — accumulating (true) vs distributing (false)
  //  active — receiving new contributions (true) vs closed (false)
  holdings: [
    { isin: 'IE00B4L5Y983', ticker: 'IWDA', color: '#2a78d6', acc: true,  active: true  },
    { isin: 'IE00BYX2JD69', ticker: 'SUSW', color: '#1baf7a', acc: true,  active: true  },
    { isin: 'IE00BKM4GZ66', ticker: 'EIMI', color: '#eda100', acc: true,  active: true  },
    { isin: 'IE00BDBRDM35', ticker: 'AGGH', color: '#4a3aa7', acc: true,  active: true  },
    { isin: 'IE00B0M63177', ticker: 'IEEM', color: '#e34948', acc: false, active: false },
    { isin: 'IE00B3F81R35', ticker: 'IEAC', color: '#e87ba4', acc: false, active: false },
    { isin: 'IE00BGJWWW40', ticker: 'EIBX', color: '#eb6834', acc: false, active: false },
  ],

  // ── Reference tab: target allocation (steady state) ────────
  targetAllocation: {
    title: 'Target allocation — steady state',
    slices: [
      { ticker: 'IWDA', pct: 45, color: '#2a78d6' },
      { ticker: 'SUSW', pct: 15, color: '#1baf7a' },
      { ticker: 'EIMI', pct: 20, color: '#eda100' },
      { ticker: 'AGGH', pct: 20, color: '#4a3aa7' },
    ],
    breakdown: [
      { label: 'Equity (IWDA + SUSW + EIMI)', value: '80%' },
      { label: 'Bonds (AGGH)',                value: '20%' },
      { label: 'Developed equity',            value: '60%' },
      { label: 'Emerging equity',             value: '20%' },
      { label: 'EM as % of equity',           value: '25%' },
    ],
    note: 'Weekly target: IWDA €90 · SUSW €30 · EIMI €40 · AGGH €40',
  },

  // ── Reference tab: closed / diluting positions ─────────────
  closedPositions: {
    title: 'Closed positions — diluting naturally',
    rows: [
      { label: 'IEEM → EIMI (both EM)',    badge: 'no new money' },
      { label: 'IEAC → AGGH (both bonds)', badge: 'no new money' },
      { label: 'EIBX → AGGH (both bonds)', badge: 'no new money' },
    ],
    note: 'No action needed — they fade toward below 1% as new contributions grow the active positions. Selling may trigger Abgeltungsteuer. Fold in only for a clean 4-fund portfolio.',
  },

  // ── Reference tab: reinvestment rules / key facts ──────────
  reinvestmentRules: {
    title: 'Reinvestment rules',
    rows: [
      { label: 'Net pay raise → ETFs',                                value: '50%' },
      { label: 'Net pay raise → bAV top-up (toward SV-frei ceiling)', value: '25%' },
      { label: 'Net pay raise → lifestyle / buffer',                  value: '25%' },
      { label: 'Rent decrease → ETFs',                                value: '60–70%' },
      { label: 'bAV SV-frei ceiling (2026)',                          value: '€338 / month' },
      { label: 'AVD start date',                                      value: 'January 2027' },
    ],
  },

  // ── Contributions tab: 5-year projection assumptions ───────
  projection: {
    annualReturnPct: 7,    // assumed annual return, %
    weeklyTarget:    200,  // long-term target contribution, € / week
  },
};
