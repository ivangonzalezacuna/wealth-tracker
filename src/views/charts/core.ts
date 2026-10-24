import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import type { BarSeriesOption, LineSeriesOption, PieSeriesOption } from 'echarts/charts';
import {
  AriaComponent,
  AxisPointerComponent,
  DataZoomComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  ToolboxComponent,
  TooltipComponent,
} from 'echarts/components';
import type {
  AriaComponentOption,
  AxisPointerComponentOption,
  DataZoomComponentOption,
  GraphicComponentOption,
  GridComponentOption,
  LegendComponentOption,
  MarkAreaComponentOption,
  MarkLineComponentOption,
  MarkPointComponentOption,
  ToolboxComponentOption,
  TooltipComponentOption,
} from 'echarts/components';
import { LabelLayout } from 'echarts/features';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  LineChart,
  BarChart,
  PieChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  ToolboxComponent,
  DataZoomComponent,
  MarkLineComponent,
  MarkPointComponent,
  MarkAreaComponent,
  AxisPointerComponent,
  AriaComponent,
  GraphicComponent,
  LabelLayout,
  CanvasRenderer,
]);

export type ChartOption = echarts.ComposeOption<
  | LineSeriesOption
  | BarSeriesOption
  | PieSeriesOption
  | GridComponentOption
  | LegendComponentOption
  | TooltipComponentOption
  | ToolboxComponentOption
  | DataZoomComponentOption
  | MarkLineComponentOption
  | MarkPointComponentOption
  | MarkAreaComponentOption
  | AxisPointerComponentOption
  | AriaComponentOption
  | GraphicComponentOption
>;

export type { LineSeriesOption, BarSeriesOption, PieSeriesOption };
export type ChartInstance = echarts.ECharts;
export { echarts };
