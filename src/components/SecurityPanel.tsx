import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ShieldCheck, Phone } from "lucide-react";
import { listUsersForAdmin } from "@/lib/admin.functions";
import { listUserSecurity, setUserSecurity, listLoginEvents } from "@/lib/login.functions";
import { getAuthHeaders } from "@/lib/auth-headers";

const KIND_LABELS: Record<string, string> = {
  password: "כניסה עם סיסמה",
  password_failed: "ניסיון כניסה שנכשל",
  session: "חידוש התחברות",
  logout: "יציאה",
  mfa_enabled_by_admin: "הופעל אימות נוסף",
  mfa_disabled_by_admin: "בוטל אימות נוסף",
};

export function SecurityPanel() {
  const qc = useQueryClient();
  const usersFn = useServerFn(listUsersForAdmin);
  const secFn = useServerFn(listUserSecurity);
  const saveFn = useServerFn(setUserSecurity);
  const eventsFn = useServerFn(listLoginEvents);

  const { data: users } = useQuery({
    queryKey: ["admin_users"],
    queryFn: async () => usersFn({ headers: await getAuthHeaders() }),
  });
  const { data: security } = useQuery({
    queryKey: ["user_security"],
    queryFn: async () => secFn({ headers: await getAuthHeaders() }),
  });
  const { data: events } = useQuery({
    queryKey: ["login_events"],
    queryFn: async () => eventsFn({ headers: await getAuthHeaders() }),
  });

  const save = useMutation({
    mutationFn: async (v: { user_id: string; mfa_enabled: boolean; mfa_phone: string | null }) =>
      saveFn({ data: v, headers: await getAuthHeaders() }),
    onSuccess: () => {
      toast.success("הגדרות האבטחה נשמרו");
      qc.invalidateQueries({ queryKey: ["user_security"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שמירה נכשלה"),
  });

  const secMap = new Map((security ?? []).map((s: any) => [s.user_id, s]));

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="flex items-center gap-2 font-semibold mb-1"><ShieldCheck className="h-4 w-4" />אימות נוסף בשיחה (ימות המשיח)</h3>
        <p className="text-xs text-muted-foreground mb-3">
          כשמופעל, לאחר הסיסמה תתבצע שיחה למספר שהוגדר עם קוד בן 8 ספרות. מכשיר שאושר עם "זכור אותי" לא יידרש לקוד במשך 30 יום.
        </p>
        <div className="divide-y divide-border">
          {(users ?? []).map((u: any) => (
            <UserSecurityRow
              key={u.id}
              user={u}
              current={secMap.get(u.id) as any}
              busy={save.isPending}
              onSave={(mfa_enabled, mfa_phone) => save.mutate({ user_id: u.id, mfa_enabled, mfa_phone })}
            />
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="font-semibold mb-3">יומן כניסות אחרונות</h3>
        <div className="max-h-[400px] overflow-auto text-sm">
          {(events ?? []).length === 0 ? (
            <div className="text-muted-foreground text-xs">אין רשומות</div>
          ) : (
            <table className="w-full text-right">
              <thead className="text-xs text-muted-foreground">
                <tr><th className="py-1">משתמש</th><th>פעולה</th><th>מתי</th></tr>
              </thead>
              <tbody>
                {(events ?? []).map((e: any) => (
                  <tr key={e.id} className="border-t border-border/60">
                    <td className="py-1.5">{e.display_name ?? e.email ?? "—"}</td>
                    <td className={e.kind === "password_failed" ? "text-destructive" : ""}>{KIND_LABELS[e.kind] ?? e.kind}</td>
                    <td className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString("he-IL")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

function UserSecurityRow({
  user, current, busy, onSave,
}: {
  user: any;
  current?: { mfa_enabled: boolean; mfa_phone: string | null };
  busy: boolean;
  onSave: (enabled: boolean, phone: string | null) => void;
}) {
  const [enabled, setEnabled] = useState(Boolean(current?.mfa_enabled));
  const [phone, setPhone] = useState(current?.mfa_phone ?? "");
  const dirty = enabled !== Boolean(current?.mfa_enabled) || phone !== (current?.mfa_phone ?? "");

  return (
    <div className="flex flex-wrap items-center gap-3 py-2">
      <div className="min-w-[180px]">
        <div className="text-sm font-medium">{user.display_name}</div>
        <div className="text-[11px] text-muted-foreground">{user.email}</div>
      </div>
      <label className="flex items-center gap-1.5 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-primary" />
        אימות נוסף
      </label>
      <div className="flex items-center gap-1">
        <Phone className="h-3.5 w-3.5 text-muted-foreground" />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/[^\d]/g, ""))}
          placeholder="מספר לחיוג"
          className="w-36 rounded-md border border-input bg-background px-2 py-1 text-sm"
        />
      </div>
      <button
        disabled={!dirty || busy}
        onClick={() => onSave(enabled, phone || null)}
        className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-40"
      >
        שמור
      </button>
    </div>
  );
}
