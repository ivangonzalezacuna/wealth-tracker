import { resolvedT } from '../../theme';

export interface ChartTokens {
  surface: string;
  surface3: string;
  ink: string;
  ink2: string;
  ink3: string;
  ink4: string;
  line: string;
  line2: string;
  brand: string;
  brandWeak: string;
  brandBorder: string;
  brandText: string;
  pos: string;
  neg: string;
  warn: string;
  fontFamily: string;
}

const CSS_VARS: Partial<Record<keyof ChartTokens, string>> = {
  surface: '--surface',
  surface3: '--surface-3',
  ink: '--ink',
  ink2: '--ink-2',
  ink3: '--ink-3',
  ink4: '--ink-4',
  line: '--line',
  line2: '--line-2',
  brand: '--brand-chart',
  brandWeak: '--brand-weak',
  brandBorder: '--brand-border',
  brandText: '--brand',
  pos: '--pos',
  neg: '--neg',
  warn: '--warn',
};

/** Resolve chart colours from the live CSS custom properties, falling back to the TS mirror. */
export function readChartTokens(): ChartTokens {
  const C = resolvedT();
  const fallback: ChartTokens = {
    surface: C.surface,
    surface3: C.surface3,
    ink: C.ink,
    ink2: C.ink2,
    ink3: C.ink3,
    ink4: C.ink4,
    line: C.line,
    line2: C.line2,
    brand: C.brandChart,
    brandWeak: C.brandWeak,
    brandBorder: C.brandBorder,
    brandText: C.brand,
    pos: C.pos,
    neg: C.neg,
    warn: C.warn,
    fontFamily: "'Inter', system-ui, sans-serif",
  };
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return fallback;
  const css = getComputedStyle(document.documentElement);
  const out = { ...fallback };
  for (const [key, name] of Object.entries(CSS_VARS) as [keyof ChartTokens, string][]) {
    const v = css.getPropertyValue(name).trim();
    if (v) out[key] = v;
  }
  const font = document.body ? getComputedStyle(document.body).fontFamily : '';
  if (font) out.fontFamily = font;
  return out;
}

/** Default series colours (shared by the theme and the HTML legend). */
export function chartPalette(t: ChartTokens): string[] {
  return [t.brand, t.pos, t.warn, t.neg, t.ink3];
}

/** ECharts theme object built from the app tokens (axis, tooltip, legend, toolbox, dataZoom). */
export function buildChartTheme(t: ChartTokens = readChartTokens()): Record<string, unknown> {
  const axisCommon = {
    axisLine: { show: true, lineStyle: { color: t.line2 } },
    axisTick: { show: false },
    axisLabel: { color: t.ink4, fontSize: 10, hideOverlap: true },
    splitLine: { show: true, lineStyle: { color: t.line } },
    splitArea: { show: false },
    nameTextStyle: { color: t.ink4 },
  };
  const categoryLike = {
    ...axisCommon,
    axisLabel: { ...axisCommon.axisLabel, color: t.ink2 },
    splitLine: { show: false },
  };
  return {
    color: chartPalette(t),
    backgroundColor: 'transparent',
    textStyle: { fontFamily: t.fontFamily, color: t.ink2 },
    title: { textStyle: { color: t.ink }, subtextStyle: { color: t.ink4 } },
    categoryAxis: categoryLike,
    timeAxis: categoryLike,
    valueAxis: { ...axisCommon, axisLine: { show: false } },
    logAxis: { ...axisCommon, axisLine: { show: false } },
    legend: {
      textStyle: { color: t.ink2, fontSize: 12 },
      inactiveColor: t.line2,
      pageIconColor: t.ink2,
      pageIconInactiveColor: t.line2,
      pageTextStyle: { color: t.ink4 },
      selectorLabel: {
        color: t.ink2,
        borderColor: t.line,
        backgroundColor: t.surface,
        borderRadius: 6,
      },
      emphasis: { selectorLabel: { color: t.brand, borderColor: t.brand } },
    },
    tooltip: {
      backgroundColor: t.surface,
      borderColor: t.line,
      borderWidth: 1,
      padding: 10,
      textStyle: { color: t.ink2, fontSize: 12 },
      extraCssText: 'border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);',
      axisPointer: {
        lineStyle: { color: t.line2 },
        crossStyle: { color: t.line2 },
        label: { backgroundColor: t.ink2, color: t.surface },
      },
    },
    axisPointer: {
      lineStyle: { color: t.line2 },
      crossStyle: { color: t.line2 },
      label: { backgroundColor: t.ink2, color: t.surface },
    },
    toolbox: {
      iconStyle: { borderColor: t.ink4 },
      emphasis: { iconStyle: { borderColor: t.brand, textFill: t.ink2 } },
    },
    dataZoom: {
      borderColor: t.line,
      backgroundColor: 'transparent',
      fillerColor: `${toRgba(t.brand, 0.12)}`,
      handleStyle: { color: t.surface, borderColor: t.ink4 },
      moveHandleStyle: { color: t.line2 },
      textStyle: { color: t.ink4 },
      dataBackground: {
        lineStyle: { color: t.line2 },
        areaStyle: { color: t.surface3 },
      },
      selectedDataBackground: {
        lineStyle: { color: t.brand },
        areaStyle: { color: toRgba(t.brand, 0.18) },
      },
      emphasis: { handleStyle: { borderColor: t.brand } },
    },
    markLine: { label: { color: t.ink2 }, lineStyle: { color: t.ink4 } },
    markPoint: { label: { color: t.ink } },
    line: { symbol: 'circle', symbolSize: 5, smooth: 0.3 },
    bar: { barMaxWidth: 28 },
  };
}

/** `#rgb`/`#rrggbb` → `rgba(r,g,b,a)`; returns the input untouched for other formats. */
export function toRgba(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  let hex = m[1];
  if (hex.length === 3)
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  const n = parseInt(hex, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
