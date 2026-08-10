'use client';

import { ArrowUp, Bot, ChevronDown, PhoneCall, PhoneIncoming } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function AgentPromptHero() {
    const router = useRouter();
    const [promptText, setPromptText] = useState('');
    const [selectedFilter, setSelectedFilter] = useState('All');

    const handlePromptSubmit = (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!promptText.trim()) return;
        router.push(`/workflow/create?prompt=${encodeURIComponent(promptText)}`);
    };

    const filterOptions = [
        'All',
        'Collections',
        'Reminder',
        'Recovery',
        'Lead qualification',
    ];

    const templates = [
        {
            id: '1',
            title: 'Appointment management',
            description:
                'Turn customer calls into instant bookings, reschedules, and confirmations with an AI voice agent.',
            category: 'Reminder',
            iconBg: 'bg-gradient-to-tr from-rose-500 to-red-400',
        },
        {
            id: '2',
            title: 'Sales discovery',
            description:
                'Meet Ananya: the AI voice agent that turns warm leads into booked meetings.',
            category: 'Lead qualification',
            iconBg: 'bg-gradient-to-tr from-purple-500 to-pink-400',
        },
        {
            id: '3',
            title: 'EMI Collection',
            description:
                'An AI collections agent that manages EMI reminders and simplifies customer payments',
            category: 'Collections',
            iconBg: 'bg-gradient-to-tr from-amber-500 to-orange-400',
        },
    ];

    const filteredTemplates =
        selectedFilter === 'All'
            ? templates
            : templates.filter((t) => t.category === selectedFilter);

    return (
        <div className="flex flex-col gap-10 mb-8 pt-2">
            {/* Center Hero Section */}
            <div className="flex flex-col items-center text-center space-y-6 pt-2">
                {/* Subtle Robot Icon */}
                <div className="w-16 h-16 rounded-2xl bg-[#1c1e1a] flex items-center justify-center border border-[#282b26] shadow-xs">
                    <Bot className="w-8 h-8 text-neutral-400" />
                </div>

                {/* Heading */}
                <h2 className="text-3xl sm:text-4xl font-normal text-gray-900 dark:text-white tracking-tight font-serif">
                    What should your voice agent do?
                </h2>

                {/* Prompt Capsule Input Box */}
                <form
                    onSubmit={handlePromptSubmit}
                    className="w-full max-w-2xl bg-white dark:bg-[#1c1e1a] border border-gray-200 dark:border-[#282b26] rounded-full shadow-xs hover:shadow-md focus-within:shadow-md focus-within:border-gray-300 dark:focus-within:border-gray-600 transition-all p-1.5 pl-5 flex items-center gap-3"
                >
                    <PhoneCall className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                    <input
                        type="text"
                        value={promptText}
                        onChange={(e) => setPromptText(e.target.value)}
                        placeholder="Create a voice agent to answer calls and confirm appointments"
                        className="w-full text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 bg-transparent border-0 focus:outline-hidden font-normal"
                    />
                    <button
                        type="submit"
                        disabled={!promptText.trim()}
                        className={`w-9 h-9 rounded-full flex items-center justify-center transition-all flex-shrink-0 cursor-pointer ${
                            promptText.trim().length > 0
                                ? 'bg-black text-white hover:bg-gray-800 dark:bg-[#bcf0da] dark:text-[#082117]'
                                : 'bg-gray-700 text-white opacity-40 cursor-not-allowed'
                        }`}
                    >
                        <ArrowUp className="w-4 h-4 stroke-[2.5]" />
                    </button>
                </form>
            </div>

            {/* Agent Templates Section */}
            <div className="space-y-6 pt-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                        Agent templates
                    </h3>

                    {/* Filter Pills */}
                    <div className="flex items-center gap-2 overflow-x-auto pb-1">
                        {filterOptions.map((option) => {
                            const isActive = selectedFilter === option;
                            return (
                                <button
                                    key={option}
                                    type="button"
                                    onClick={() => setSelectedFilter(option)}
                                    className={`px-3 py-1 rounded-full text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
                                        isActive
                                            ? 'bg-gray-100 dark:bg-[#282b26] text-gray-900 dark:text-white font-semibold'
                                            : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-[#1f2119] hover:text-gray-900 dark:hover:text-white'
                                    }`}
                                >
                                    {option}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Cards Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {filteredTemplates.slice(0, 3).map((template) => (
                        <div
                            key={template.id}
                            onClick={() =>
                                router.push(
                                    `/workflow/create?template=${encodeURIComponent(
                                        template.title
                                    )}`
                                )
                            }
                            className="bg-gray-50/70 dark:bg-[#1c1e1a] hover:bg-gray-100/80 dark:hover:bg-[#232621] border border-gray-100 dark:border-[#282b26] rounded-2xl p-5 flex flex-col justify-between gap-6 transition-all cursor-pointer group"
                        >
                            <div className="space-y-4">
                                {/* Pixelated Icon Box */}
                                <div className="w-10 h-10 rounded-xl bg-white dark:bg-[#161715] border border-gray-200/80 dark:border-[#2e312b] p-1.5 flex items-center justify-center shadow-2xs group-hover:scale-105 transition-transform">
                                    <div
                                        className={`w-full h-full rounded-lg ${template.iconBg} flex items-center justify-center text-white`}
                                    >
                                        <PhoneIncoming className="w-4 h-4" />
                                    </div>
                                </div>

                                <div className="space-y-1.5">
                                    <h4 className="text-xs font-bold text-gray-900 dark:text-white">
                                        {template.title}
                                    </h4>
                                    <p className="text-[11.5px] text-gray-500 dark:text-gray-400 leading-relaxed">
                                        {template.description}
                                    </p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* View More Button */}
                <div className="flex justify-center pt-2 pb-2">
                    <button
                        type="button"
                        onClick={() => router.push('/workflow/create')}
                        className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:text-black dark:hover:text-white transition-colors cursor-pointer"
                    >
                        <ChevronDown className="w-3.5 h-3.5" />
                        <span>View more</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
