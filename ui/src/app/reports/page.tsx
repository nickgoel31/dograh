'use client';

import { addDays, format, subDays } from 'date-fns';
import { BarChart3, Calendar, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { useEffect,useState } from 'react';

import {
  getDailyReportApiV1OrganizationsReportsDailyGet,
  getDailyRunsDetailApiV1OrganizationsReportsDailyRunsGet,
  getWorkflowOptionsApiV1OrganizationsReportsWorkflowsGet
} from '@/client/sdk.gen';
import type { WorkflowRunDetail } from '@/client/types.gen';
import { Button } from '@/components/ui/button';
import { Calendar as CalendarPicker } from '@/components/ui/calendar';
import { Card } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

  // Fetch workflows on mount
  useEffect(() => {
    const fetchWorkflows = async () => {
      if (!auth.isAuthenticated) return;

      try {
        const response = await getWorkflowOptionsApiV1OrganizationsReportsWorkflowsGet({
        });
        if (response.data) {
          setWorkflows(response.data);
        }
      } catch (err) {
        console.error('Failed to fetch workflows:', err);
      }
    };
    fetchWorkflows();
  }, [auth.isAuthenticated]);

  // Fetch report data when date or workflow changes
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

      // Fetch detailed runs data
      const response = await getDailyRunsDetailApiV1OrganizationsReportsDailyRunsGet({
        query: {
          date: dateStr,
          timezone,
          ...(workflowId && { workflow_id: workflowId })
        },
      });

      if (response.data && response.data.length > 0) {
        // Prepare CSV content
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

        // Create CSV content
        const csvContent = [
          headers.join(','),
          ...rows.map((row: string[]) => row.map((cell: string) => `"${cell}"`).join(','))
        ].join('\n');

        // Create blob and download
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
    <div className="max-w-[1600px] mx-auto w-full p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="border-b border-[#1d1d22]/50 pb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-3">
            <BarChart3 className="h-6 w-6 text-[#7c3aed]" />
            Daily Reports
          </h1>
          <p className="text-xs text-zinc-500 mt-1">Analytics and breakdown of daily voice agent performance.</p>
        </div>

        {/* Date Navigation & Workflow Selector */}
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          {/* Workflow Selector */}
          <Select value={selectedWorkflow} onValueChange={setSelectedWorkflow}>
            <SelectTrigger className="w-[200px] bg-[#121214] border border-[#232328] hover:bg-[#1a1a1f] text-zinc-300 rounded-xl text-xs h-10">
              <SelectValue placeholder="Select workflow" />
            </SelectTrigger>
            <SelectContent className="bg-[#111113] border border-[#1d1d22] text-zinc-300 rounded-xl">
              <SelectItem value="all" className="hover:bg-[#1a1a1f] focus:bg-[#1a1a1f] text-xs">All Workflows</SelectItem>
              {workflows.map((workflow) => (
                <SelectItem key={workflow.id} value={workflow.id.toString()} className="hover:bg-[#1a1a1f] focus:bg-[#1a1a1f] text-xs">
                  {workflow.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Date Navigation */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={handlePreviousDay}
              className="h-10 w-10 bg-[#121214] border border-[#232328] hover:bg-[#1a1a1f] text-zinc-400 hover:text-white rounded-xl"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>

            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="w-[180px] bg-[#121214] border border-[#232328] hover:bg-[#1a1a1f] text-zinc-300 rounded-xl text-xs h-10 justify-start"
                >
                  <Calendar className="mr-2 h-4 w-4 text-zinc-500" />
                  {format(selectedDate, 'MMM dd, yyyy')}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 bg-[#111113] border border-[#1d1d22] rounded-xl">
                <CalendarPicker
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => date && setSelectedDate(date)}
                  disabled={(date) => date > new Date()}
                  className="bg-[#111113] text-zinc-300 rounded-xl"
                />
              </PopoverContent>
            </Popover>

            <Button
              variant="outline"
              size="icon"
              onClick={handleNextDay}
              disabled={isToday}
              className="h-10 w-10 bg-[#121214] border border-[#232328] hover:bg-[#1a1a1f] text-zinc-400 hover:text-white rounded-xl"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Timezone Display and Download Button */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="text-xs text-zinc-500">
          Showing data for <span className="font-semibold text-zinc-300">{timezone}</span> timezone
          {selectedWorkflow !== 'all' && (
            <span> • Filtered by: <span className="font-semibold text-zinc-300">{workflows.find(w => w.id.toString() === selectedWorkflow)?.name}</span></span>
          )}
        </div>

        {/* Download CSV Button */}
        {!loading && report && report.metrics.total_runs > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadCSV}
            className="bg-[#121214] border border-[#232328] hover:bg-[#1a1a1f] text-zinc-300 px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 h-9"
          >
            <Download className="h-4 w-4" />
            Download CSV
          </Button>
        )}
      </div>

      {/* Loading State */}
      {loading && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-[#111113] border border-[#1d1d22] rounded-2xl p-6 h-[120px]">
              <Skeleton className="h-4 w-28 bg-[#1c1c1f] mb-3" />
              <Skeleton className="h-8 w-20 bg-[#1c1c1f]" />
            </div>
            <div className="bg-[#111113] border border-[#1d1d22] rounded-2xl p-6 h-[120px]">
              <Skeleton className="h-4 w-28 bg-[#1c1c1f] mb-3" />
              <Skeleton className="h-8 w-20 bg-[#1c1c1f]" />
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-[#111113] border border-[#1d1d22] rounded-2xl p-6 h-[340px]">
              <Skeleton className="h-4 w-40 bg-[#1c1c1f] mb-6" />
              <Skeleton className="h-full w-full bg-[#1c1c1f]" />
            </div>
            <div className="bg-[#111113] border border-[#1d1d22] rounded-2xl p-6 h-[340px]">
              <Skeleton className="h-4 w-40 bg-[#1c1c1f] mb-6" />
              <Skeleton className="h-full w-full bg-[#1c1c1f]" />
            </div>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="bg-[#111113] border border-[#1d1d22] rounded-2xl p-6 text-center text-rose-400 text-xs">
          {error}
        </div>
      )}

      {/* Report Content */}
      {report && !loading && !error && (
        <>
          {/* Metrics Cards */}
          <MetricsCards metrics={report.metrics} />

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <DispositionChart data={report.disposition_distribution} />
            <DurationChart data={report.call_duration_distribution} />
          </div>

          {/* No Data Message */}
          {report.metrics.total_runs === 0 && (
            <div className="bg-[#111113] border border-[#1d1d22] rounded-2xl p-8 text-center text-zinc-500 text-xs">
              No workflow runs found for <span className="font-semibold text-zinc-400">{format(selectedDate, 'MMMM dd, yyyy')}</span>
              {selectedWorkflow !== 'all' && ' for the selected workflow'}
            </div>
          )}
        </>
      )}
    </div>
  );
}
