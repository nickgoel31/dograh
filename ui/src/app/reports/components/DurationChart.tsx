'use client';

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

export function DurationChart({ data }: DurationChartProps) {
  const maxCount = Math.max(...data.map((d) => d.count), 1);

  return (
    <div
      className="border border-gray-200/90 dark:border-[#282b26] rounded-2xl p-6 shadow-2xs space-y-4"
      style={{ backgroundColor: '#1C1E1A' }}
    >
      <h3 className="text-xl font-normal text-gray-900 dark:text-white font-serif tracking-tight">
        Call Duration Distribution
      </h3>

      {data.length === 0 ? (
        <div className="h-[240px] flex items-center justify-center text-gray-400 dark:text-gray-500 text-xs">
          No duration data available
        </div>
      ) : (
        /* Custom Gradient Bar Visualizer matching demo */
        <div className="h-[220px] pt-6 flex items-end justify-between gap-3 border-b border-gray-100 dark:border-[#282b26] px-2">
          {data.map((bucket, idx) => {
            const heightPercent = (bucket.count / maxCount) * 100;
            return (
              <div key={idx} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
                <span className="text-[10px] font-bold text-gray-700 dark:text-gray-300">
                  {bucket.count}
                </span>
                <div
                  className="w-full bg-gradient-to-t from-amber-500 to-orange-400 rounded-t-lg transition-all duration-500 hover:from-amber-600 hover:to-orange-500"
                  style={{ height: `${Math.max(8, heightPercent)}%` }}
                />
                <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 whitespace-nowrap pt-1 font-mono">
                  {bucket.bucket}s
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
