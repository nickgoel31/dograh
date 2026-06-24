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

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface DurationData {
  bucket: string;
  range_start: number;
  range_end: number | null;
  count: number;
  percentage: number;
}

interface DurationChartProps {
  data: DurationData[];
}

const COLORS = {
  '0-10': '#10b981',    // accent-green
  '10-30': '#059669',   // green-600
  '30-60': '#2563eb',   // accent-blue
  '60-120': '#7c3aed',  // accent-purple
  '120-180': '#6366f1', // accent-indigo
  '>180': '#4f46e5',    // indigo-600
};

export function DurationChart({ data }: DurationChartProps) {
  const chartData = data.map((item) => ({
    ...item,
    label: `${item.bucket}s`,
    fill: COLORS[item.bucket as keyof typeof COLORS] || '#71717a',
  }));

  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: DurationData & { label: string; fill: string } }> }) => {
    if (active && payload && payload[0]) {
      const data = payload[0].payload;
      return (
        <div className="bg-[#121214] border border-[#262629] rounded-xl shadow-2xl p-3 text-xs">
          <p className="font-semibold text-white mb-1">{data.label}</p>
          <p className="text-zinc-300">Calls: <span className="font-medium text-white">{data.count}</span></p>
          <p className="text-zinc-400 mt-0.5">{data.percentage}% of total</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-[#111113] border border-[#1d1d22] rounded-2xl p-6">
      <div className="flex justify-between items-center mb-6">
        <span className="text-sm font-semibold text-zinc-200">Call Duration Distribution</span>
      </div>
      <div>
        {data.length === 0 ? (
          <div className="h-[300px] flex items-center justify-center text-zinc-500 text-xs">
            No duration data available
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={chartData}
              margin={{ top: 5, right: 10, left: -10, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1d1d22" opacity={0.5} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: '#71717a' }}
                stroke="#1d1d22"
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#71717a' }}
                stroke="#1d1d22"
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255, 255, 255, 0.02)' }} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
