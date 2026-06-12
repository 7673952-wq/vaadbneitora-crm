import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listUsersForAdmin, createUser, deleteUser, setUserRole, getMyRole,
  updateUserDisplayName, updateUserEmail, updateUserPassword,
  listStatusSettings, upsertStatusSetting, deleteStatusSetting,
} from "@/lib/admin.functions";
import { AVAILABLE_TONES, toneClasses, applyStatusSettings } from "@/lib/status";
import { getAuthHeaders } from "@/lib/auth-headers";
import { useState } from "react";
import { toast } from "sonner";
import { UserPlus, Trash2, Shield, User as UserIcon, Pencil, Mail, Key, Check, X, Palette, Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "ניהול משתמשים | CRM" }] }),
  component: AdminPage,
});

function AdminPage() {
  const qc = useQueryClient();
  const agentsFn = useServerFn(listUsersForAdmin);
  const meFn = useServerFn(getMyRole);
  const createFn = useServerFn(createUser);
  const deleteFn = useServerFn(deleteUser);
  const roleFn = useServerFn(setUserRole);
  const nameFn = useServerFn(updateUserDisplayName);
  const emailFn = useServerFn(updateUserEmail);
  const pwFn = useServerFn(updateUserPassword);

  const { data: me, error: meError, isLoading: meLoading } = useQuery({ queryKey: ["me"], queryFn: async () => meFn({ headers: await getAuthHeaders() }) });
  const { data: users, error: usersError, isLoading: usersLoading } = useQuery({
    queryKey: ["agents"],
    queryFn: async () => agentsFn({ headers: await getAuthHeaders() }),
    enabled: me?.isAdmin === true,
  });

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", display_name: "", role: "agent" as "admin" | "agent" });
  const [editing, setEditing] = useState<{ id: string; field: "name" | "email" | "password"; value: string } | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["agents"] });
  const withAuth = async (fn: any, vars?: any) => fn({ ...(vars ?? {}), headers: await getAuthHeaders() });
  const onErr = (e: any) => toast.error(e.message);

  const createMut = useMutation({
    mutationFn: (vars: any) => withAuth(createFn, vars),
    onSuccess: () => {
      toast.success("משתמש נוצר");
      invalidate();
      setShowCreate(false);
      setForm({ email: "", password: "", display_name: "", role: "agent" });
    },
    onError: onErr,
  });
  const deleteMut = useMutation({ mutationFn: (vars: any) => withAuth(deleteFn, vars), onSuccess: () => { toast.success("נמחק"); invalidate(); }, onError: onErr });
  const roleMut = useMutation({ mutationFn: (vars: any) => withAuth(roleFn, vars), onSuccess: () => { toast.success("הרשאה עודכנה"); invalidate(); }, onError: onErr });
  const nameMut = useMutation({ mutationFn: (vars: any) => withAuth(nameFn, vars), onSuccess: () => { toast.success("שם עודכן"); invalidate(); setEditing(null); }, onError: onErr });
  const emailMut = useMutation({ mutationFn: (vars: any) => withAuth(emailFn, vars), onSuccess: () => { toast.success('דוא"ל עודכן'); invalidate(); setEditing(null); }, onError: onErr });
  const pwMut = useMutation({ mutationFn: (vars: any) => withAuth(pwFn, vars), onSuccess: () => { toast.success("סיסמה עודכנה"); invalidate(); setEditing(null); }, onError: onErr });


  if (meLoading) {
    return <div className="text-center py-20 text-muted-foreground">טוען הרשאות...</div>;
  }

  if (meError) {
    return <AdminError message={meError.message} />;
  }

  if (me && !me.isAdmin) {
    return <div className="text-center py-20"><h2 className="text-xl font-semibold">אין הרשאה</h2><p className="text-muted-foreground mt-2">דף זה מיועד למנהלים בלבד.</p></div>;
  }

  if (usersError) {
    return <AdminError message={usersError.message} />;
  }

  function startEdit(u: any, field: "name" | "email" | "password") {
    setEditing({
      id: u.id,
      field,
      value: field === "name" ? u.display_name : field === "email" ? u.email : "",
    });
  }
  function submitEdit() {
    if (!editing) return;
    const v = editing.value.trim();
    if (!v) return toast.error("ערך ריק");
    if (editing.field === "name") nameMut.mutate({ data: { user_id: editing.id, display_name: v } });
    else if (editing.field === "email") emailMut.mutate({ data: { user_id: editing.id, email: v } });
    else pwMut.mutate({ data: { user_id: editing.id, password: v } });
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">ניהול משתמשים</h1>
          <p className="text-muted-foreground text-sm mt-1">צור, ערוך והגדר הרשאות לנציגים ומנהלים</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
          <UserPlus className="h-4 w-4" />משתמש חדש
        </button>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr className="text-right">
              <th className="px-4 py-3 font-medium text-muted-foreground">שם</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">דוא"ל</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">תפקיד</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">כניסה אחרונה</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {(users ?? []).map((u: any) => {
              const isAdmin = u.roles.includes("admin");
              const editingThis = editing?.id === u.id;
              return (
                <tr key={u.id} className="border-b border-border last:border-0 align-top">
                  <td className="px-4 py-3">
                    {editingThis && editing?.field === "name" ? (
                      <EditRow value={editing.value} onChange={(v) => setEditing({ ...editing, value: v })} onSave={submitEdit} onCancel={() => setEditing(null)} />

                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{u.display_name}</span>
                        <button onClick={() => startEdit(u, "name")} className="text-muted-foreground hover:text-foreground"><Pencil className="h-3 w-3" /></button>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {editingThis && editing?.field === "email" ? (
                      <EditRow type="email" value={editing.value} onChange={(v) => setEditing({ ...editing, value: v })} onSave={submitEdit} onCancel={() => setEditing(null)} />
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">{u.email}</span>
                        <button onClick={() => startEdit(u, "email")} className="text-muted-foreground hover:text-foreground"><Mail className="h-3 w-3" /></button>
                      </div>
                    )}
                    {editingThis && editing?.field === "password" && (
                      <div className="mt-2">
                        <EditRow type="text" placeholder="סיסמה חדשה (מינ׳ 6)" value={editing.value} onChange={(v) => setEditing({ ...editing, value: v })} onSave={submitEdit} onCancel={() => setEditing(null)} />
                      </div>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <select value={isAdmin ? "admin" : "agent"} disabled={u.id === me?.userId}
                        onChange={(e) => roleMut.mutate({ data: { user_id: u.id, role: e.target.value as "admin" | "agent" } })}
                        className="text-xs rounded-md border border-input bg-background px-2 py-1">
                        <option value="agent">נציג</option>
                        <option value="admin">מנהל</option>
                      </select>
                      {isAdmin ? <Shield className="h-3.5 w-3.5 text-primary" /> : <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString("he-IL") : "—"}
                  </td>
                  <td className="px-4 py-3 text-left whitespace-nowrap">
                    <button onClick={() => startEdit(u, "password")} title="שנה סיסמה"
                      className="text-muted-foreground hover:text-foreground p-1.5 rounded hover:bg-accent">
                      <Key className="h-4 w-4" />
                    </button>
                    {u.id !== me?.userId && (
                      <button onClick={() => { if (confirm("למחוק משתמש זה?")) deleteMut.mutate({ data: { user_id: u.id } }); }}
                        className="text-destructive hover:bg-destructive/10 rounded p-1.5 mr-1">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-card border border-border rounded-2xl max-w-md w-full p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold mb-4">יצירת משתמש חדש</h2>
            <form onSubmit={(e) => { e.preventDefault(); createMut.mutate({ data: form }); }} className="space-y-3">
              <Field label="שם תצוגה"><input required value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" /></Field>
              <Field label='דוא"ל'><input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" /></Field>
              <Field label="סיסמה (מינ׳ 6)"><input type="text" required minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" /></Field>
              <Field label="תפקיד">
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as any })} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
                  <option value="agent">נציג</option>
                  <option value="admin">מנהל</option>
                </select>
              </Field>
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 border border-border rounded-lg text-sm hover:bg-accent">ביטול</button>
                <button type="submit" disabled={createMut.isPending} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
              {createMut.isPending ? "יוצר..." : "צור משתמש"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <StatusSettingsPanel />
    </div>
  );
}

function StatusSettingsPanel() {
  const qc = useQueryClient();
  const listFn = useServerFn(listStatusSettings);
  const upsertFn = useServerFn(upsertStatusSetting);
  const delFn = useServerFn(deleteStatusSetting);
  const { data: rows } = useQuery({ queryKey: ["status_settings"], queryFn: async () => listFn({ headers: await getAuthHeaders() }) });

  const refresh = async () => {
    const fresh = await qc.fetchQuery({ queryKey: ["status_settings"], queryFn: async () => listFn({ headers: await getAuthHeaders() }) });
    applyStatusSettings(fresh as any);
    qc.invalidateQueries({ queryKey: ["systems"] });
  };

  const withAuth = async (fn: any, vars?: any) => fn({ ...(vars ?? {}), headers: await getAuthHeaders() });

  const upsertMut = useMutation({
    mutationFn: (vars: any) => withAuth(upsertFn, vars),
    onSuccess: async () => { await refresh(); toast.success("נשמר"); },
    onError: (e: any) => toast.error(e.message),
  });
  const delMut = useMutation({
    mutationFn: (vars: any) => withAuth(delFn, vars),
    onSuccess: async () => { await refresh(); toast.success("נמחק"); },
    onError: (e: any) => toast.error(e.message),
  });

  const [showAdd, setShowAdd] = useState(false);
  const [newRow, setNewRow] = useState({ status_key: "", label: "", tone: "green", sort_order: 1000 });

  return (
    <div className="mt-10">
      <div className="flex items-end justify-between flex-wrap gap-3 mb-3">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2"><Palette className="h-5 w-5" /> ניהול סטטוסים וצבעים</h2>
          <p className="text-sm text-muted-foreground mt-1">ערוך שמות סטטוסים, שנה צבעים והסדר. שינויים חלים מיד על כל הצוות.</p>
        </div>
        <button onClick={() => setShowAdd((v) => !v)} className="flex items-center gap-2 px-3 py-2 bg-secondary text-secondary-foreground rounded-lg text-sm hover:bg-secondary/80">
          <Plus className="h-4 w-4" /> סטטוס חדש
        </button>
      </div>

      {showAdd && (
        <div className="bg-card border border-border rounded-xl p-4 mb-4 grid sm:grid-cols-5 gap-2 items-end">
          <Field label="מפתח (אנגלית)"><input value={newRow.status_key} onChange={(e) => setNewRow({ ...newRow, status_key: e.target.value })} placeholder="my_custom_status" className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" /></Field>
          <Field label="תווית"><input value={newRow.label} onChange={(e) => setNewRow({ ...newRow, label: e.target.value })} className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" /></Field>
          <Field label="צבע">
            <select value={newRow.tone} onChange={(e) => setNewRow({ ...newRow, tone: e.target.value })} className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm">
              {AVAILABLE_TONES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="מיקום"><input type="number" value={newRow.sort_order} onChange={(e) => setNewRow({ ...newRow, sort_order: Number(e.target.value) })} className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" /></Field>
          <button onClick={() => upsertMut.mutate({ data: { ...newRow, is_custom: true } })} className="px-3 py-2 bg-primary text-primary-foreground rounded-md text-sm">הוסף</button>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr className="text-right">
              <th className="px-3 py-2 font-medium text-muted-foreground">תצוגה</th>
              <th className="px-3 py-2 font-medium text-muted-foreground">תווית</th>
              <th className="px-3 py-2 font-medium text-muted-foreground">צבע</th>
              <th className="px-3 py-2 font-medium text-muted-foreground">סדר</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r: any) => (
              <StatusEditRow key={r.status_key} row={r}
                onSave={(patch) => upsertMut.mutate({ data: { status_key: r.status_key, ...patch, is_custom: r.is_custom } })}
                onDelete={r.is_custom ? () => { if (confirm("למחוק סטטוס זה?")) delMut.mutate({ data: { status_key: r.status_key } }); } : undefined}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusEditRow({ row, onSave, onDelete }: { row: any; onSave: (p: { label: string; tone: string; sort_order: number }) => void; onDelete?: () => void }) {
  const [label, setLabel] = useState(row.label);
  const [tone, setTone] = useState(row.tone);
  const [order, setOrder] = useState<number>(row.sort_order ?? 0);
  const dirty = label !== row.label || tone !== row.tone || order !== row.sort_order;
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-2">
        <span className={`text-xs rounded-full px-3 py-1 font-medium ${toneClasses(tone)}`}>{label || row.status_key}</span>
        <div className="text-[10px] font-mono text-muted-foreground mt-1">{row.status_key}{row.is_custom && " · מותאם"}</div>
      </td>
      <td className="px-3 py-2"><input value={label} onChange={(e) => setLabel(e.target.value)} className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm" /></td>
      <td className="px-3 py-2">
        <select value={tone} onChange={(e) => setTone(e.target.value)} className="rounded-md border border-input bg-background px-2 py-1 text-sm">
          {AVAILABLE_TONES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </td>
      <td className="px-3 py-2"><input type="number" value={order} onChange={(e) => setOrder(Number(e.target.value))} className="w-20 rounded-md border border-input bg-background px-2 py-1 text-sm" /></td>
      <td className="px-3 py-2 text-left whitespace-nowrap">
        <button disabled={!dirty} onClick={() => onSave({ label, tone, sort_order: order })}
          className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded disabled:opacity-30">שמור</button>
        {onDelete && (
          <button onClick={onDelete} className="text-destructive hover:bg-destructive/10 rounded p-1.5 mr-1"><Trash2 className="h-4 w-4 inline" /></button>
        )}
      </td>
    </tr>
  );
}

function AdminError({ message }: { message: string }) {
  return (
    <div className="max-w-xl mx-auto text-center py-20">
      <h2 className="text-xl font-semibold text-destructive">ניהול המשתמשים לא נטען</h2>
      <p className="text-sm text-muted-foreground mt-2">{message}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-sm font-medium block mb-1">{label}</label>{children}</div>;
}

function EditRow({ value, onChange, onSave, onCancel, type = "text", placeholder }: { value: string; onChange: (v: string) => void; onSave: () => void; onCancel: () => void; type?: string; placeholder?: string }) {
  return (
    <div className="flex items-center gap-1">
      <input autoFocus type={type} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onSave(); if (e.key === "Escape") onCancel(); }}
        className="rounded-md border border-input bg-background px-2 py-1 text-sm" />
      <button onClick={onSave} className="p-1 rounded hover:bg-accent text-emerald-600"><Check className="h-3.5 w-3.5" /></button>
      <button onClick={onCancel} className="p-1 rounded hover:bg-accent text-muted-foreground"><X className="h-3.5 w-3.5" /></button>
    </div>
  );
}
