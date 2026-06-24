"use client";

import { Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useId } from 'react';
import TimezoneSelect, { type ITimezoneOption } from 'react-timezone-select';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';

export type TimeSlot = { day_of_week: number; start_time: string; end_time: string };

export interface CampaignAdvancedSettingsProps {
    // Concurrency
    maxConcurrency: string;
    onMaxConcurrencyChange: (value: string) => void;
    effectiveLimit: number;
    orgConcurrentLimit: number;
    fromNumbersCount: number;
    // Retry config
    retryEnabled: boolean;
    onRetryEnabledChange: (value: boolean) => void;
    maxRetries: string;
    onMaxRetriesChange: (value: string) => void;
    retryDelaySeconds: string;
    onRetryDelaySecondsChange: (value: string) => void;
    retryOnBusy: boolean;
    onRetryOnBusyChange: (value: boolean) => void;
    retryOnNoAnswer: boolean;
    onRetryOnNoAnswerChange: (value: boolean) => void;
    retryOnVoicemail: boolean;
    onRetryOnVoicemailChange: (value: boolean) => void;
    // Schedule config
    scheduleEnabled: boolean;
    onScheduleEnabledChange: (value: boolean) => void;
    scheduleTimezone: ITimezoneOption | string;
    onScheduleTimezoneChange: (value: ITimezoneOption | string) => void;
    timeSlots: TimeSlot[];
    onTimeSlotsChange: (value: TimeSlot[]) => void;
    // Circuit breaker config
    circuitBreakerEnabled: boolean;
    onCircuitBreakerEnabledChange: (value: boolean) => void;
    circuitBreakerFailureThreshold: string;
    onCircuitBreakerFailureThresholdChange: (value: string) => void;
    circuitBreakerWindowSeconds: string;
    onCircuitBreakerWindowSecondsChange: (value: string) => void;
    circuitBreakerMinCalls: string;
    onCircuitBreakerMinCallsChange: (value: string) => void;
}

/** Extract the string timezone value from ITimezoneOption | string */
export function getTimezoneValue(tz: ITimezoneOption | string): string {
    return typeof tz === 'string' ? tz : tz.value;
}

const timezoneSelectStyles = {
    control: (base: Record<string, unknown>, state: { isFocused: boolean }) => ({
        ...base,
        minHeight: '40px',
        fontSize: '13px',
        backgroundColor: '#08080a',
        borderColor: state.isFocused ? '#7c3aed' : '#1d1d22',
        borderRadius: '12px',
        boxShadow: state.isFocused ? '0 0 0 1px #7c3aed' : 'none',
        '&:hover': { borderColor: state.isFocused ? '#7c3aed' : '#27272a' },
    }),
    menu: (base: Record<string, unknown>) => ({
        ...base,
        zIndex: 9999,
        backgroundColor: '#111113',
        border: '1px solid #1d1d22',
        borderRadius: '12px',
        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)',
    }),
    menuList: (base: Record<string, unknown>) => ({
        ...base,
        backgroundColor: '#111113',
        padding: '4px',
        borderRadius: '12px',
    }),
    option: (base: Record<string, unknown>, state: { isSelected: boolean; isFocused: boolean }) => ({
        ...base,
        backgroundColor: state.isSelected ? '#7c3aed' : state.isFocused ? '#1a1a1f' : '#111113',
        color: '#ffffff',
        cursor: 'pointer',
        fontSize: '13px',
        borderRadius: '8px',
        padding: '8px 12px',
        '&:active': { backgroundColor: '#8b5cf6' },
    }),
    singleValue: (base: Record<string, unknown>) => ({ ...base, color: '#ffffff' }),
    input: (base: Record<string, unknown>) => ({ ...base, color: '#ffffff' }),
    placeholder: (base: Record<string, unknown>) => ({ ...base, color: '#71717a' }),
    indicatorSeparator: (base: Record<string, unknown>) => ({ ...base, backgroundColor: '#1d1d22' }),
    dropdownIndicator: (base: Record<string, unknown>) => ({
        ...base,
        color: '#71717a',
        '&:hover': { color: '#ffffff' },
    }),
};

