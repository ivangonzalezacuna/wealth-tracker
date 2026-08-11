import type Chart from 'chart.js/auto';

export interface ChartRegistry {
  CH: Record<string, Chart>;
  destroyChart: (id: string) => void;
}

export function createChartRegistry(): ChartRegistry {
  const CH: Record<string, Chart> = {};
  const destroyChart = (id: string): void => {
    if (CH[id]) {
      CH[id].destroy();
      delete CH[id];
    }
  };
  return { CH, destroyChart };
}
