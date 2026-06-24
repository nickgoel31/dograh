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

interface DispositionData {
  disposition: string;
  count: number;
  percentage: number;
}

interface DispositionChartProps {
  data: DispositionData[];
}

const COLORS = [
  '#7c3aed', // accent-purple
  '#2563eb', // accent-blue
  '#10b981', // accent-green
  '#fbbf24', // warning-amber
  '#f87171', // danger-rose
  '#71717a', // text-subtle
];

export function DispositionChart({ data }: DispositionChartProps) {
  const chartData = data.map((item, index) => ({
    ...item,
    fill: COLORS[index % COLORS.length],
  }));

  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: DispositionData & { fill: string } }> }) => {
    if (active && payload && payload[0]) {
      const data = payload[0].payload;
      return (
        <div className="bg-[#121214] border border-[#262629] rounded-xl shadow-2xl p-3 text-xs">
          <p className="font-semibold text-white mb-1">{data.disposition}</p>
          <p className="text-zinc-300">Count: <span className="font-medium text-white">{data.count}</span></p>
          <p className="text-zinc-400 mt-0.5">{data.percentage}% of total</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-[#111113] border border-[#1d1d22] rounded-2xl p-6">
      <div className="flex justify-between items-center mb-6">
        <span className="text-sm font-semibold text-zinc-200">Disposition Distribution</span>
      </div>
      <div>
        {data.length === 0 ? (
          <div className="h-[300px] flex items-center justify-center text-zinc-500 text-xs">
            No disposition data available
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={chartData}
              layout="horizontal"
              margin={{ top: 5, right: 10, left: -10, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1d1d22" opacity={0.5} />
              <XAxis
                dataKey="disposition"
                angle={-45}
                textAnchor="end"
                height={80}
                interval={0}
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
