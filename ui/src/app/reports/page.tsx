'use client';

import { addDays, format, subDays } from 'date-fns';
import { BarChart3, Calendar, ChevronDown, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  getDailyReportApiV1OrganizationsReportsDailyGet,
  getDailyRunsDetailApiV1OrganizationsReportsDailyRunsGet,
  getWorkflowOptionsApiV1OrganizationsReportsWorkflowsGet
} from '@/client/sdk.gen';
import type { WorkflowRunDetail } from '@/client/types.gen';
import { Calendar as CalendarPicker } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { useUserConfig } from '@/context/UserConfigContext';
import { useAuth } from '@/lib/auth';

import { DispositionChart } from './components/DispositionChart';
import { DurationChart } from './components/DurationChart';
import { MetricsCards } from './components/MetricsCards';

interface WorkflowOption {
  id: number;
  name: string;
}

interface DailyReport {
  date: string;
  timezone: string;
  workflow_id: number | null;
  metrics: {
    total_runs: number;
    xfer_count: number;
  };
  disposition_distribution: Array<{
    disposition: string;
    count: number;
    percentage: number;
  }>;
  call_duration_distribution: Array<{
    bucket: string;
    range_start: number;
    range_end: number | null;
    count: number;
    percentage: number;
  }>;
}

