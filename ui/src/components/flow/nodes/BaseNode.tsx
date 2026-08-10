import { forwardRef, HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export const BaseNode = forwardRef<
    HTMLDivElement,
    HTMLAttributes<HTMLDivElement> & {
        selected?: boolean;
        invalid?: boolean;
        selected_through_edge?: boolean;
        hovered_through_edge?: boolean;
        runtimeActive?: boolean;
    }
>(({ children, className, selected, invalid, selected_through_edge, hovered_through_edge, runtimeActive, ...props }, ref) => (
    <div
        ref={ref}
        className={cn(
            "relative rounded-2xl border min-w-[340px] max-w-[440px] shadow-2xl transition-all",
            "border-[#282b26] text-white",
            className,
            selected ? "border-indigo-500/80 ring-2 ring-indigo-500/30" : "hover:border-[#383d34]",
            invalid ? "border-destructive shadow-[0_0_10px_rgba(239,68,68,0.3)]" : "",
            hovered_through_edge ? "ring-2 ring-indigo-500/60" : "",
            !hovered_through_edge && selected_through_edge ? "ring-1 ring-indigo-500/50" : "",
            runtimeActive ? "ring-2 ring-sky-400/60 shadow-[0_0_24px_rgba(14,165,233,0.18)]" : "",
        )}
        style={{ backgroundColor: '#161715' }}
        tabIndex={0}
        {...props}
    >
        {children}
    </div>
));

BaseNode.displayName = "BaseNode";
