import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listUsersForAdmin, createUser, deleteUser, setUserRole, getMyRole,
  updateUserDisplayName, updateUserEmail, updateUserPassword,
} from "@/lib/admin.functions";
import { useState } from "react";
import { toast } from "sonner";
import { UserPlus, Trash2, Shield, User as UserIcon, Pencil, Mail, Key, Check, X } from "lucide-react";

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

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => meFn() });
  const { data: users } = useQuery({ queryKey: ["agents"], queryFn: () => agentsFn() });

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", display_name: "", role: "agent" as "admin" | "agent" });
  const [editing, setEditing] = useState<{ id: string; field: "name" | "email" | "password"; value: string } | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["agents"] });
  const onErr = (e: any) => toast.error(e.message);

  const createMut = useMutation({
    mutationFn: createFn,
    onSuccess: () => {
      toast.success("משתמש נוצר");
      invalidate();
      setShowCreate(false);
      setForm({ email: "", password: "", display_name: "", role: "agent" });
    },
    onError: onErr,
  });
  const deleteMut = useMutation({ mutationFn: deleteFn, onSuccess: () => { toast.success("נמחק"); invalidate(); }, onError: onErr });
  const roleMut = useMutation({ mutationFn: roleFn, onSuccess: () => { toast.success("הרשאה עודכנה"); invalidate(); }, onError: onErr });
  const nameMut = useMutation({ mutationFn: nameFn, onSuccess: () => { toast.success("שם עודכן"); invalidate(); setEditing(null); }, onError: onErr });
  const emailMut = useMutation({ mutationFn: emailFn, onSuccess: () => { toast.success('דוא"ל עודכן'); invalidate(); setEditing(null); }, onError: onErr });
  const pwMut = useMutation({ mutationFn: pwFn, onSuccess: () => { toast.success("סיסמה עודכנה"); invalidate(); setEditing(null); }, onError: onErr });


  if (me && !me.isAdmin) {
    return <div className="text-center py-20"><h2 className="text-xl font-semibold">אין הרשאה</h2><p className="text-muted-foreground mt-2">דף זה מיועד למנהלים בלבד.</p></div>;
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
