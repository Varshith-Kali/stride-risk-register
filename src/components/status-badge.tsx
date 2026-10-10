import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Shared workflow-status badge. Statuses are set by humans only.
 * Neutral, theme-consistent colors (no emojis).
 */
const STATUS_STYLES: Record<string, string> = {
  Open: "bg-secondary text-secondary-foreground border-transparent",
  "In Progress": "bg-[#2563eb] text-white border-transparent hover:bg-[#2563eb]/90",
  Mitigated: "bg-[#16a34a] text-white border-transparent hover:bg-[#16a34a]/90",
  "Accepted Risk":
    "bg-[#ca8a04] text-white border-transparent hover:bg-[#ca8a04]/90",
  Deferred:
    "bg-[#7c3aed] text-white border-transparent hover:bg-[#7c3aed]/90",
  "Rejected/Not Applicable":
    "bg-transparent text-muted-foreground border-border",
};

export function StatusBadge({
  status,
  className,
}: {
  status: string | null | undefined;
  className?: string;
}) {
  const label = status && status.trim() ? status : "Not provided";
  const style =
    STATUS_STYLES[label] ??
    "bg-secondary text-secondary-foreground border-transparent";
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap", style, className)}>
      {label}
    </Badge>
  );
}
