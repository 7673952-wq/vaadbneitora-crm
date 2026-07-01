import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listUsersForAdmin, createUser, deleteUser, setUserRole, getMyRole,
  updateUserDisplayName, updateUserEmail, updateUserPassword,
  listStatusSettings, upsertStatusSetting, deleteStatusSetting,
  getAutoSnoozeSetting, setAutoSnoozeSetting,
  getBackupEmail, setBackupEmail,
  getStaleWarningHours, setStaleWarningHours,
} from "@/lib/admin.functions";
import { AVAILABLE_TONES, toneClasses, applyStatusSettings } from "@/lib/status";
import { getAuthHeaders } from "@/lib/auth-headers";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { UserPlus, Trash2, Shield, User as UserIcon, Pencil, Mail, Key, Check, X, Palette, Plus, Clock, FileText, Database } from "lucide-react";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "ניהול | CRM" }] }),
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
    queryKey: ["admin_users"],
    queryFn: async () => agentsFn({ headers: await getAuthHeaders() }),
    enabled: me?.isAdmin === true,
  });

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", display_name: "", role: "agent" as "admin" | "agent" | "super_admin" | "viewer" });
  const [editing, setEditing] = useState<{ id: string; field: "name" | "email" | "password"; value: string } | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin_users"] });
  const withAuth = async (fn: any, vars?: any) => fn({ ...(vars ?? {}), headers: await getAuthHeaders() });
  const onErr = (e: any) => toast.error(e.message);

  const createMut = useMutation({
    mutationFn: (vars: any) => withAuth(createFn, vars),
    onSuccess: () => {
      toast.success("משתמש נוצר");
      invalidate();
      setShowCreate(false);
      setForm({ email: "", password: "", display_name: "", role: "agent" as const });
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
          <h1 className="text-3xl font-bold tracking-tight">ניהול</h1>
          <p className="text-muted-foreground text-sm mt-1">ניהול משתמשים, הרשאות, סטטוסים וצבעי המערכת</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {me?.isSuperAdmin && (
            <>
              <Link to="/audit" className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm font-medium hover:bg-accent">
                <FileText className="h-4 w-4" />יומן בקרה
              </Link>
              <Link to="/backups" className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm font-medium hover:bg-accent">
                <Database className="h-4 w-4" />גיבויים
              </Link>
            </>
          )}
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
            <UserPlus className="h-4 w-4" />משתמש חדש
          </button>
        </div>
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
              const roles = Array.isArray(u.roles) ? u.roles : [];
              const isSuper = roles.includes("super_admin");
              const isAdmin = roles.includes("admin");
              const isAgentRole = roles.includes("agent");
              const isViewerOnly = !isAdmin && !isAgentRole && roles.includes("viewer");
              const currentRole = isSuper ? "super_admin" : isAdmin ? "admin" : isViewerOnly ? "viewer" : "agent";
              const editingThis = editing?.id === u.id;
              return (
                <tr key={u.id} className="border-b border-border last:border-0 align-top">
                  <td className="px-4 py-3">
                    {editingThis && editing?.field === "name" ? (
                      <EditRow value={editing.value} onChange={(v) => setEditing({ ...editing, value: v })} onSave={submitEdit} onCancel={() => setEditing(null)} />

I will continue in the next message due to length limits.