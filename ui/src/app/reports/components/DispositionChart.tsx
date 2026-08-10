'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface DispositionData {
  disposition: string;
  count: number;
  percentage: number;
}

interface DispositionChartProps {
  data: DispositionData[];
}

const COLORS = [
  'bg-amber-500',
  'bg-emerald-500',
  'bg-blue-500',
  'bg-rose-400',
  'bg-purple-500',
  'bg-gray-400',
];

const HEX_COLORS = [
  '#f59e0b',
  '#10b981',
  '#3b82f6',
  '#fb7185',
  '#a855f7',
  '#9ca3af',
];

export function DispositionChart({ data }: DispositionChartProps) {
  const chartData = data.map((item, index) => ({
    ...item,
    colorClass: COLORS[index % COLORS.length],
    fill: HEX_COLORS[index % HEX_COLORS.length],
  }));

  return (
    <div
      className="border border-gray-200/90 dark:border-[#282b26] rounded-2xl p-6 shadow-2xs space-y-4"
      style={{ backgroundColor: '#1C1E1A' }}
    >
      <h3 className="text-xl font-normal text-gray-900 dark:text-white font-serif tracking-tight">
        Disposition Distribution
      </h3>

      {data.length === 0 ? (
        <div className="h-[240px] flex items-center justify-center text-gray-400 dark:text-gray-500 text-xs">
          No disposition data available
        </div>
      ) : (
        <div className="space-y-4 pt-2">
          {chartData.map((item, idx) => (
            <div key={idx} className="space-y-1.5">
              <div className="flex justify-between text-xs font-semibold text-gray-700 dark:text-gray-300">
                <span className="font-mono">{item.disposition}</span>
                <span>
                  {item.count} ({item.percentage}%)
                </span>
              </div>
              <div className="h-2.5 w-full bg-gray-100 dark:bg-[#161715] rounded-full overflow-hidden border border-gray-200/50 dark:border-[#282b26]">
                <div
                  className={`h-full ${item.colorClass} rounded-full transition-all duration-500`}
                  style={{ width: `${Math.min(100, Math.max(2, item.percentage))}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
