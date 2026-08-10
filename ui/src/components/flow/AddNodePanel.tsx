import * as LucideIcons from 'lucide-react';
import { Circle, ExternalLink, type LucideIcon, X } from 'lucide-react';
import { useEffect, useMemo } from 'react';

import type { NodeSpec } from '@/client/types.gen';
import { useNodeSpecs } from '@/components/flow/renderer';

import { NodeType } from './types';

type AddNodePanelProps = {
    isOpen: boolean;
    onClose: () => void;
    onNodeSelect: (nodeType: NodeType) => void;
};

const SECTION_ORDER: Array<{ category: NodeSpec['category']; title: string }> = [
    { category: 'trigger', title: 'Triggers' },
    { category: 'call_node', title: 'Agent Nodes' },
    { category: 'global_node', title: 'Global Nodes' },
    { category: 'integration', title: 'Integrations' },
];

function resolveIcon(name: string): LucideIcon {
    const icons = LucideIcons as unknown as Record<string, LucideIcon>;
    return icons[name] ?? Circle;
}

function NodeSection({
    title,
    specs,
    onNodeSelect,
}: {
    title: string;
    specs: NodeSpec[];
    onNodeSelect: (nodeType: NodeType) => void;
}) {
    if (specs.length === 0) return null;
    return (
        <div className="space-y-2">
            <span className="text-[10.5px] font-bold text-[#7c8279] uppercase tracking-wider">
                {title}
            </span>
            <div className="space-y-2">
                {specs.map((spec) => {
                    const Icon = resolveIcon(spec.icon);
                    return (
                        <div
                            key={spec.name}
                            onClick={() => onNodeSelect(spec.name as NodeType)}
                            className="p-4 bg-[#1c1e1a] hover:bg-[#232621] border border-[#282b26] rounded-2xl space-y-1 cursor-pointer transition-all group"
                        >
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-xl bg-[#252822] text-[#c8ccc5] group-hover:text-white flex-shrink-0">
                                    <Icon className="w-4 h-4" />
                                </div>
                                <div className="flex flex-col min-w-0">
                                    <h4 className="text-xs font-bold text-white truncate">{spec.display_name}</h4>
                                    <p className="text-[11.5px] text-[#9ca39a] leading-snug truncate">
                                        {spec.description}
                                    </p>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export default function AddNodePanel({ isOpen, onNodeSelect, onClose }: AddNodePanelProps) {
    const { specs } = useNodeSpecs();

    const sections = useMemo(() => {
        return SECTION_ORDER.map(({ category, title }) => ({
            title,
            specs: specs.filter((s) => s.category === category),
        }));
    }, [specs]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && isOpen) {
                onClose();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div
            className="absolute top-14 left-0 bottom-0 w-96 border-r border-[#242722] z-40 shadow-2xl flex flex-col p-6 space-y-5 animate-in slide-in-from-left duration-200"
            style={{ backgroundColor: '#161715' }}
        >
            <div className="flex items-center justify-between pb-2 border-b border-[#242722]">
                <div>
                    <h2 className="text-lg font-bold text-white">Add New Node</h2>
                    <a
                        href="https://docs.dograh.com/voice-agent/introduction"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-[#8b5cf6] hover:underline inline-flex items-center gap-1"
                    >
                        View Nodes Documentation <ExternalLink className="w-3 h-3" />
                    </a>
                </div>
                <button
                    onClick={onClose}
                    className="text-[#9ca39a] hover:text-white p-1 cursor-pointer"
                >
                    <X className="w-5 h-5" />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-6 pr-1">
                {sections.map(({ title, specs }) => (
                    <NodeSection
                        key={title}
                        title={title}
                        specs={specs}
                        onNodeSelect={onNodeSelect}
                    />
                ))}
            </div>
        </div>
    );
}
