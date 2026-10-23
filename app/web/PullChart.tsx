import { useEffect, useRef } from 'react';
import { init, use } from 'echarts/core';
import { BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, DataZoomComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { Analysis } from '../shared/types.js';
use([BarChart, GridComponent, TooltipComponent, DataZoomComponent, CanvasRenderer]);
export default function PullChart({ pulls }: { pulls: Analysis['pulls'] }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // This component is lazy-loaded; only the bar chart and used components enter its chunk.
    if (!host.current) return;
    const chart = init(host.current, undefined, { renderer: 'canvas' });
    chart.setOption({
      animation: false,
      backgroundColor: 'transparent',
      grid: { top: 18, left: 48, right: 18, bottom: pulls.length > 30 ? 60 : 35 },
      tooltip: {
        trigger: 'axis',
        renderMode: 'richText',
        backgroundColor: '#211721',
        borderColor: '#513043',
        textStyle: { color: '#efe6ed' },
        valueFormatter: (n: unknown) => `${n} seconds`,
      },
      xAxis: {
        type: 'category',
        data: pulls.map((p) => `#${p.fight.id}`),
        axisLabel: { color: '#9c8d9d' },
        axisLine: { lineStyle: { color: '#382936' } },
      },
      yAxis: {
        type: 'value',
        name: 'seconds',
        nameTextStyle: { color: '#9c8d9d' },
        axisLabel: { color: '#9c8d9d' },
        splitLine: { lineStyle: { color: '#241c29' } },
      },
      dataZoom:
        pulls.length > 30
          ? [{ type: 'inside' }, { type: 'slider', height: 14, bottom: 4, borderColor: '#382936' }]
          : [],
      series: [
        {
          type: 'bar',
          barMaxWidth: 30,
          itemStyle: { borderRadius: [4, 4, 0, 0] },
          data: pulls.map((p) => ({
            value: Math.round((p.fight.endTime - p.fight.startTime) / 1000),
            itemStyle: { color: p.fight.kill ? '#66bca5' : '#98516d' },
          })),
        },
      ],
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(host.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [pulls]);
  return (
    <div
      ref={host}
      className="pull-chart"
      role="img"
      aria-label={`Duration chart for ${pulls.length} selected pulls. Green bars are kills; burgundy bars are wipes.`}
    />
  );
}
