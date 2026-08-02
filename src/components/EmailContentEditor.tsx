import { useMemo, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cleanEmailContent, EMAIL_CLEANUP_LEVELS, type EmailCleanupLevel } from "@/lib/email-cleanup";

type EmailContentEditorProps = {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  cleanupLevel: EmailCleanupLevel;
  onCleanupLevelChange: (level: EmailCleanupLevel) => void;
  label?: string;
};

export function EmailContentEditor({
  value,
  onChange,
  rows = 5,
  placeholder = "תוכן ההודעה",
  cleanupLevel,
  onCleanupLevelChange,
  label = "תוכן המייל",
}: EmailContentEditorProps) {
  const [showPreview, setShowPreview] = useState(false);
  const preview = useMemo(() => cleanEmailContent(value, cleanupLevel), [value, cleanupLevel]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <label className="text-xs font-medium">{label}</label>
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-muted-foreground" htmlFor="email-cleanup-level">רמת ניקוי</label>
          <select
            id="email-cleanup-level"
            value={cleanupLevel}
            onChange={(event) => onCleanupLevelChange(event.target.value as EmailCleanupLevel)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          >
            {EMAIL_CLEANUP_LEVELS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <Button type="button" variant="outline" size="sm" onClick={() => setShowPreview((current) => !current)}>
            {showPreview ? <EyeOff /> : <Eye />}
            {showPreview ? "סגור תצוגה" : "תצוגה מקדימה"}
          </Button>
        </div>
      </div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
      {showPreview && (
        <div className="rounded-md border border-border bg-muted/40 p-3">
          <div className="mb-1 text-[11px] font-medium text-muted-foreground">כך התוכן יישמר ויישלח</div>
          <div className="min-h-12 whitespace-pre-wrap text-sm">{preview || "(ללא תוכן)"}</div>
        </div>
      )}
    </div>
  );
}