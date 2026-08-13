import { TOOLTIP_BOX } from './chartLegend';

interface ChartTheme {
  surface: string;
  line: string;
  ink: string;
  ink2: string;
  ink4: string;
}

export function buildBaseChartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false as const },
    },
  };
}

export function buildBaseTooltipOptions(theme: ChartTheme, includeFooter = false) {
  return {
    backgroundColor: theme.surface,
    ...TOOLTIP_BOX,
    borderColor: theme.line,
    borderWidth: 1,
    titleColor: theme.ink,
    bodyColor: theme.ink2,
    footerColor: includeFooter ? theme.ink4 : undefined,
    footerFont: includeFooter ? ({ weight: 'normal' as const, size: 10 } as const) : undefined,
    footerMarginTop: includeFooter ? 6 : undefined,
    padding: 10,
    cornerRadius: 8,
  };
}

function toNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value || 0);
}

export function formatEuroCompactSuffix(value: unknown): string {
  const n = toNumber(value);
  return n >= 1000 ? `${(n / 1000).toFixed(0)}k\u00A0€` : `${n}\u00A0€`;
}

export function formatEuroCompactPrefix(value: unknown): string {
  const n = toNumber(value);
  return n >= 1000 ? `€${Math.round(n / 1000)}k` : `€${n}`;
}

export function formatEuroPrefix(value: unknown): string {
  return `€${toNumber(value).toFixed(0)}`;
}

export function formatPercentRounded(value: unknown): string {
  return `${toNumber(value).toFixed(0)}%`;
}
