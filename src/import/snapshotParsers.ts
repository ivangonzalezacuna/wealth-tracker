import {
  matchesTradeRepublicStatement,
  parseTradeRepublicStatement,
} from './snapshotTradeRepublic';
import type { PdfTextPage, SnapshotParser, SnapshotStatement } from './snapshotStatement';

export const snapshotParsers: SnapshotParser[] = [
  {
    id: 'trade-republic:valuation',
    label: 'Trade Republic valuation',
    mapping: { kind: 'investment' },
    matches: matchesTradeRepublicStatement,
    parse: parseTradeRepublicStatement,
  },
];

export function getSnapshotParser(type: string): SnapshotParser {
  const parser = snapshotParsers.find((entry) => entry.id === type);
  if (!parser) throw new Error('Unsupported statement type. No parser is registered.');
  return parser;
}

export function parseSnapshotStatement(pages: PdfTextPage[]): SnapshotStatement {
  const matches = snapshotParsers.filter((parser) => parser.matches(pages));
  if (matches.length !== 1)
    throw new Error(
      matches.length
        ? 'Ambiguous statement: multiple parsers recognize this report.'
        : 'Unsupported statement. No registered parser recognizes this report.',
    );
  const parser = matches[0];
  const statement = parser.parse(pages);
  if (statement.documentType !== parser.id || statement.currency !== 'EUR')
    throw new Error('The parser returned an inconsistent statement type or currency.');
  const values = [
    ...statement.positions.map((position) => position.value),
    ...Object.values(statement.balances || {}),
    ...[statement.total, statement.securities, statement.cash].filter(
      (value) => value !== undefined,
    ),
  ];
  if (
    values.some(
      (value) => !Number.isFinite(value) || !Number.isSafeInteger(Math.round(value * 100)),
    )
  )
    throw new Error('The parser returned an invalid statement value.');
  if (parser.mapping.kind === 'balances' && statement.positions.length)
    throw new Error('Account-balance reports cannot include ETF allocations.');
  return statement;
}
