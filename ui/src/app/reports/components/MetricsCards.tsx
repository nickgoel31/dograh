import { Phone,PhoneForwarded } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface MetricsCardsProps {
  metrics: {
    total_runs: number;
    xfer_count: number;
  };
}

export function MetricsCards({ metrics }: MetricsCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="bg-[#111113] border border-[#1d1d22] rounded-2xl p-6 relative overflow-hidden">
        <div className="flex justify-between items-center mb-4">
          <span className="text-xs font-semibold text-zinc-400">Total Workflow Runs</span>
          <Phone className="h-4 w-4 text-[#7c3aed]" />
        </div>
        <div className="text-2xl font-bold text-white mb-2">{metrics.total_runs.toLocaleString()}</div>
        <p className="text-[10px] text-zinc-500">
          Total calls processed today
        </p>
      </div>

      <div className="bg-[#111113] border border-[#1d1d22] rounded-2xl p-6 relative overflow-hidden">
        <div className="flex justify-between items-center mb-4">
          <span className="text-xs font-semibold text-zinc-400">Transfer Dispositions</span>
          <PhoneForwarded className="h-4 w-4 text-[#10b981]" />
        </div>
        <div className="text-2xl font-bold text-white mb-2">{metrics.xfer_count.toLocaleString()}</div>
        <p className="text-[10px] text-zinc-500">
          Calls transferred (XFER)
        </p>
      </div>
    </div>
  );
}