export default function CampaignAdvancedSettings({
    maxConcurrency, onMaxConcurrencyChange, effectiveLimit, orgConcurrentLimit, fromNumbersCount,
    retryEnabled, onRetryEnabledChange, maxRetries, onMaxRetriesChange,
    retryDelaySeconds, onRetryDelaySecondsChange,
    retryOnBusy, onRetryOnBusyChange, retryOnNoAnswer, onRetryOnNoAnswerChange,
    retryOnVoicemail, onRetryOnVoicemailChange,
    scheduleEnabled, onScheduleEnabledChange, scheduleTimezone, onScheduleTimezoneChange,
    timeSlots, onTimeSlotsChange,
    circuitBreakerEnabled, onCircuitBreakerEnabledChange,
    circuitBreakerFailureThreshold, onCircuitBreakerFailureThresholdChange,
    circuitBreakerWindowSeconds, onCircuitBreakerWindowSecondsChange,
    circuitBreakerMinCalls, onCircuitBreakerMinCallsChange,
}: CampaignAdvancedSettingsProps) {
    const timezoneSelectId = useId();

    return (
        <div className="space-y-6 pt-4 text-white">
            {/* Max Concurrent Calls */}
            <div className="space-y-2">
                <Label htmlFor="max-concurrency" className="text-xs font-semibold text-zinc-300">Max Concurrent Calls</Label>
                <Input
                    id="max-concurrency"
                    type="number"
                    placeholder={`Default: ${orgConcurrentLimit}`}
                    value={maxConcurrency}
                    onChange={(e) => onMaxConcurrencyChange(e.target.value)}
                    min={1}
                    max={orgConcurrentLimit}
                    className="bg-[#08080a] border-[#1d1d22] rounded-xl text-xs py-2.5 text-white focus-visible:ring-[#7c3aed]"
                />
                <p className="text-[11px] text-zinc-500">
                    Maximum number of simultaneous calls. Leave empty to use {orgConcurrentLimit}.
                    Your organization limit is {orgConcurrentLimit}.
                </p>
                {fromNumbersCount === 0 && (
                    <p className="text-xs text-amber-400 font-semibold bg-amber-500/10 border border-amber-500/20 p-2.5 rounded-xl">
                        No phone numbers configured. Add CLIs in <Link href="/telephony-configurations" className="underline text-amber-300">Telephony Configuration</Link> before running the campaign.
                    </p>
                )}
            </div>

            <Separator className="bg-[#1d1d22]/50" />

            {/* Retry Configuration */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <Label htmlFor="retry-enabled" className="text-xs font-semibold text-zinc-300">Enable Retries</Label>
                        <p className="text-[11px] text-zinc-500">
                            Automatically retry failed calls
                        </p>
                    </div>
                    <Switch
                        id="retry-enabled"
                        checked={retryEnabled}
                        onCheckedChange={onRetryEnabledChange}
                        className="data-[state=checked]:bg-[#7c3aed]"
                    />
                </div>

                {retryEnabled && (
                    <div className="space-y-4 pl-4 border-l border-[#1d1d22]">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="max-retries" className="text-xs text-zinc-400">Max Retries</Label>
                                <Input
                                    id="max-retries"
                                    type="number"
                                    value={maxRetries}
                                    onChange={(e) => onMaxRetriesChange(e.target.value)}
                                    min={0}
                                    max={10}
                                    className="bg-[#08080a] border-[#1d1d22] rounded-xl text-xs text-white focus-visible:ring-[#7c3aed]"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="retry-delay" className="text-xs text-zinc-400">Retry Delay (seconds)</Label>
                                <Input
                                    id="retry-delay"
                                    type="number"
                                    value={retryDelaySeconds}
                                    onChange={(e) => onRetryDelaySecondsChange(e.target.value)}
                                    min={30}
                                    max={3600}
                                    className="bg-[#08080a] border-[#1d1d22] rounded-xl text-xs text-white focus-visible:ring-[#7c3aed]"
                                />
                            </div>
                        </div>

                        <div className="space-y-3">
                            <Label className="text-xs font-semibold text-zinc-400">Retry On</Label>
                            <div className="space-y-3 bg-[#08080a] border border-[#1d1d22] rounded-xl p-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-zinc-300">Busy Signal</span>
                                    <Switch checked={retryOnBusy} onCheckedChange={onRetryOnBusyChange} className="data-[state=checked]:bg-[#7c3aed]" />
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-zinc-300">No Answer</span>
                                    <Switch checked={retryOnNoAnswer} onCheckedChange={onRetryOnNoAnswerChange} className="data-[state=checked]:bg-[#7c3aed]" />
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-zinc-300">Voicemail</span>
                                    <Switch checked={retryOnVoicemail} onCheckedChange={onRetryOnVoicemailChange} className="data-[state=checked]:bg-[#7c3aed]" />
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <Separator className="bg-[#1d1d22]/50" />

            {/* Call Schedule */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <Label htmlFor="schedule-enabled" className="text-xs font-semibold text-zinc-300">Call Schedule</Label>
                        <p className="text-[11px] text-zinc-500">
                            Restrict when calls are made
                        </p>
                    </div>
                    <Switch
                        id="schedule-enabled"
                        checked={scheduleEnabled}
                        onCheckedChange={onScheduleEnabledChange}
                        className="data-[state=checked]:bg-[#7c3aed]"
                    />
                </div>

                {scheduleEnabled && (
                    <div className="space-y-4 pl-4 border-l border-[#1d1d22]">
                        <div className="space-y-2">
                            <Label className="text-xs text-zinc-400">Timezone</Label>
                            <TimezoneSelect
                                instanceId={timezoneSelectId}
                                value={scheduleTimezone}
                                onChange={onScheduleTimezoneChange}
                                styles={timezoneSelectStyles}
                            />
                        </div>

                        <div className="space-y-3">
                            <Label className="text-xs text-zinc-400">Time Slots</Label>
                            <div className="space-y-2">
                                {timeSlots.map((slot, index) => (
                                    <div key={index} className="flex items-center gap-2">
                                        <Select
                                            value={String(slot.day_of_week)}
                                            onValueChange={(val) => {
                                                const updated = [...timeSlots];
                                                updated[index] = { ...updated[index], day_of_week: parseInt(val) };
                                                onTimeSlotsChange(updated);
                                            }}
                                        >
                                            <SelectTrigger className="w-[120px] bg-[#08080a] border-[#1d1d22] rounded-xl text-xs h-10 text-white">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="bg-[#111113] border-[#1d1d22] text-white">
                                                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, i) => (
                                                    <SelectItem key={i} value={String(i)} className="text-xs">{day}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <Input
                                            type="time"
                                            value={slot.start_time}
                                            onChange={(e) => {
                                                const updated = [...timeSlots];
                                                updated[index] = { ...updated[index], start_time: e.target.value };
                                                onTimeSlotsChange(updated);
                                            }}
                                            className="w-[130px] bg-[#08080a] border-[#1d1d22] rounded-xl text-xs h-10 text-white focus-visible:ring-[#7c3aed]"
                                        />
                                        <span className="text-xs text-zinc-500">to</span>
                                        <Input
                                            type="time"
                                            value={slot.end_time}
                                            onChange={(e) => {
                                                const updated = [...timeSlots];
                                                updated[index] = { ...updated[index], end_time: e.target.value };
                                                onTimeSlotsChange(updated);
                                            }}
                                            className="w-[130px] bg-[#08080a] border-[#1d1d22] rounded-xl text-xs h-10 text-white focus-visible:ring-[#7c3aed]"
                                        />
                                        {timeSlots.length > 1 && (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => onTimeSlotsChange(timeSlots.filter((_, i) => i !== index))}
                                                className="h-10 w-10 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 rounded-xl"
                                            >
                                                <X className="h-4 w-4" />
                                            </Button>
                                        )}
                                    </div>
                                ))}
                            </div>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => onTimeSlotsChange([...timeSlots, { day_of_week: 0, start_time: '09:00', end_time: '17:00' }])}
                                className="border-[#1d1d22] hover:bg-[#1a1a1f] text-xs font-semibold rounded-xl text-white mt-1 h-9"
                            >
                                <Plus className="h-4 w-4 mr-1.5" />
                                Add Time Slot
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            <Separator className="bg-[#1d1d22]/50" />

            {/* Circuit Breaker */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <Label htmlFor="circuit-breaker-enabled" className="text-xs font-semibold text-zinc-300">Circuit Breaker</Label>
                        <p className="text-[11px] text-zinc-500">
                            Auto-pause campaign on high failure rates
                        </p>
                    </div>
                    <Switch
                        id="circuit-breaker-enabled"
                        checked={circuitBreakerEnabled}
                        onCheckedChange={onCircuitBreakerEnabledChange}
                        className="data-[state=checked]:bg-[#7c3aed]"
                    />
                </div>

                {circuitBreakerEnabled && (
                    <div className="space-y-4 pl-4 border-l border-[#1d1d22]">
                        <div className="space-y-2">
                            <Label htmlFor="cb-failure-threshold" className="text-xs text-zinc-400">Failure Threshold (%)</Label>
                            <Input
                                id="cb-failure-threshold"
                                type="number"
                                value={circuitBreakerFailureThreshold}
                                onChange={(e) => onCircuitBreakerFailureThresholdChange(e.target.value)}
                                min={1}
                                max={100}
                                className="bg-[#08080a] border-[#1d1d22] rounded-xl text-xs text-white focus-visible:ring-[#7c3aed]"
                            />
                            <p className="text-[11px] text-zinc-500">
                                Pause when failure rate exceeds this percentage
                            </p>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="cb-window" className="text-xs text-zinc-400">Window (seconds)</Label>
                                <Input
                                    id="cb-window"
                                    type="number"
                                    value={circuitBreakerWindowSeconds}
                                    onChange={(e) => onCircuitBreakerWindowSecondsChange(e.target.value)}
                                    min={30}
                                    max={600}
                                    className="bg-[#08080a] border-[#1d1d22] rounded-xl text-xs text-white focus-visible:ring-[#7c3aed]"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="cb-min-calls" className="text-xs text-zinc-400">Min Calls in Window</Label>
                                <Input
                                    id="cb-min-calls"
                                    type="number"
                                    value={circuitBreakerMinCalls}
                                    onChange={(e) => onCircuitBreakerMinCallsChange(e.target.value)}
                                    min={1}
                                    max={100}
                                    className="bg-[#08080a] border-[#1d1d22] rounded-xl text-xs text-white focus-visible:ring-[#7c3aed]"
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

