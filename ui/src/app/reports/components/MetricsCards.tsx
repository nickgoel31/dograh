import { Phone, PhoneForwarded } from 'lucide-react';

interface MetricsCardsProps {
  metrics: {
    total_runs: number;
    xfer_count: number;
  };
}

export function MetricsCards({ metrics }: MetricsCardsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
      {/* Card 1: Total Workflow Runs */}
      <div
        className="border border-gray-200/90 dark:border-[#282b26] rounded-2xl p-6 shadow-2xs flex items-center justify-between"
        style={{ backgroundColor: '#1C1E1A' }}
      >
        <div className="space-y-1">
          <span className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Total Workflow Runs
          </span>
          <div className="text-3xl font-bold text-gray-900 dark:text-white">
            {metrics.total_runs.toLocaleString()}
          </div>
          <p className="text-[11px] text-gray-400 dark:text-gray-500">
            Total calls processed today
          </p>
        </div>
        <div className="w-12 h-12 rounded-2xl bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 flex items-center justify-center border border-purple-100 dark:border-purple-900/40 shrink-0">
          <Phone className="w-6 h-6" />
        </div>
      </div>

      {/* Card 2: Transfer Dispositions */}
      <div
        className="border border-gray-200/90 dark:border-[#282b26] rounded-2xl p-6 shadow-2xs flex items-center justify-between"
        style={{ backgroundColor: '#1C1E1A' }}
      >
        <div className="space-y-1">
          <span className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Transfer Dispositions
          </span>
          <div className="text-3xl font-bold text-gray-900 dark:text-white">
            {metrics.xfer_count.toLocaleString()}
          </div>
          <p className="text-[11px] text-gray-400 dark:text-gray-500">
            Calls transferred (XFER)
          </p>
        </div>
        <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center border border-emerald-100 dark:border-emerald-900/40 shrink-0">
          <PhoneForwarded className="w-6 h-6" />
        </div>
      </div>
    </div>
  );
}
