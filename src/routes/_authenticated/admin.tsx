import { createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listAgents } from "@/lib/systems.functions";
import { createUser, deleteUser, setUserRole, getMyRole } from "@/lib/admin.functions";
import { useState } from "react";
import { toast } from "sonner";
import { UserPlus, Trash2, Shield, User as UserIcon } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "ניהול משתמשים | CRM" }] }),
  component: AdminPage,
});

function AdminPage() {
  const qc = useQueryClient();
  const agentsFn = useServerFn(listAgents);
  const meFn = useServerFn(getMyRole);
  const createFn = useServerFn(createUser);
  const deleteFn = useServerFn(deleteUser);
  const roleFn = useServerFn(setUserRole);

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => meFn() });
  const { data: users } = useQuery({ queryKey: ["agents"], queryFn: () => agentsFn() });

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", display_name: "", role: "agent" as "admin" | "agent" });

  const createMut = useMutation({
    mutationFn: createFn,
    onSuccess: () => {
      toast.success("משתמש נוצר");
      qc.invalidateQueries({ queryKey: ["agents"] });
      setShowCreate(false);
      setForm({ email: "", password: "", display_name: "", role: "agent" });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: deleteFn,
    onSuccess: () => { toast.success("נמחק"); qc.invalidateQueries({ queryKey: ["agents"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const roleMut = useMutation({
    mutationFn: roleFn,
    onSuccess: () => { toast.success("הרשאה עודכנה"); qc.invalidateQueries({ queryKey: ["agents"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  if (me && !me.isAdmin) {
    return <div className="text-center py-20"><h2 className="text-xl font-semibold">אין הרשאה</h2><p className="text-muted-foreground mt-2">דף זה מיועד למנהלים בלבד.</p></div>;
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">ניהול משתמשים</h1>
          <p className="text-muted-foreground text-sm mt-1">צור והגדר נציגים ומנהלים</p>
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
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {(users ?? []).map((u: any) => {
              const isAdmin = u.roles.includes("admin");
              return (
                <tr key={u.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium">{u.display_name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                  <td className="px-4 py-3">
                    <select value={isAdmin ? "admin" : "agent"} disabled={u.id === me?.userId}
                      onChange={(e) => roleMut.mutate({ data: { user_id: u.id, role: e.target.value as "admin" | "agent" } })}
                      className="text-xs rounded-md border border-input bg-background px-2 py-1">
                      <option value="agent">נציג</option>
                      <option value="admin">מנהל</option>
                    </select>
                    {isAdmin && <Shield className="h-3.5 w-3.5 text-primary inline mr-2" />}
                    {!isAdmin && <UserIcon className="h-3.5 w-3.5 text-muted-foreground inline mr-2" />}
                  </td>
                  <td className="px-4 py-3 text-left">
                    {u.id !== me?.userId && (
                      <button onClick={() => { if (confirm("למחוק משתמש זה?")) deleteMut.mutate({ data: { user_id: u.id } }); }}
                        className="text-destructive hover:bg-destructive/10 rounded p-1.5">
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
              <div>
                <label className="text-sm font-medium block mb-1">שם תצוגה</label>
                <input required value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">דוא"ל</label>
                <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">סיסמה (מינ' 6)</label>
                <input type="text" required minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">תפקיד</label>
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as any })}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
                  <option value="agent">נציג</option>
                  <option value="admin">מנהל</option>
                </select>
              </div>
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
