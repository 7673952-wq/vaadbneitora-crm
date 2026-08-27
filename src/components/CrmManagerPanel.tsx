import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Trash2, Save } from "lucide-react";
import {
  listMyCrms, upsertCrm, deleteCrm, listCrmMembers, setCrmUserRole, type CrmRole,
} from "@/lib/crms.functions";
import { listFieldDefs, upsertFieldDef, deleteFieldDef } from "@/lib/crm-records.functions";

const ROLE_LABELS: Record<string, string> = {
  "": "אין גישה",
  viewer: "צופה",
  agent: "נציג",
  admin: "מנהל",
  super_admin: "מנהל ראשי",
};

const FIELD_TYPES: { v: string; l: string }[] = [
  { v: "text", l: "טקסט" },
  { v: "textarea", l: "טקסט ארוך" },
  { v: "number", l: "מספר" },
  { v: "date", l: "תאריך" },
  { v: "select", l: "בחירה" },
  { v: "phone", l: "טלפון" },
  { v: "email", l: "מייל" },
  { v: "checkbox", l: "כן/לא" },
];

/** Global admin panel: the CRM registry + the cross-CRM permissions matrix. */
export function CrmManagerPanel() {
  const qc = useQueryClient();
  const crmsFn = useServerFn(listMyCrms);
  const upsertFn = useServerFn(upsertCrm);
  const delFn = useServerFn(deleteCrm);

  const { data: crms = [] } = useQuery({
    queryKey: ["my_crms"],
    queryFn: async () => crmsFn({}),
  });

  const [draft, setDraft] = useState({ key: "", name: "", color: "#2563eb", idLabel: "מספר פניה" });

  async function saveCrm(payload: any) {
    try {
      await upsertFn({ data: payload });
      await qc.invalidateQueries({ queryKey: ["my_crms"] });
      toast.success("נשמר");
    } catch (e: any) {
      toast.error(e?.message ?? "שגיאה בשמירה");
    }
  }

  return (
    <div dir="rtl" className="space-y-6">
      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-semibold mb-3">מערכות CRM</h3>
        <div className="space-y-2">
          {crms.map((c) => (
            <CrmRow key={c.key} crm={c} onSave={saveCrm} onDelete={async () => {
              if (!confirm(`למחוק את "${c.name}"?`)) return;
              try {
                await delFn({ data: { key: c.key } });
                await qc.invalidateQueries({ queryKey: ["my_crms"] });
              } catch (e: any) { toast.error(e?.message ?? "שגיאה"); }
            }} />
          ))}
        </div>

        <div className="mt-4 border-t border-border pt-3">
          <h4 className="text-xs font-semibold mb-2">הוספת מערכת חדשה</h4>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="שם" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />
            <Field label="מזהה (אנגלית)" value={draft.key} onChange={(v) => setDraft({ ...draft, key: v })} />
            <Field label="כותרת מזהה" value={draft.idLabel} onChange={(v) => setDraft({ ...draft, idLabel: v })} />
            <div>
              <label className="text-xs font-medium block mb-1">צבע</label>
              <input type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                className="h-9 w-14 rounded-lg border border-input bg-background" />
            </div>
            <button
              onClick={async () => {
                if (!draft.key || !draft.name) return toast.error("נא למלא שם ומזהה");
                await saveCrm({ ...draft, sortOrder: crms.length, isActive: true });
                setDraft({ key: "", name: "", color: "#2563eb", idLabel: "מספר פניה" });
              }}
              className="flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm"
            >
              <Plus className="h-4 w-4" /> הוסף
            </button>
          </div>
        </div>
      </section>

      <CrmAccessMatrix crms={crms} />
    </div>
  );
}

