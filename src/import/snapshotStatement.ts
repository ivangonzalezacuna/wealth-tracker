export interface PdfTextItem {
  text: string;
  x: number;
  y: number;
}

export interface PdfTextPage {
  items: PdfTextItem[];
}

export interface StatementPosition {
  isin: string;
  name: string;
  value: number;
  page: number;
}

export interface SnapshotStatement {
  documentType: string;
  date: string;
  currency: 'EUR';
  positions: StatementPosition[];
  securities?: number;
  cash?: number;
  total?: number;
  balances?: Record<string, number>;
  warnings: string[];
}

export interface StatementBalanceSlot {
  key: string;
  label: string;
  moneyTypes: readonly string[];
}

export interface SnapshotParser {
  id: string;
  label: string;
  mapping: { kind: 'investment' } | { kind: 'balances'; slots: readonly StatementBalanceSlot[] };
  matches(pages: PdfTextPage[]): boolean;
  parse(pages: PdfTextPage[]): SnapshotStatement;
}
