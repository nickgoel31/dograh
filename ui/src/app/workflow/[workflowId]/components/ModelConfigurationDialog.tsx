import { ServiceConfigurationForm } from "@/components/ServiceConfigurationForm";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { useCurrentUserRole } from "@/hooks/useCurrentUserRole";
import type { WorkflowConfigurations } from "@/types/workflow-configurations";

interface ModelConfigurationDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    workflowConfigurations: WorkflowConfigurations | null;
    workflowName: string;
    onSave: (configurations: WorkflowConfigurations, workflowName: string) => Promise<void>;
}

export const ModelConfigurationDialog = ({
    open,
    onOpenChange,
    workflowConfigurations,
    workflowName,
    onSave,
}: ModelConfigurationDialogProps) => {
    const { role } = useCurrentUserRole();

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Model Configuration</DialogTitle>
                    <DialogDescription>
                        {role === "client"
                            ? "You do not have permission to modify model configurations or API keys."
                            : "Override global model settings for this workflow. Toggle individual services to customize."}
                    </DialogDescription>
                </DialogHeader>

                {role !== "client" ? (
                    <ServiceConfigurationForm
                        mode="override"
                        currentOverrides={workflowConfigurations?.model_overrides}
                        submitLabel="Save"
                        onSave={async (config) => {
                            await onSave(
                                {
                                    ...workflowConfigurations,
                                    model_overrides: config.model_overrides as WorkflowConfigurations["model_overrides"],
                                } as WorkflowConfigurations,
                                workflowName,
                            );
                            onOpenChange(false);
                        }}
                    />
                ) : (
                    <div className="py-6 text-center text-sm text-muted-foreground">
                        Please contact your administrator to change model configurations or API keys.
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};