/** Cross-CRM access matrix (all users × all CRMs). */
export function CrmAccessMatrix({ crms }: { crms: any[] }) {
  const qc = useQueryClient();
  const membersFn = useServerFn(listCrmMembers);
  const setRoleFn = useServerFn(setCrmUserRole);
  const { data: members } = useQuery({
    queryKey: ["crm_members"],
    queryFn: async () => membersFn({}),
  });

  const roleOf = (userId: string, crmKey: string) =>
    members?.memberships.find((m) => m.userId === userId && m.crmKey === crmKey)?.role ?? "";

  return (
    <section className="rounded-xl border border-border bg-card p-4 overflow-x-auto">
      <h3 className="text-sm font-semibold mb-3">הרשאות גישה לפי מערכת</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="text-right py-2 font-medium">משתמש</th>
            {crms.map((c) => <th key={c.key} className="text-right py-2 font-medium">{c.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {(members?.users ?? []).map((u) => (
            <tr key={u.id} className="border-t border-border">
              <td className="py-1.5 pl-3">{u.displayName}</td>
              {crms.map((c) => (
                <td key={c.key} className="py-1.5 pl-3">
                  <RoleSelect
                    value={roleOf(u.id, c.key)}
                    onChange={async (v) => {
                      try {
                        await setRoleFn({
                          data: { userId: u.id, crmKey: c.key, role: (v || null) as CrmRole | null },
                        });
                        await qc.invalidateQueries({ queryKey: ["crm_members"] });
                      } catch (err: any) { toast.error(err?.message ?? "שגיאה"); }
                    }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Per-CRM permissions: every user and their role inside this single CRM. */
export function CrmPermissionsPanel({ crmKey }: { crmKey: string }) {
  const qc = useQueryClient();
  const membersFn = useServerFn(listCrmMembers);
  const setRoleFn = useServerFn(setCrmUserRole);
  const { data: members, isLoading } = useQuery({
    queryKey: ["crm_members"],
    queryFn: async () => membersFn({}),
  });

  const roleOf = (userId: string) =>
    members?.memberships.find((m) => m.userId === userId && m.crmKey === crmKey)?.role ?? "";

  if (isLoading) return <div className="text-sm text-muted-foreground">טוען...</div>;

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold mb-3">הרשאות משתמשים במערכת זו</h3>
      <div className="space-y-1">
        {(members?.users ?? []).map((u) => (
          <div key={u.id} className="flex items-center gap-3 border-b border-border py-1.5 last:border-0">
            <span className="text-sm">{u.displayName}</span>
            <div className="mr-auto">
              <RoleSelect
                value={roleOf(u.id)}
                onChange={async (v) => {
                  try {
                    await setRoleFn({
                      data: { userId: u.id, crmKey, role: (v || null) as CrmRole | null },
                    });
                    await qc.invalidateQueries({ queryKey: ["crm_members"] });
                    toast.success("עודכן");
                  } catch (err: any) { toast.error(err?.message ?? "שגיאה"); }
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function RoleSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-input bg-background px-2 py-1 text-xs"
    >
      {Object.entries(ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function CrmRow({ crm, onSave, onDelete }: { crm: any; onSave: (p: any) => void; onDelete: () => void }) {
  const [d, setD] = useState({ name: crm.name, color: crm.color, idLabel: crm.idLabel, isActive: crm.isActive });
  const dirty = d.name !== crm.name || d.color !== crm.color || d.idLabel !== crm.idLabel || d.isActive !== crm.isActive;
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-2">
      <Field label="שם" value={d.name} onChange={(v) => setD({ ...d, name: v })} />
      <Field label="כותרת מזהה" value={d.idLabel} onChange={(v) => setD({ ...d, idLabel: v })} />
      <div>
        <label className="text-xs font-medium block mb-1">צבע</label>
        <input type="color" value={d.color} onChange={(e) => setD({ ...d, color: e.target.value })}
          className="h-9 w-14 rounded-lg border border-input bg-background" />
      </div>
      <label className="flex items-center gap-1.5 text-xs pb-2">
        <input type="checkbox" checked={d.isActive} onChange={(e) => setD({ ...d, isActive: e.target.checked })} />
        פעיל
      </label>
      <span className="text-[11px] text-muted-foreground pb-2">{crm.key}</span>
      <div className="mr-auto flex gap-1">
        {dirty && (
          <button onClick={() => onSave({ key: crm.key, ...d, sortOrder: crm.sortOrder })}
            className="rounded-lg bg-primary text-primary-foreground px-2 py-2"><Save className="h-3.5 w-3.5" /></button>
        )}
        {crm.key !== "yemot" && (
          <button onClick={onDelete} className="rounded-lg border border-border p-2 text-muted-foreground hover:text-destructive">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

export function CrmFieldBuilder({ crmKey }: { crmKey: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listFieldDefs);
  const upFn = useServerFn(upsertFieldDef);
  const delFn = useServerFn(deleteFieldDef);
  const { data: fields = [] } = useQuery({
    queryKey: ["crm_field_defs", crmKey],
    queryFn: async () => listFn({ data: { crmKey } }),
  });
  const [d, setD] = useState({ fieldKey: "", label: "", fieldType: "text", options: "", showInTable: false, required: false });

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ["crm_field_defs", crmKey] });
  }

  return (
    <div className="space-y-2">
      {fields.map((f) => (
        <div key={f.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm">
          <span className="font-medium">{f.label}</span>
          <span className="text-xs text-muted-foreground">{f.fieldKey} · {FIELD_TYPES.find((t) => t.v === f.fieldType)?.l}</span>
          {f.showInTable && <span className="text-[11px] rounded bg-muted px-1.5 py-0.5">בטבלה</span>}
          {f.required && <span className="text-[11px] rounded bg-muted px-1.5 py-0.5">חובה</span>}
          <button
            onClick={async () => {
              if (!confirm("למחוק שדה?")) return;
              await delFn({ data: { id: f.id } });
              await refresh();
            }}
            className="mr-auto text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      {fields.length === 0 && <p className="text-xs text-muted-foreground">אין שדות מותאמים</p>}

      <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
        <Field label="תווית" value={d.label} onChange={(v) => setD({ ...d, label: v })} />
        <Field label="מזהה (אנגלית)" value={d.fieldKey} onChange={(v) => setD({ ...d, fieldKey: v })} />
        <div>
          <label className="text-xs font-medium block mb-1">סוג</label>
          <select value={d.fieldType} onChange={(e) => setD({ ...d, fieldType: e.target.value })}
            className="rounded-lg border border-input bg-background px-2 py-2 text-sm">
            {FIELD_TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
          </select>
        </div>
        {d.fieldType === "select" && (
          <Field label="אפשרויות (מופרד בפסיק)" value={d.options} onChange={(v) => setD({ ...d, options: v })} />
        )}
        <label className="flex items-center gap-1.5 text-xs pb-2">
          <input type="checkbox" checked={d.showInTable} onChange={(e) => setD({ ...d, showInTable: e.target.checked })} /> בטבלה
        </label>
        <label className="flex items-center gap-1.5 text-xs pb-2">
          <input type="checkbox" checked={d.required} onChange={(e) => setD({ ...d, required: e.target.checked })} /> חובה
        </label>
        <button
          onClick={async () => {
            if (!d.label || !d.fieldKey) return toast.error("נא למלא תווית ומזהה");
            try {
              await upFn({
                data: {
                  crmKey,
                  fieldKey: d.fieldKey,
                  label: d.label,
                  fieldType: d.fieldType as any,
                  options: d.options ? d.options.split(",").map((s) => s.trim()).filter(Boolean) : [],
                  required: d.required,
                  showInTable: d.showInTable,
                  sortOrder: fields.length,
                },
              });
              setD({ fieldKey: "", label: "", fieldType: "text", options: "", showInTable: false, required: false });
              await refresh();
            } catch (e: any) { toast.error(e?.message ?? "שגיאה"); }
          }}
          className="flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm"
        >
          <Plus className="h-4 w-4" /> הוסף שדה
        </button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-xs font-medium block mb-1">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm" />
    </div>
  );
}
