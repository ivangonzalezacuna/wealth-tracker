export const ISIN = {
  'IE00B4L5Y983': 'IWDA',
  'IE00BYX2JD69': 'SUSW',
  'IE00BKM4GZ66': 'EIMI',
  'IE00BDBRDM35': 'AGGH',
  'IE00B0M63177': 'IEEM',
  'IE00B3F81R35': 'IEAC',
  'IE00BGJWWW40': 'EIBX',
};

export const META = {
  IWDA: { color: '#2a78d6', acc: true,  active: true  },
  SUSW: { color: '#1baf7a', acc: true,  active: true  },
  EIMI: { color: '#eda100', acc: true,  active: true  },
  AGGH: { color: '#4a3aa7', acc: true,  active: true  },
  IEEM: { color: '#e34948', acc: false, active: false },
  IEAC: { color: '#e87ba4', acc: false, active: false },
  EIBX: { color: '#eb6834', acc: false, active: false },
};

export const ISIN_ORDER = [
  'IE00B4L5Y983',
  'IE00BYX2JD69',
  'IE00BKM4GZ66',
  'IE00BDBRDM35',
  'IE00B0M63177',
  'IE00B3F81R35',
  'IE00BGJWWW40',
];

export const ACCTS = [
  { key: 'tr_portfolio', label: 'TR ETF',  color: '#2a78d6' },
  { key: 'n26',          label: 'N26',      color: '#1baf7a' },
  { key: 'bav',          label: 'bAV',      color: '#eda100' },
  { key: 'avd',          label: 'AVD',      color: '#4a3aa7' },
  { key: 'tr_cash',      label: 'TR Cash',  color: '#e87ba4' },
];

// Google Sheets tab names
export const SHEET_TABS = {
  SNAPSHOTS:    'Snapshots',
  TRANSACTIONS: 'Transactions',
  META_INFO:    'Meta',
};
