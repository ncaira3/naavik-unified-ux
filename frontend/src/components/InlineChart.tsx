/**
 * InlineChart Component
 * Renders charts inline in chat messages using ECharts
 */
import ReactECharts from 'echarts-for-react';
import { useTheme } from '../context/ThemeContext';
import { ChartData } from '../types';

interface InlineChartProps {
  data: ChartData;
  height?: number;
  title?: string;
}

export default function InlineChart({ data, height = 300, title }: InlineChartProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const colors = {
    text: isDark ? '#e5e7eb' : '#374151',
    subText: isDark ? '#9ca3af' : '#6b7280',
    line: isDark ? '#4b5563' : '#e5e7eb',
    splitLine: isDark ? '#374151' : '#f3f4f6',
    tooltipBg: isDark ? 'rgba(31,41,55,0.96)' : 'rgba(255,255,255,0.96)',
    tooltipBorder: isDark ? '#4b5563' : '#e5e7eb',
  };

  const getChartOption = () => {
    const baseOption = {
      title: title ? {
        text: title,
        left: 'center',
        top: 10,
        textStyle: {
          fontSize: 14,
          fontWeight: '600',
          color: colors.text
        }
      } : undefined,
      grid: {
        left: 50,
        right: 30,
        top: title ? 50 : 30,
        bottom: 40,
        containLabel: true
      },
      tooltip: {
        trigger: data.type === 'pie' ? 'item' : 'axis',
        backgroundColor: colors.tooltipBg,
        borderColor: colors.tooltipBorder,
        borderWidth: 1,
        textStyle: {
          color: colors.text,
          fontSize: 12
        },
        axisPointer: {
          type: data.type === 'bar' ? 'shadow' : 'line'
        }
      },
      legend: data.datasets.length > 1 ? {
        bottom: 10,
        textStyle: { color: colors.subText }
      } : undefined,
      backgroundColor: 'transparent'
    };

    switch (data.type) {
      case 'line':
        return {
          ...baseOption,
          xAxis: {
            type: 'category',
            data: data.labels,
            axisLine: { lineStyle: { color: colors.line } },
            axisLabel: { color: colors.subText, fontSize: 10 },
            splitLine: { show: false }
          },
          yAxis: {
            type: 'value',
            axisLine: { show: false },
            axisLabel: { color: colors.subText, fontSize: 10 },
            splitLine: { lineStyle: { color: colors.splitLine, type: 'dashed' } }
          },
          series: data.datasets.map(dataset => ({
            name: dataset.label,
            type: 'line',
            data: dataset.data,
            smooth: true,
            lineStyle: {
              width: 2,
              color: dataset.borderColor || '#3B82F6'
            },
            itemStyle: {
              color: dataset.borderColor || '#3B82F6'
            },
            areaStyle: dataset.backgroundColor ? {
              color: dataset.backgroundColor
            } : undefined
          }))
        };

      case 'bar':
        return {
          ...baseOption,
          xAxis: {
            type: 'category',
            data: data.labels,
            axisLine: { lineStyle: { color: colors.line } },
            axisLabel: { 
              color: colors.subText, 
              fontSize: 10,
              rotate: data.labels.length > 10 ? 45 : 0
            },
            splitLine: { show: false }
          },
          yAxis: {
            type: 'value',
            axisLine: { show: false },
            axisLabel: { color: colors.subText, fontSize: 10 },
            splitLine: { lineStyle: { color: colors.splitLine, type: 'dashed' } }
          },
          series: data.datasets.map(dataset => ({
            name: dataset.label,
            type: 'bar',
            data: dataset.data,
            itemStyle: {
              color: dataset.backgroundColor || '#3B82F6'
            }
          }))
        };

      case 'pie':
        return {
          ...baseOption,
          tooltip: {
            trigger: 'item',
            backgroundColor: colors.tooltipBg,
            borderColor: colors.tooltipBorder,
            borderWidth: 1,
            textStyle: { color: colors.text, fontSize: 12 },
            formatter: '{b}: {c} ({d}%)'
          },
          series: data.datasets.map(dataset => ({
            type: 'pie',
            radius: ['40%', '70%'],
            avoidLabelOverlap: true,
            label: {
              show: true,
              color: colors.text,
              fontSize: 11
            },
            labelLine: {
              show: true,
              lineStyle: { color: colors.line }
            },
            data: data.labels.map((label, index) => ({
              name: label,
              value: dataset.data[index],
              itemStyle: {
                color: Array.isArray(dataset.backgroundColor)
                  ? dataset.backgroundColor[index]
                  : dataset.backgroundColor || '#3B82F6'
              }
            }))
          }))
        };

      case 'scatter':
        return {
          ...baseOption,
          xAxis: {
            type: 'value',
            axisLine: { lineStyle: { color: colors.line } },
            axisLabel: { color: colors.subText, fontSize: 10 },
            splitLine: { lineStyle: { color: colors.splitLine, type: 'dashed' } }
          },
          yAxis: {
            type: 'value',
            axisLine: { show: false },
            axisLabel: { color: colors.subText, fontSize: 10 },
            splitLine: { lineStyle: { color: colors.splitLine, type: 'dashed' } }
          },
          series: data.datasets.map(dataset => ({
            name: dataset.label,
            type: 'scatter',
            data: dataset.data.map((value, index) => [index, value]),
            itemStyle: {
              color: dataset.borderColor || '#3B82F6'
            }
          }))
        };

      default:
        return baseOption;
    }
  };

  return (
    <div className="w-full rounded-xl border border-gray-200/30 dark:border-white/10 bg-white/50 dark:bg-[#2d2d32]/50 backdrop-blur-sm overflow-hidden">
      <ReactECharts
        option={getChartOption()}
        style={{ width: '100%', height: `${height}px` }}
        opts={{ renderer: 'canvas' }}
        notMerge
      />
    </div>
  );
}
