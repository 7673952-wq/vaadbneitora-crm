import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { useMyCrms } from "@/lib/use-crms";
import { createRecord, listFieldDefs } from "@/lib/crm-records.functions";
import { listAgents } from "@/lib/systems.functions";
import { listStatusSettings } from "@/lib/admin.functions";
import { YemotCreateModal } from "@/routes/_authenticated/dashboard";
import { getAuthHeaders } from "@/lib/auth-headers";

type Form = { code: string; name: string; phone: string; callerPhone: string; email: string; notes: string };
const EMPTY: Form = { code: "", name: "", phone: "", callerPhone: "", email: "", notes: "" };

/**
 * Primary "open a new record" action. Picking a CRM opens the creation form
 * inline in a dialog — no navigation away from the current screen.
 */
export function NewRecordButton() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: crms = [] } = useMyCrms();
  const createRecFn = useServerFn(createRecord);
  const fieldsFn = useServerFn(listFieldDefs);
  const agentsFn = useServerFn(listAgents);
  const statusesFn = useServerFn(listStatusSettings);

  const [open, setOpen] = useState(false);
  const [crmKey, setCrmKey] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState<Record<string, string>>({});
  const { data: fields = [] } = useQuery({
    queryKey: ["crm_field_defs", crmKey],
    queryFn: async () => fieldsFn({ data: { crmKey: crmKey ?? "" }, headers: await getAuthHeaders() }),
    enabled: !!crmKey && crmKey !== "yemot",
  });
  const { data: agents = [] } = useQuery({ queryKey: ["agents"], queryFn: () => agentsFn(), enabled: crmKey === "yemot" });
  const { data: statuses = [] } = useQuery({ queryKey: ["status_settings"], queryFn: () => statusesFn(), enabled: crmKey === "yemot" });

  const writable = crms.filter((c) => c.myRole && c.myRole !== "viewer");
  if (writable.length === 0) return null;

  const current = writable.find((c) => c.key === crmKey) ?? null;

  function start() {
    setForm(EMPTY);
    setCustom({});
    setCrmKey(writable.length === 1 ? writable[0].key : null);
    setOpen(true);
  }

  async function submit() {
    if (!current) return;
    if (!form.code.trim()) { toast.error(`נדרש ${current.idLabel || "מזהה"}`); return; }
    setBusy(true);
    try {
      if (current.key !== "yemot") {
        const created: any = await createRecFn({
          data: {
            crmKey: current.key,
            recordCode: form.code.trim(),
            name: form.name.trim(),
            status: "open",
            phone: form.phone || null,
            callerPhone: form.callerPhone || null,
            email: form.email || null,
            source: null,
            notes: form.notes || null,
            custom,
          },
          headers: await getAuthHeaders(),
        });
        await qc.invalidateQueries({ queryKey: ["crm_records", current.key] });
        toast.success("הפניה נפתחה");
        setOpen(false);
        if (created?.id) navigate({ to: "/c/$crm/$id", params: { crm: current.key, id: created.id } });
      }
    } catch (e: any) {
      toast.error(e?.message ?? "שגיאה בפתיחת פניה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={start}
        className="flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:bg-primary/90 whitespace-nowrap"
      >
        <Plus className="h-4 w-4" />
        <span className="hidden lg:inline">פתיחת פניה</span>
      </button>

      {open && (
        current?.key === "yemot" ? (
          <YemotCreateModal
            onClose={() => setOpen(false)}
            agents={agents}
            statusOptions={statuses.filter((s: any) => s.is_mandatory !== false).map((s: any) => ({ value: s.status_key, label: s.label }))}
            onDone={() => { qc.invalidateQueries({ queryKey: ["systems"] }); setOpen(false); }}
          />
        ) : (
        <div dir="rtl" className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 p-4 pt-20" onClick={() => !busy && setOpen(false)}>
          <div className="w-full max-w-lg rounded-xl border border-border bg-background shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="font-semibold">פתיחת פניה חדשה</h2>
              <button onClick={() => !busy && setOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <label className="text-xs font-medium block mb-1.5">באיזו מערכת?</label>
                <div className="flex flex-wrap gap-1.5">
                  {writable.map((c) => (
                    <button
                      key={c.key}
                      onClick={() => setCrmKey(c.key)}
                      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition ${
                        crmKey === c.key ? "border-primary bg-accent font-medium" : "border-border hover:bg-accent/50"
                      }`}
                    >
                      <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>

              {current && (
                <div className="space-y-2 border-t border-border pt-3">
                  <Row label={current.idLabel || "מזהה"} value={form.code} onChange={(v) => setForm({ ...form, code: v })} autoFocus />
                  <Row label="שם" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
                  <Row label="טלפון" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
                  <Row label="מספר פונה" value={form.callerPhone} onChange={(v) => setForm({ ...form, callerPhone: v })} />
                  <Row label="מייל" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
                  {fields.map((field: any) => (
                    <Row key={field.id} label={field.label} value={custom[field.fieldKey] ?? ""} onChange={(v) => setCustom({ ...custom, [field.fieldKey]: v })} />
                  ))}
                  <div>
                    <label className="text-xs font-medium block mb-1">הערות</label>
                    <textarea
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                      rows={3}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={submit}
                      disabled={busy}
                      className="flex-1 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
                    >
                      {busy ? "פותח..." : "פתח פניה"}
                    </button>
                    <button onClick={() => setOpen(false)} disabled={busy} className="rounded-lg border border-border px-4 py-2 text-sm">ביטול</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        )
      )}
    </>
  );
}

function Row({ label, value, onChange, autoFocus }: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <div>
      <label className="text-xs font-medium block mb-1">{label}</label>
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm"
      />
    </div>
  );
}