export default function ReportsPage() {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedWorkflow, setSelectedWorkflow] = useState<string>('all');
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { userConfig } = useUserConfig();
  const auth = useAuth();

  const timezone = userConfig?.timezone || 'America/New_York';

  useEffect(() => {
    const fetchWorkflows = async () => {
      if (!auth.isAuthenticated) return;

      try {
        const response = await getWorkflowOptionsApiV1OrganizationsReportsWorkflowsGet({});
        if (response.data) {
          setWorkflows(response.data);
        }
      } catch (err) {
        console.error('Failed to fetch workflows:', err);
      }
    };
    fetchWorkflows();
  }, [auth.isAuthenticated]);

  useEffect(() => {
    const fetchReport = async () => {
      if (!auth.isAuthenticated) return;

      setLoading(true);
      setError(null);

      try {
        const dateStr = format(selectedDate, 'yyyy-MM-dd');
        const workflowId = selectedWorkflow === 'all' ? undefined : parseInt(selectedWorkflow);

        const response = await getDailyReportApiV1OrganizationsReportsDailyGet({
          query: {
            date: dateStr,
            timezone,
            ...(workflowId && { workflow_id: workflowId })
          },
        });

        if (response.data) {
          setReport(response.data as DailyReport);
        }
      } catch (err) {
        console.error('Failed to fetch report:', err);
        setError('Failed to load report data');
      } finally {
        setLoading(false);
      }
    };

    fetchReport();
  }, [selectedDate, selectedWorkflow, timezone, auth.isAuthenticated]);

  const handlePreviousDay = () => {
    setSelectedDate(subDays(selectedDate, 1));
  };

  const handleNextDay = () => {
    setSelectedDate(addDays(selectedDate, 1));
  };

  const handleDownloadCSV = async () => {
    if (!auth.isAuthenticated) return;

    try {
      const dateStr = format(selectedDate, 'yyyy-MM-dd');
      const workflowId = selectedWorkflow === 'all' ? undefined : parseInt(selectedWorkflow);

      const response = await getDailyRunsDetailApiV1OrganizationsReportsDailyRunsGet({
        query: {
          date: dateStr,
          timezone,
          ...(workflowId && { workflow_id: workflowId })
        },
      });

      if (response.data && response.data.length > 0) {
        const headers = ['Phone Number', 'Disposition', 'Duration (seconds)', 'Workflow Run URL'];
        const rows = response.data.map((run: WorkflowRunDetail) => {
          const url = `${window.location.origin}/workflow/${run.workflow_id}/run/${run.run_id}`;
          return [
            run.phone_number || '',
            run.disposition || '',
            run.duration_seconds.toString(),
            url
          ];
        });

        const csvContent = [
          headers.join(','),
          ...rows.map((row: string[]) => row.map((cell: string) => `"${cell}"`).join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        const workflowName = selectedWorkflow === 'all'
          ? 'all_workflows'
          : workflows.find(w => w.id.toString() === selectedWorkflow)?.name?.replace(/\s+/g, '_') || 'workflow';

        link.setAttribute('href', url);
        link.setAttribute('download', `workflow_runs_${dateStr}_${workflowName}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        alert('No data available for download');
      }
    } catch (err) {
      console.error('Failed to download CSV:', err);
      alert('Failed to download CSV data');
    }
  };

  const isToday = format(selectedDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');

  return (
    <div className="flex flex-col h-full text-gray-900 dark:text-white font-sans select-none relative" style={{ backgroundColor: '#161715' }}>
      {/* Top Page Header matching demo styling */}
      <header className="px-8 pt-6 pb-3 flex items-center justify-between sticky top-0 z-20 border-b border-gray-100 dark:border-[#282b26]" style={{ backgroundColor: '#161715' }}>
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <h1 className="text-base font-semibold text-gray-900 dark:text-white tracking-tight">
              Daily Reports
            </h1>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Analytics and breakdown of daily voice agent performance.
          </p>
        </div>

        {/* Top Controls */}
        <div className="flex items-center gap-3">
          {/* Workflow selector */}
          <div className="relative">
            <select
              value={selectedWorkflow}
              onChange={(e) => setSelectedWorkflow(e.target.value)}
              className="px-3.5 py-1.5 border border-gray-200 dark:border-[#282b26] rounded-full text-xs font-semibold text-gray-800 dark:text-gray-200 appearance-none pr-8 cursor-pointer focus:outline-hidden"
              style={{ backgroundColor: '#161715' }}
            >
              <option value="all" className="bg-white dark:bg-[#1c1e1a] text-gray-900 dark:text-white">All Workflows</option>
              {workflows.map((workflow) => (
                <option key={workflow.id} value={workflow.id.toString()} className="bg-white dark:bg-[#1c1e1a] text-gray-900 dark:text-white">
                  {workflow.name}
                </option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          {/* Date Navigator */}
          <div className="flex items-center gap-1 border border-gray-200 dark:border-[#282b26] rounded-full px-2 py-1" style={{ backgroundColor: '#161715' }}>
            <button
              onClick={handlePreviousDay}
              className="p-1 text-gray-500 hover:text-black dark:hover:text-white cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>

            <Popover>
              <PopoverTrigger asChild>
                <button className="flex items-center gap-1.5 text-xs font-semibold text-gray-800 dark:text-gray-200 px-1 cursor-pointer">
                  <Calendar className="w-3.5 h-3.5 text-gray-500" />
                  <span>{format(selectedDate, 'MMM dd, yyyy')}</span>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 border border-gray-200 dark:border-[#282b26] rounded-xl" style={{ backgroundColor: '#1C1E1A' }}>
                <CalendarPicker
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => date && setSelectedDate(date)}
                  disabled={(date) => date > new Date()}
                  className="text-gray-900 dark:text-white"
                />
              </PopoverContent>
            </Popover>

            <button
              onClick={handleNextDay}
              disabled={isToday}
              className="p-1 text-gray-500 hover:text-black dark:hover:text-white disabled:opacity-30 cursor-pointer"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace Container */}
      <div className="max-w-6xl w-full mx-auto px-8 pt-6 pb-16 flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-400 dark:text-gray-500 font-medium">
            Showing data for <strong className="text-gray-700 dark:text-gray-300">{timezone}</strong> timezone
            {selectedWorkflow !== 'all' && (
              <span> • Filtered by: <strong className="text-gray-700 dark:text-gray-300">{workflows.find(w => w.id.toString() === selectedWorkflow)?.name}</strong></span>
            )}
          </p>

          {/* Download CSV Button */}
          {!loading && report && report.metrics.total_runs > 0 && (
            <button
              onClick={handleDownloadCSV}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-black dark:bg-[#bcf0da] hover:bg-gray-800 dark:hover:bg-[#a5e9cd] text-white dark:text-[#082117] text-xs font-bold rounded-full shadow-xs transition-all cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 stroke-[2]" />
              <span>Download CSV</span>
            </button>
          )}
        </div>

        {/* Loading State */}
        {loading && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Skeleton className="h-28 rounded-2xl border border-gray-200 dark:border-[#282b26]" style={{ backgroundColor: '#1C1E1A' }} />
              <Skeleton className="h-28 rounded-2xl border border-gray-200 dark:border-[#282b26]" style={{ backgroundColor: '#1C1E1A' }} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Skeleton className="h-64 rounded-2xl border border-gray-200 dark:border-[#282b26]" style={{ backgroundColor: '#1C1E1A' }} />
              <Skeleton className="h-64 rounded-2xl border border-gray-200 dark:border-[#282b26]" style={{ backgroundColor: '#1C1E1A' }} />
            </div>
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div className="p-4 border border-red-500/20 bg-red-500/10 rounded-2xl text-center text-red-500 text-xs font-semibold">
            {error}
          </div>
        )}

        {/* Report Content */}
        {report && !loading && !error && (
          <>
            {/* Stat Cards (Row 1) */}
            <MetricsCards metrics={report.metrics} />

            {/* Charts Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <DispositionChart data={report.disposition_distribution} />
              <DurationChart data={report.call_duration_distribution} />
            </div>

            {/* Bottom Summary Banner */}
            <div
              className="border border-gray-200/80 dark:border-[#282b26] rounded-2xl p-4 text-center text-xs font-semibold text-gray-600 dark:text-gray-300"
              style={{ backgroundColor: '#1C1E1A' }}
            >
              {report.metrics.total_runs} workflow run{report.metrics.total_runs !== 1 ? 's' : ''} found for {format(selectedDate, 'MMMM dd, yyyy')}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
