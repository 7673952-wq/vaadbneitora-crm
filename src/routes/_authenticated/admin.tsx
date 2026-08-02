import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listUsersForAdmin, createUser, deleteUser, setUserRole, getMyRole,
  updateUserDisplayName, updateUserEmail, updateUserPassword,
  listStatusSettings, upsertStatusSetting, deleteStatusSetting, reorderStatusSettings,
  getAutoSnoozeSetting, setAutoSnoozeSetting,
  getBackupEmail, setBackupEmail,
  getBackupSchedule, setBackupSchedule,
  getStaleWarningHours, setStaleWarningHours,
  getSeriesDetection, setSeriesDetection,
  listPermissionSettings, setRolePermission, setUserPermission, deleteUserPermission,
} from "@/lib/admin.functions";
import {
  getEmailRelayConfig, setEmailRelayConfig, getMyEmailProfile, setMyEmailSignature,
  listEmailTemplates, upsertEmailTemplate, deleteEmailTemplate,
  listAgentEmailNames, setAgentEmailDisplayName,
} from "@/lib/email.functions";
import { AVAILABLE_TONES, toneClasses, applyStatusSettings, STATUS_OPTIONS } from "@/lib/status";
import { getAuthHeaders } from "@/lib/auth-headers";
import { VoiceMessageLogPanel } from "@/components/VoiceMessageLogPanel";
import { CrmManagerPanel, CrmPermissionsPanel, CrmFieldBuilder } from "@/components/CrmManagerPanel";
import { useMyCrms, type CrmSummary } from "@/lib/use-crms";
import { BackupsPage } from "./backups";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  listRoleNotificationDefaults, updateRoleNotificationDefault,
} from "@/lib/notifications.functions";
import {
  UserPlus, Trash2, Shield, User as UserIcon, Pencil, Mail, Key, Check, X,
  Palette, Plus, Clock, FileText, Database, Users, Settings, ListChecks,
  Search as SearchIcon, ArrowUp, ArrowDown, LockKeyhole, Volume2, BellRing, LayoutGrid,
} from "lucide-react";
import { EmailContentEditor } from "@/components/EmailContentEditor";
import { cleanEmailContent, type EmailCleanupLevel } from "@/lib/email-cleanup";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "ניהול | CRM" }] }),
  loader: ({ context }) => {
    context.queryClient.prefetchQuery({
      queryKey: ["me"],
      queryFn: async () => getMyRole({ headers: await getAuthHeaders() }),
      staleTime: 5 * 60_000,
    });
  },
  component: AdminPage,
});

function AdminPage() {
  const meFn = useServerFn(getMyRole);
  const { data: me, error: meError, isLoading: meLoading } = useQuery({ queryKey: ["me"], queryFn: async () => meFn({ headers: await getAuthHeaders() }) });
  const { data: crms = [] } = useMyCrms();

  if (meLoading) return <div className="text-center py-20 text-muted-foreground">טוען הרשאות...</div>;
  if (meError) return <AdminError message={meError.message} />;

  const perms = (me?.permissions ?? {}) as Record<string, boolean>;
  const canUsers = !!perms.users_manage;
  const canGeneral = !!(perms.settings_manage || perms.backup_manage);
  const canStatuses = !!perms.settings_manage;
  const canSeries = !!perms.series_manage;
  const canPermissions = !!perms.permissions_manage;
  const canVoiceLog = !!perms.settings_manage;
  const canBackups = !!me?.isSuperAdmin;
  const canEmail = !!(perms.settings_manage || perms.backup_manage);
  const canNotifs = !!(perms.settings_manage || perms.users_manage || perms.permissions_manage);
  const canCrms = !!(perms.settings_manage || perms.permissions_manage || me?.isSuperAdmin);

  const canOpenAdmin = me?.isAdmin || canUsers || canGeneral || canStatuses || canSeries || canPermissions || canVoiceLog || canBackups || canEmail || canNotifs;

  if (me && !canOpenAdmin) {
    return <div className="text-center py-20"><h2 className="text-xl font-semibold">אין הרשאה</h2><p className="text-muted-foreground mt-2">דף זה מיועד למנהלים בלבד.</p></div>;
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">ניהול</h1>
          <p className="text-muted-foreground text-sm mt-1">הגדרות כלליות לכל המערכות, והגדרות נפרדות לכל CRM</p>
        </div>
        {me?.isSuperAdmin && (
          <div className="flex items-center gap-2 flex-wrap">
            <Link to="/audit" className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm font-medium hover:bg-accent">
              <FileText className="h-4 w-4" />יומן בקרה
            </Link>
          </div>
        )}
      </div>

      <Tabs defaultValue="general" dir="rtl">
        <TabsList className="flex flex-wrap gap-1 h-auto">
          <TabsTrigger value="general" className="flex items-center gap-1.5"><Settings className="h-3.5 w-3.5" />כללי</TabsTrigger>
          {crms.map((c) => (
            <TabsTrigger key={c.key} value={`crm:${c.key}`} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
              {c.name}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="general" className="mt-4">
          <GeneralAdminTabs
            me={me}
            flags={{ canUsers, canGeneral, canPermissions, canBackups, canEmail, canNotifs, canCrms }}
            crms={crms}
          />
        </TabsContent>

        {crms.map((c) => (
          <TabsContent key={c.key} value={`crm:${c.key}`} className="mt-4">
            {c.key === "yemot" ? (
              <YemotAdminTabs flags={{ canStatuses, canSeries, canVoiceLog, canCrms }} />
            ) : (
              <GenericCrmAdminTabs crmKey={c.key} canCrms={canCrms} />
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

/** "כללי" — everything that is shared across all CRMs. */
function GeneralAdminTabs({ me, flags, crms }: { me: any; flags: Record<string, boolean>; crms: CrmSummary[] }) {
  const { canUsers, canGeneral, canPermissions, canBackups, canEmail, canNotifs, canCrms } = flags;
  const first = canUsers ? "users" : canCrms ? "crms" : canGeneral ? "settings" : canNotifs ? "notifications" : canEmail ? "email" : canPermissions ? "permissions" : "backups";
  return (
    <Tabs defaultValue={first} dir="rtl">
      <TabsList className="flex flex-wrap gap-1 h-auto">
        {canUsers && <TabsTrigger value="users" className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />משתמשים</TabsTrigger>}
        {canCrms && <TabsTrigger value="crms" className="flex items-center gap-1.5"><LayoutGrid className="h-3.5 w-3.5" />מערכות CRM</TabsTrigger>}
        {canGeneral && <TabsTrigger value="settings" className="flex items-center gap-1.5"><Settings className="h-3.5 w-3.5" />הגדרות כלליות</TabsTrigger>}
        {canNotifs && <TabsTrigger value="notifications" className="flex items-center gap-1.5"><BellRing className="h-3.5 w-3.5" />פעמון התראות</TabsTrigger>}
        {canEmail && <TabsTrigger value="email" className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />הגדרות מייל</TabsTrigger>}
        {canBackups && <TabsTrigger value="backups" className="flex items-center gap-1.5"><Database className="h-3.5 w-3.5" />גיבויים</TabsTrigger>}
      </TabsList>

      {canUsers && <TabsContent value="users" className="mt-4"><UsersPanel me={me} /></TabsContent>}
      {canCrms && <TabsContent value="crms" className="mt-4"><CrmManagerPanel /></TabsContent>}
      {canGeneral && <TabsContent value="settings" className="mt-4 space-y-6">
        <AutoSnoozePanel />
        <StaleHoursPanel />
        <BackupEmailPanel />
        <BackupSchedulePanel />
      </TabsContent>}
      {canNotifs && <TabsContent value="notifications" className="mt-4"><NotificationsPanel crms={crms} /></TabsContent>}
      {canEmail && <TabsContent value="email" className="mt-4"><EmailSettingsPanel /></TabsContent>}
      {canBackups && <TabsContent value="backups" className="mt-4"><BackupsPage embedded /></TabsContent>}
    </Tabs>
  );
}

/** "ימות המשיח" — settings that only belong to the original CRM. */
function YemotAdminTabs({ flags }: { flags: Record<string, boolean> }) {
  const { canStatuses, canSeries, canVoiceLog, canCrms } = flags;
  const first = canStatuses ? "statuses" : canCrms ? "access" : canVoiceLog ? "voice_log" : "series";
  return (
    <Tabs defaultValue={first} dir="rtl">
      <TabsList className="flex flex-wrap gap-1 h-auto">
        {canStatuses && <TabsTrigger value="statuses" className="flex items-center gap-1.5"><Palette className="h-3.5 w-3.5" />סטטוסים</TabsTrigger>}
        {canCrms && <TabsTrigger value="access" className="flex items-center gap-1.5"><LockKeyhole className="h-3.5 w-3.5" />הרשאות למערכת</TabsTrigger>}
        {canCrms && <TabsTrigger value="actions" className="flex items-center gap-1.5"><Shield className="h-3.5 w-3.5" />הרשאות פעולות</TabsTrigger>}
        {canVoiceLog && <TabsTrigger value="voice_log" className="flex items-center gap-1.5"><Volume2 className="h-3.5 w-3.5" />יומן הודעות קוליות</TabsTrigger>}
        {canSeries && <TabsTrigger value="series" className="flex items-center gap-1.5"><SearchIcon className="h-3.5 w-3.5" />השלמת סדרות</TabsTrigger>}
      </TabsList>
      {canStatuses && <TabsContent value="statuses" className="mt-4"><StatusSettingsPanel /></TabsContent>}
      {canCrms && <TabsContent value="access" className="mt-4"><CrmPermissionsPanel crmKey="yemot" /></TabsContent>}
      {canCrms && <TabsContent value="actions" className="mt-4"><PermissionsPanel crmKey="yemot" /></TabsContent>}
      {canVoiceLog && <TabsContent value="voice_log" className="mt-4"><VoiceMessageLogPanel /></TabsContent>}
      {canSeries && <TabsContent value="series" className="mt-4"><SeriesSettingsPanel /></TabsContent>}
    </Tabs>
  );
}

/** Any additional CRM — its own access control and custom field builder. */
function GenericCrmAdminTabs({ crmKey, canCrms }: { crmKey: string; canCrms: boolean }) {
  if (!canCrms) return <div className="text-sm text-muted-foreground">אין הרשאה להגדרות מערכת זו.</div>;
  return (
    <Tabs defaultValue="access" dir="rtl">
      <TabsList className="flex flex-wrap gap-1 h-auto">
        <TabsTrigger value="access" className="flex items-center gap-1.5"><LockKeyhole className="h-3.5 w-3.5" />הרשאות למערכת</TabsTrigger>
        <TabsTrigger value="fields" className="flex items-center gap-1.5"><ListChecks className="h-3.5 w-3.5" />שדות מותאמים</TabsTrigger>
        <TabsTrigger value="actions" className="flex items-center gap-1.5"><Shield className="h-3.5 w-3.5" />הרשאות פעולות</TabsTrigger>
      </TabsList>
      <TabsContent value="access" className="mt-4"><CrmPermissionsPanel crmKey={crmKey} /></TabsContent>
      <TabsContent value="fields" className="mt-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="text-sm font-semibold mb-3">שדות מותאמים</h3>
          <CrmFieldBuilder crmKey={crmKey} />
        </div>
      </TabsContent>
      <TabsContent value="actions" className="mt-4"><PermissionsPanel crmKey={crmKey} /></TabsContent>
    </Tabs>
  );
}

// ============= Users Panel =============
function UsersPanel({ me }: { me: any }) {
  const qc = useQueryClient();
  const agentsFn = useServerFn(listUsersForAdmin);
  const createFn = useServerFn(createUser);
  const deleteFn = useServerFn(deleteUser);
  const roleFn = useServerFn(setUserRole);
  const nameFn = useServerFn(updateUserDisplayName);
  const emailFn = useServerFn(updateUserEmail);
  const pwFn = useServerFn(updateUserPassword);

  const { data: users, error: usersError } = useQuery({
    queryKey: ["admin_users"],
    queryFn: async () => agentsFn({ headers: await getAuthHeaders() }),
  });


  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", display_name: "", role: "agent" as "admin" | "agent" | "super_admin" | "viewer" });
  const [editing, setEditing] = useState<{ id: string; field: "name" | "email" | "password"; value: string } | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin_users"] });
  const withAuth = async (fn: any, vars?: any) => fn({ ...(vars ?? {}), headers: await getAuthHeaders() });
  const onErr = (e: any) => toast.error(e.message);

  const createMut = useMutation({
    mutationFn: (vars: any) => withAuth(createFn, vars),
    onSuccess: () => { toast.success("משתמש נוצר"); invalidate(); setShowCreate(false); setForm({ email: "", password: "", display_name: "", role: "agent" }); },
    onError: onErr,
  });
  const deleteMut = useMutation({ mutationFn: (vars: any) => withAuth(deleteFn, vars), onSuccess: () => { toast.success("נמחק"); invalidate(); }, onError: onErr });
  const roleMut = useMutation({ mutationFn: (vars: any) => withAuth(roleFn, vars), onSuccess: () => { toast.success("הרשאה עודכנה"); invalidate(); }, onError: onErr });
  const nameMut = useMutation({ mutationFn: (vars: any) => withAuth(nameFn, vars), onSuccess: () => { toast.success("שם עודכן"); invalidate(); setEditing(null); }, onError: onErr });
  const emailMut = useMutation({ mutationFn: (vars: any) => withAuth(emailFn, vars), onSuccess: () => { toast.success('דוא"ל עודכן'); invalidate(); setEditing(null); }, onError: onErr });
  const pwMut = useMutation({ mutationFn: (vars: any) => withAuth(pwFn, vars), onSuccess: () => { toast.success("סיסמה עודכנה"); invalidate(); setEditing(null); }, onError: onErr });

  if (usersError) return <AdminError message={usersError.message} />;

  function startEdit(u: any, field: "name" | "email" | "password") {
    setEditing({ id: u.id, field, value: field === "name" ? u.display_name : field === "email" ? u.email : "" });
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
    <div className="space-y-4">
      <div className="flex justify-end">
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
                      <select value={currentRole} disabled={u.id === me?.userId}
                        onChange={(e) => roleMut.mutate({ data: { user_id: u.id, role: e.target.value as any } })}
                        className="text-xs rounded-md border border-input bg-background px-2 py-1">
                        <option value="viewer">צופה</option>
                        <option value="agent">נציג</option>
                        <option value="admin">מנהל</option>
                        <option value="super_admin">מנהל ראשי</option>
                      </select>
                      {isSuper ? <Shield className="h-3.5 w-3.5 text-amber-600" /> : isAdmin ? <Shield className="h-3.5 w-3.5 text-primary" /> : <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString("he-IL") : "—"}
                  </td>
                  <td className="px-4 py-3 text-left whitespace-nowrap">
                    <button onClick={() => startEdit(u, "password")} title="שנה סיסמה" className="text-muted-foreground hover:text-foreground p-1.5 rounded hover:bg-accent">
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
                  <option value="viewer">צופה (קריאה בלבד)</option>
                  <option value="agent">נציג</option>
                  <option value="admin">מנהל</option>
                  <option value="super_admin">מנהל ראשי</option>
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

// ============= Backup Email =============
function BackupEmailPanel() {
  const getFn = useServerFn(getBackupEmail);
  const setFn = useServerFn(setBackupEmail);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["backup_email"], queryFn: async () => getFn({ headers: await getAuthHeaders() }) });
  const [emails, setEmails] = useState<string[]>([""]);
  useEffect(() => { if (data) setEmails(data.emails.length ? data.emails : [""]); }, [data]);
  const mut = useMutation({
    mutationFn: async (vars: { data: { emails: string[] } }) => setFn({ ...vars, headers: await getAuthHeaders() } as any),
    onSuccess: () => { toast.success("המיילים נשמרו"); qc.invalidateQueries({ queryKey: ["backup_email"] }); },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });
  const cleaned = emails.map((e) => e.trim()).filter(Boolean);
  const savedCleaned = (data?.emails ?? []).map((e) => e.trim());
  const isDirty = JSON.stringify(cleaned) !== JSON.stringify(savedCleaned);
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <h2 className="text-lg font-semibold mb-1 flex items-center gap-2"><Mail className="h-4 w-4" />מיילים לגיבויים</h2>
      <p className="text-xs text-muted-foreground mb-3">כתובות המייל שאליהן יישלח קובץ הגיבוי — גם בגיבוי המתוזמן וגם בלחיצה על "שלח למייל" במסך הגיבויים. אפשר להוסיף כמה כתובות.</p>
      <div className="space-y-2">
        {emails.map((email, i) => (
          <div key={i} className="flex gap-2 flex-wrap">
            <input type="email" dir="ltr" placeholder="name@example.com" value={email}
              onChange={(e) => setEmails((arr) => arr.map((v, idx) => idx === i ? e.target.value : v))}
              className="flex-1 min-w-[240px] rounded-lg border border-input bg-background px-3 py-2 text-sm" />
            <button type="button" onClick={() => setEmails((arr) => arr.length > 1 ? arr.filter((_, idx) => idx !== i) : [""])}
              title="הסר" className="px-3 py-2 border border-border rounded-lg text-sm hover:bg-accent">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
        <div className="flex gap-2 flex-wrap items-center pt-1">
          <button type="button" onClick={() => setEmails((arr) => [...arr, ""])}
            className="flex items-center gap-1 px-3 py-2 border border-border rounded-lg text-sm hover:bg-accent">
            <Plus className="h-4 w-4" />הוסף כתובת
          </button>
          <button onClick={() => mut.mutate({ data: { emails: cleaned } })} disabled={mut.isPending || !isDirty}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50">
            {mut.isPending ? "שומר..." : "שמור"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============= Backup Schedule (frequency + time) =============
const WEEKDAY_LABELS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

function BackupSchedulePanel() {
  const getFn = useServerFn(getBackupSchedule);
  const setFn = useServerFn(setBackupSchedule);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["backup_schedule"], queryFn: async () => getFn({ headers: await getAuthHeaders() }) });
  const [frequency, setFrequency] = useState<"daily" | "weekly">("daily");
  const [hour, setHour] = useState(2);
  const [dayOfWeek, setDayOfWeek] = useState(4);
  useEffect(() => {
    if (data) { setFrequency(data.frequency); setHour(data.hour); setDayOfWeek(data.dayOfWeek); }
  }, [data]);
  const mut = useMutation({
    mutationFn: async (vars: { data: { frequency: "daily" | "weekly"; hour: number; dayOfWeek: number } }) =>
      setFn({ ...vars, headers: await getAuthHeaders() } as any),
    onSuccess: () => { toast.success("התדירות נשמרה"); qc.invalidateQueries({ queryKey: ["backup_schedule"] }); },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });
  const isDirty = !data || data.frequency !== frequency || data.hour !== hour || data.dayOfWeek !== dayOfWeek;
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <h2 className="text-lg font-semibold mb-1 flex items-center gap-2"><Clock className="h-4 w-4" />תדירות ושעת גיבוי אוטומטי</h2>
      <p className="text-xs text-muted-foreground mb-3">מתי לבצע גיבוי אוטומטי ולשלוח למיילים שהוגדרו למעלה. השעה היא לפי שעון ישראל; ייתכן איחור של עד רבע שעה מהמועד המדויק.</p>
      <div className="flex gap-3 flex-wrap items-end">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">תדירות</label>
          <select value={frequency} onChange={(e) => setFrequency(e.target.value as "daily" | "weekly")}
            className="rounded-lg border border-input bg-background px-3 py-2 text-sm">
            <option value="daily">כל יום</option>
            <option value="weekly">פעם בשבוע</option>
          </select>
        </div>
        {frequency === "weekly" && (
          <div>
            <label className="block text-xs text-muted-foreground mb-1">יום בשבוע</label>
            <select value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))}
              className="rounded-lg border border-input bg-background px-3 py-2 text-sm">
              {WEEKDAY_LABELS.map((label, idx) => <option key={idx} value={idx}>יום {label}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="block text-xs text-muted-foreground mb-1">שעה</label>
          <select value={hour} onChange={(e) => setHour(Number(e.target.value))}
            className="rounded-lg border border-input bg-background px-3 py-2 text-sm">
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
            ))}
          </select>
        </div>
        <button onClick={() => mut.mutate({ data: { frequency, hour, dayOfWeek } })} disabled={mut.isPending || !isDirty}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50">
          {mut.isPending ? "שומר..." : "שמור"}
        </button>
      </div>
    </div>
  );
}

// ============= Stale Hours =============
function StaleHoursPanel() {
  const getFn = useServerFn(getStaleWarningHours);
  const setFn = useServerFn(setStaleWarningHours);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["stale_warning_hours"], queryFn: async () => getFn({ headers: await getAuthHeaders() }) });
  const [hours, setHours] = useState<number>(24);
  useEffect(() => { if (data) setHours(data.hours); }, [data]);
  const mut = useMutation({
    mutationFn: async (vars: { data: { hours: number } }) => setFn({ ...vars, headers: await getAuthHeaders() } as any),
    onSuccess: () => { toast.success("נשמר"); qc.invalidateQueries({ queryKey: ["stale_warning_hours"] }); },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <h2 className="text-lg font-semibold mb-1 flex items-center gap-2"><Clock className="h-4 w-4" />צביעת אזהרה — זמן ללא טיפול</h2>
      <p className="text-xs text-muted-foreground mb-3">מערכת שלא נגעו בה X שעות ועדיין לא טופלה תוצג עם מסגרת אדומה מהבהבת. 0 = מבוטל.</p>
      <div className="flex gap-2 items-center flex-wrap">
        <input type="number" min={0} max={8760} value={hours}
          onChange={(e) => setHours(Math.max(0, Math.min(8760, Number(e.target.value) || 0)))}
          className="w-28 rounded-lg border border-input bg-background px-3 py-2 text-sm" />
        <span className="text-sm text-muted-foreground">שעות</span>
        <button onClick={() => mut.mutate({ data: { hours } })} disabled={mut.isPending || hours === (data?.hours ?? 24)}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50">
          {mut.isPending ? "שומר..." : "שמור"}
        </button>
      </div>
    </div>
  );
}

// ============= Auto Snooze =============
function AutoSnoozePanel() {
  const getFn = useServerFn(getAutoSnoozeSetting);
  const setFn = useServerFn(setAutoSnoozeSetting);
  const qc = useQueryClient();
  const { data: current } = useQuery({ queryKey: ["auto_snooze"], queryFn: async () => getFn({ headers: await getAuthHeaders() }) });
  const [thresholdDays, setThresholdDays] = useState<number>(30);
  useEffect(() => { if (current) setThresholdDays(current.threshold_days); }, [current]);
  const withAuth = async (fn: any, vars?: any) => fn({ ...(vars ?? {}), headers: await getAuthHeaders() });
  const saveMut = useMutation({
    mutationFn: () => withAuth(setFn, { data: { unit: "day" as const, date: null, threshold_days: thresholdDays } }),
    onSuccess: () => { toast.success("הגדרה נשמרה"); qc.invalidateQueries({ queryKey: ["auto_snooze"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <h2 className="text-lg font-semibold mb-1 flex items-center gap-2"><Clock className="h-4 w-4" />תזכורת אוטומטית</h2>
      <p className="text-xs text-muted-foreground mb-3">מערכת בסטטוס ממתין שלא טופלה במשך מספר הימים שתגדיר, תופיע אוטומטית כתזכורת לנציג המשוייך אליה.</p>
      <div className="flex gap-3 items-end flex-wrap">
        <Field label="סף ימים ללא טיפול">
          <input type="number" min={0} value={thresholdDays} onChange={(e) => setThresholdDays(Number(e.target.value))}
            className="w-32 rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
        </Field>
        <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
          className="px-3 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 disabled:opacity-50">
          {saveMut.isPending ? "שומר..." : "שמור הגדרה"}
        </button>
      </div>
    </div>
  );
}

// ============= Statuses Panel =============
function StatusSettingsPanel() {
  const qc = useQueryClient();
  const listFn = useServerFn(listStatusSettings);
  const upsertFn = useServerFn(upsertStatusSetting);
  const delFn = useServerFn(deleteStatusSetting);
  const reorderFn = useServerFn(reorderStatusSettings);
  const agentsFn = useServerFn(listUsersForAdmin);
  const { data: rows, error: rowsError, isLoading: rowsLoading } = useQuery({ queryKey: ["status_settings"], queryFn: async () => listFn({ headers: await getAuthHeaders() }) });
  const { data: agents } = useQuery({ queryKey: ["admin_users"], queryFn: async () => agentsFn({ headers: await getAuthHeaders() }) });

  const refresh = async () => {
    // staleTime: 0 overrides the global 60s staleTime so we always get fresh data from the server
    const fresh = await qc.fetchQuery({ queryKey: ["status_settings"], queryFn: async () => listFn({ headers: await getAuthHeaders() }), staleTime: 0 });
    applyStatusSettings(fresh as any);
    qc.invalidateQueries({ queryKey: ["systems"] });
  };
  const withAuth = async (fn: any, vars?: any) => fn({ ...(vars ?? {}), headers: await getAuthHeaders() });
  const upsertMut = useMutation({ mutationFn: (vars: any) => withAuth(upsertFn, vars), onSuccess: async () => { await refresh(); toast.success("נשמר"); }, onError: (e: any) => toast.error(e.message) });
  const delMut = useMutation({ mutationFn: (vars: any) => withAuth(delFn, vars), onSuccess: async () => { await refresh(); toast.success("נמחק"); }, onError: (e: any) => toast.error(e.message) });
  const reorderMut = useMutation({ mutationFn: (vars: any) => withAuth(reorderFn, vars), onSuccess: async () => { await refresh(); toast.success("סדר עודכן"); }, onError: (e: any) => toast.error(e?.message || e?.toString() || "שגיאה בשינוי סדר") });
  const [showAdd, setShowAdd] = useState(false);
  const [newRow, setNewRow] = useState({ status_key: "", label: "", tone: "green", sort_order: 1000, is_handled: false, is_mandatory: true, requires_reason: true, enables_voice_message: false, voice_message_template: "", voice_send_mode: "manual" as "manual" | "auto", auto_send_start_hour: 8, auto_send_end_hour: 20 });

  const fallbackRows = STATUS_OPTIONS.map((s, idx) => ({
    status_key: s.value,
    label: s.label,
    tone: s.tone,
    sort_order: idx + 1,
    is_custom: false,
    is_handled: !!s.is_handled,
    is_mandatory: s.is_mandatory ?? true,
    requires_reason: s.requires_reason ?? true,
    assigned_agent_ids: s.assigned_agent_ids ?? [],
    enables_voice_message: (s as any).enables_voice_message ?? false,
    voice_message_template: (s as any).voice_message_template ?? "",
  }));
  const sorted = [...(((rows as any[] | undefined)?.length ? rows : fallbackRows) as any[])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const move = (idx: number, delta: number) => {
    const next = [...sorted];
    const j = idx + delta;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    reorderMut.mutate({ data: { order: next.map((r) => r.status_key) } });
  };
  const renumber = () => reorderMut.mutate({ data: { order: sorted.map((r) => r.status_key) } });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-muted-foreground">סטטוסי "חובה" מוצגים בשורה הראשית בדשבורד. סטטוסים "אופציונליים" מוצגים בשורה נפרדת (עמודה של יוסלה/ועדה).</p>
        <div className="flex gap-2">
          <button onClick={renumber} className="flex items-center gap-1 px-3 py-1.5 border border-border rounded-lg text-xs hover:bg-accent" title="מספר מחדש 1..N">
            <ListChecks className="h-3.5 w-3.5" /> מספר מחדש
          </button>
          <button onClick={() => setShowAdd((v) => !v)} className="flex items-center gap-2 px-3 py-1.5 bg-secondary text-secondary-foreground rounded-lg text-sm hover:bg-secondary/80">
            <Plus className="h-4 w-4" /> סטטוס חדש
          </button>
        </div>
      </div>

      {rowsLoading && <div className="bg-muted/40 border border-border rounded-xl p-4 text-sm text-muted-foreground">טוען סטטוסים...</div>}
      {rowsError && <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 text-sm text-destructive">לא ניתן לטעון סטטוסים שמורים: {rowsError.message}. מוצגת רשימת ברירת־המחדל.</div>}

      {showAdd && (
        <div className="bg-card border border-border rounded-xl p-4 grid sm:grid-cols-2 lg:grid-cols-8 gap-2 items-end">
          <Field label="מפתח (אנגלית)"><input value={newRow.status_key} onChange={(e) => setNewRow({ ...newRow, status_key: e.target.value })} placeholder="my_custom_status" className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" /></Field>
          <Field label="תווית"><input value={newRow.label} onChange={(e) => setNewRow({ ...newRow, label: e.target.value })} className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" /></Field>
          <Field label="צבע">
            <select value={newRow.tone} onChange={(e) => setNewRow({ ...newRow, tone: e.target.value })} className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm">
              {AVAILABLE_TONES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="מצב">
            <select value={newRow.is_handled ? "1" : "0"} onChange={(e) => setNewRow({ ...newRow, is_handled: e.target.value === "1" })} className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm">
              <option value="0">ממתין לטיפול</option>
              <option value="1">טופל</option>
            </select>
          </Field>
          <Field label="חובה/אופציונלי">
            <select value={newRow.is_mandatory ? "1" : "0"} onChange={(e) => setNewRow({ ...newRow, is_mandatory: e.target.value === "1" })} className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm">
              <option value="1">חובה (שורה ראשית)</option>
              <option value="0">אופציונלי (שורה נפרדת)</option>
            </select>
          </Field>
          <Field label="סיבה בשינוי">
            <select value={newRow.requires_reason ? "1" : "0"} onChange={(e) => setNewRow({ ...newRow, requires_reason: e.target.value === "1" })} className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm">
              <option value="1">חייב סיבה</option>
              <option value="0">ללא סיבה</option>
            </select>
          </Field>
          <Field label="הודעה קולית">
            <select value={newRow.enables_voice_message ? "1" : "0"} onChange={(e) => setNewRow({ ...newRow, enables_voice_message: e.target.value === "1" })} className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm">
              <option value="0">כבוי</option>
              <option value="1">פעיל</option>
            </select>
          </Field>
          <Field label="מספר הודעה">
            <input inputMode="numeric" pattern="[0-9]*" value={newRow.voice_message_template} onChange={(e) => setNewRow({ ...newRow, voice_message_template: e.target.value.replace(/\D/g, "") })} placeholder="1 / 2 / 3" className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
          </Field>
          <Field label="אופן שליחה">
            <select value={newRow.voice_send_mode} onChange={(e) => setNewRow({ ...newRow, voice_send_mode: e.target.value as "manual" | "auto" })} className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm">
              <option value="manual">ידני</option>
              <option value="auto">אוטומטי</option>
            </select>
          </Field>
          <button onClick={() => upsertMut.mutate({ data: { ...newRow, is_custom: true } })} className="px-3 py-2 bg-primary text-primary-foreground rounded-md text-sm">הוסף</button>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl divide-y divide-border">
        {sorted.map((r: any, idx: number) => (
          <StatusEditRow key={r.status_key} row={r} index={idx} total={sorted.length} agents={(agents ?? []) as any[]}
            onMove={(delta) => move(idx, delta)}
            onSave={(patch) => upsertMut.mutate({ data: { status_key: r.status_key, ...patch, is_custom: r.is_custom } })}
            onDelete={() => { if (confirm("למחוק סטטוס זה?")) delMut.mutate({ data: { status_key: r.status_key } }); }}
          />
        ))}
      </div>
    </div>
  );
}

function StatusEditRow({ row, index, total, agents, onMove, onSave, onDelete }: { row: any; index: number; total: number; agents: any[]; onMove: (delta: number) => void; onSave: (p: { label: string; tone: string; is_handled: boolean; is_mandatory: boolean; requires_reason: boolean; assigned_agent_ids: string[]; enables_voice_message: boolean; voice_message_template: string; voice_send_mode: "manual" | "auto"; auto_send_start_hour: number; auto_send_end_hour: number }) => void; onDelete?: () => void }) {
  const [label, setLabel] = useState(row.label);
  const [tone, setTone] = useState(row.tone);
  const [handled, setHandled] = useState<boolean>(!!row.is_handled);
  const [mandatory, setMandatory] = useState<boolean>(row.is_mandatory ?? true);
  const [requiresReason, setRequiresReason] = useState<boolean>(row.requires_reason ?? true);
  const [agentIds, setAgentIds] = useState<string[]>(row.assigned_agent_ids ?? []);
  const [enablesVoice, setEnablesVoice] = useState<boolean>(!!row.enables_voice_message);
  const [voiceTemplate, setVoiceTemplate] = useState<string>(row.voice_message_template ?? "");
  const [voiceSendMode, setVoiceSendMode] = useState<"manual" | "auto">(row.voice_send_mode === "auto" ? "auto" : "manual");
  const [autoStartHour, setAutoStartHour] = useState<number>(Number.isFinite(row.auto_send_start_hour) ? row.auto_send_start_hour : 8);
  const [autoEndHour, setAutoEndHour] = useState<number>(Number.isFinite(row.auto_send_end_hour) ? row.auto_send_end_hour : 20);
  const initialIds = (row.assigned_agent_ids ?? []) as string[];
  const idsDirty = agentIds.length !== initialIds.length || agentIds.some((x) => !initialIds.includes(x));
  const dirty = label !== row.label || tone !== row.tone || handled !== !!row.is_handled || mandatory !== (row.is_mandatory ?? true) || requiresReason !== (row.requires_reason ?? true) || idsDirty
    || enablesVoice !== !!row.enables_voice_message || voiceTemplate !== (row.voice_message_template ?? "")
    || voiceSendMode !== (row.voice_send_mode === "auto" ? "auto" : "manual")
    || autoStartHour !== (Number.isFinite(row.auto_send_start_hour) ? row.auto_send_start_hour : 8)
    || autoEndHour !== (Number.isFinite(row.auto_send_end_hour) ? row.auto_send_end_hour : 20);
  const toggleAgent = (id: string) => setAgentIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  return (
    <div className="p-3 flex flex-col gap-3">
      {/* Top row: order + label + save/delete — always visible without scroll */}
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-sm font-mono w-6 text-center text-muted-foreground">{index + 1}</span>
          <div className="flex flex-col gap-0.5">
            <button onClick={() => onMove(-1)} disabled={index === 0} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed"><ArrowUp className="h-4 w-4" /></button>
            <button onClick={() => onMove(1)} disabled={index === total - 1} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed"><ArrowDown className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="flex-1 min-w-[240px]">
          <div className="flex items-center gap-2">
            <span className={`text-xs rounded-full px-2 py-0.5 font-medium shrink-0 ${toneClasses(tone)}`}>{(label || row.status_key).slice(0,2)}</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)}
              placeholder="שם הסטטוס"
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium" />
          </div>
          <div className="text-[10px] font-mono text-muted-foreground mt-1 pr-1">{row.status_key}{row.is_custom && " · מותאם"}</div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button disabled={!dirty} onClick={() => onSave({ label, tone, is_handled: handled, is_mandatory: mandatory, requires_reason: requiresReason, assigned_agent_ids: agentIds, enables_voice_message: enablesVoice, voice_message_template: voiceTemplate.trim(), voice_send_mode: voiceSendMode, auto_send_start_hour: autoStartHour, auto_send_end_hour: autoEndHour })}
            className="px-3 py-2 text-xs bg-primary text-primary-foreground rounded disabled:opacity-30 font-medium">שמור</button>
          {onDelete && (
            <button onClick={onDelete} title="מחק סטטוס" className="text-destructive hover:bg-destructive/10 rounded p-2"><Trash2 className="h-4 w-4" /></button>
          )}
        </div>
      </div>

      {/* Attributes grid — wraps naturally on narrow screens */}
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
        <Field label="צבע">
          <select value={tone} onChange={(e) => setTone(e.target.value)} className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm">
            {AVAILABLE_TONES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="מצב">
          <select value={handled ? "1" : "0"} onChange={(e) => setHandled(e.target.value === "1")} className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm">
            <option value="0">ממתין</option>
            <option value="1">טופל</option>
          </select>
        </Field>
        <Field label="שורה">
          <select value={mandatory ? "1" : "0"} onChange={(e) => setMandatory(e.target.value === "1")} className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm">
            <option value="1">חובה</option>
            <option value="0">אופציונלי</option>
          </select>
        </Field>
        <Field label="סיבה בשינוי">
          <select value={requiresReason ? "1" : "0"} onChange={(e) => setRequiresReason(e.target.value === "1")} className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm">
            <option value="1">חייב סיבה</option>
            <option value="0">ללא סיבה</option>
          </select>
        </Field>
      </div>

      {/* Agents + voice — side by side on desktop, stacked on mobile */}
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <div className="text-[11px] text-muted-foreground mb-1">שיוך אוטומטי לנציג</div>
          <div className="flex flex-wrap gap-1">
            {agents.map((a) => {
              const active = agentIds.includes(a.id);
              return (
                <button key={a.id} type="button" onClick={() => toggleAgent(a.id)}
                  className={`text-[11px] px-2 py-0.5 rounded-full border ${active ? "bg-primary text-primary-foreground border-primary" : "bg-background border-input text-muted-foreground hover:bg-accent"}`}>
                  {a.display_name}
                </button>
              );
            })}
            {agents.length === 0 && <span className="text-xs text-muted-foreground">אין נציגים</span>}
          </div>
        </div>
        <div>
          <label className="flex items-center gap-1.5 text-[11px] mb-1">
            <input type="checkbox" checked={enablesVoice} onChange={(e) => setEnablesVoice(e.target.checked)} />
            מפעיל שליחת הודעה קולית
          </label>
          <div className="flex items-end gap-2 flex-wrap">
            <Field label="מספר הודעה בימות">
              <input inputMode="numeric" pattern="[0-9]*" value={voiceTemplate} onChange={(e) => setVoiceTemplate(e.target.value.replace(/\D/g, ""))}
                placeholder="לדוגמה: 1 / 2 / 3" className="w-36 rounded-md border border-input bg-background px-2 py-1.5 text-sm" disabled={!enablesVoice} />
            </Field>
            <Field label="אופן שליחה">
              <select value={voiceSendMode} onChange={(e) => setVoiceSendMode(e.target.value as "manual" | "auto")}
                disabled={!enablesVoice}
                className="w-32 rounded-md border border-input bg-background px-2 py-1.5 text-sm">
                <option value="manual">ידני (כפתור)</option>
                <option value="auto">אוטומטי</option>
              </select>
            </Field>
          </div>
          {enablesVoice && voiceSendMode === "auto" && (
            <div className="mt-2 flex items-end gap-2 flex-wrap">
              <Field label="שולח משעה">
                <select value={autoStartHour} onChange={(e) => setAutoStartHour(Number(e.target.value))}
                  className="w-24 rounded-md border border-input bg-background px-2 py-1.5 text-sm">
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                  ))}
                </select>
              </Field>
              <Field label="עד שעה">
                <select value={autoEndHour} onChange={(e) => setAutoEndHour(Number(e.target.value))}
                  className="w-24 rounded-md border border-input bg-background px-2 py-1.5 text-sm">
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                  ))}
                </select>
              </Field>
              <div className="rounded-md border border-input bg-muted/30 px-2 py-2 text-[11px] text-muted-foreground leading-tight flex-1 min-w-[180px]">
                מחוץ לשעות אלו ההודעה תמתין בתור ותישלח אוטומטית כשהשעות הבאות יתחילו.
              </div>
            </div>
          )}
          <div className="mt-2 rounded-md border border-input bg-muted/30 px-2 py-2 text-[11px] text-muted-foreground leading-tight">
            המספר משמש לקובץ ‎ivr2:0CRM/files/מספר.wav בשלב ההעתקה.
          </div>
        </div>
      </div>
    </div>
  );
}

// ============= Series Detection =============
function SeriesSettingsPanel() {
  const getFn = useServerFn(getSeriesDetection);
  const setFn = useServerFn(setSeriesDetection);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["series_detection"], queryFn: async () => getFn({ headers: await getAuthHeaders() }) });
  const [modes, setModes] = useState<Array<{ strip: number; min: number }>>([]);
  useEffect(() => { if (data) setModes(data.modes); }, [data]);
  const mut = useMutation({
    mutationFn: async (vars: { data: { modes: Array<{ strip: number; min: number }> } }) => setFn({ ...vars, headers: await getAuthHeaders() } as any),
    onSuccess: () => { toast.success("נשמר"); qc.invalidateQueries({ queryKey: ["series_detection"] }); },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });

  const update = (i: number, patch: Partial<{ strip: number; min: number }>) => {
    const next = [...modes]; next[i] = { ...next[i], ...patch }; setModes(next);
  };
  const remove = (i: number) => setModes(modes.filter((_, idx) => idx !== i));
  const add = () => setModes([...modes, { strip: 2, min: 10 }]);

  return (
    <div className="space-y-3">
      <div className="bg-card border border-border rounded-xl p-5">
        <h2 className="text-lg font-semibold mb-1 flex items-center gap-2"><SearchIcon className="h-4 w-4" />הגדרות "השלמת סדרות"</h2>
        <p className="text-xs text-muted-foreground mb-4">
          כל שורה מגדירה חוק לזיהוי סדרות: "התעלם מ־N ספרות אחרונות" ו"מינימום מספרים דומים כדי להיחשב סדרה".
          לדוגמה: התעלמות מ־2 ספרות אחרונות, מינימום 10 מספרים דומים → תזוהה כסדרה.
        </p>
        <div className="space-y-2">
          {modes.map((m, i) => (
            <div key={i} className="flex items-end gap-2 flex-wrap">
              <Field label="ספרות אחרונות להתעלמות">
                <input type="number" min={1} max={10} value={m.strip} onChange={(e) => update(i, { strip: Number(e.target.value) })}
                  className="w-28 rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
              </Field>
              <Field label="מינימום מספרים בסדרה">
                <input type="number" min={2} max={1000} value={m.min} onChange={(e) => update(i, { min: Number(e.target.value) })}
                  className="w-32 rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
              </Field>
              <button onClick={() => remove(i)} className="text-destructive hover:bg-destructive/10 rounded p-2"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <button onClick={add} className="flex items-center gap-1 text-sm text-primary hover:underline">
            <Plus className="h-3.5 w-3.5" /> הוסף חוק
          </button>
        </div>
        <div className="mt-4">
          <button onClick={() => mut.mutate({ data: { modes } })} disabled={mut.isPending || modes.length === 0}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50">
            {mut.isPending ? "שומר..." : "שמור הגדרות"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============= Permissions =============
function PermissionsPanel({ crmKey }: { crmKey: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listPermissionSettings);
  const roleFn = useServerFn(setRolePermission);
  const userFn = useServerFn(setUserPermission);
  const clearFn = useServerFn(deleteUserPermission);
  const { data, error, isLoading } = useQuery({ queryKey: ["permission_settings", crmKey], queryFn: async () => listFn({ data: { crmKey }, headers: await getAuthHeaders() }) });
  const [selectedUser, setSelectedUser] = useState<string>("");
  const [search, setSearch] = useState("");
  const refresh = () => { qc.invalidateQueries({ queryKey: ["permission_settings", crmKey] }); qc.invalidateQueries({ queryKey: ["me"] }); };
  const roleMut = useMutation({ mutationFn: async (vars: any) => roleFn({ ...vars, headers: await getAuthHeaders() }), onSuccess: () => { toast.success("הרשאת תפקיד עודכנה"); refresh(); }, onError: (e: any) => toast.error(e.message) });
  const userMut = useMutation({ mutationFn: async (vars: any) => userFn({ ...vars, headers: await getAuthHeaders() }), onSuccess: () => { toast.success("הרשאת משתמש עודכנה"); refresh(); }, onError: (e: any) => toast.error(e.message) });
  const clearMut = useMutation({ mutationFn: async (vars: any) => clearFn({ ...vars, headers: await getAuthHeaders() }), onSuccess: () => { toast.success("חריגה הוסרה"); refresh(); }, onError: (e: any) => toast.error(e.message) });

  if (isLoading) return <div className="text-center py-8 text-muted-foreground">טוען הרשאות...</div>;
  if (error) return <AdminError message={error.message} />;

  const roles = (data?.roles ?? []) as string[];
  const permissions = (data?.permissions ?? []) as Array<{ key: string; label: string; description?: string }>;
  const roleRows = (data?.rolePermissions ?? []) as Array<{ role: string; permission: string; allowed: boolean }>;
  const userRows = (data?.userPermissions ?? []) as Array<{ user_id: string; permission: string; allowed: boolean }>;
  const users = ((data?.users ?? []) as any[]).filter((u) => !search.trim() || `${u.display_name} ${u.email}`.toLowerCase().includes(search.trim().toLowerCase()));
  const roleLabel: Record<string, string> = { viewer: "צופה", agent: "נציג", admin: "מנהל", super_admin: "מנהל ראשי" };
  const roleAllowed = (role: string, permission: string) => roleRows.find((r) => r.role === role && r.permission === permission)?.allowed ?? false;
  const userOverride = (userId: string, permission: string) => userRows.find((r) => r.user_id === userId && r.permission === permission)?.allowed;
  const selected = users.find((u) => u.id === selectedUser) ?? (data?.users ?? []).find((u: any) => u.id === selectedUser);

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="p-4 border-b border-border">
          <h2 className="text-lg font-semibold flex items-center gap-2"><LockKeyhole className="h-4 w-4" />הרשאות לפי תפקיד</h2>
          <p className="text-xs text-muted-foreground mt-1">כיבוי/הדלקה כאן משפיע על כל המשתמשים בתפקיד, אלא אם הוגדרה להם חריגה אישית.</p>
        </div>
        <table className="w-full text-sm min-w-[760px]">
          <thead className="bg-muted/50 border-b border-border">
            <tr className="text-right">
              <th className="px-4 py-3 font-medium">הרשאה</th>
              {roles.map((r) => <th key={r} className="px-4 py-3 font-medium text-center">{roleLabel[r] ?? r}</th>)}
            </tr>
          </thead>
          <tbody>
            {permissions.map((p) => (
              <tr key={p.key} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <div className="font-medium">{p.label}</div>
                  <div className="text-xs text-muted-foreground">{p.description}</div>
                </td>
                {roles.map((r) => {
                  const active = roleAllowed(r, p.key);
                  return (
                    <td key={`${r}:${p.key}`} className="px-4 py-3 text-center">
                      <button onClick={() => roleMut.mutate({ data: { crmKey, role: r, permission: p.key, allowed: !active } })}
                        disabled={roleMut.isPending}
                        className={`inline-flex items-center justify-center w-10 h-6 rounded-full border text-xs font-bold ${active ? "bg-emerald-600 text-white border-emerald-600" : "bg-background text-muted-foreground border-input"}`}>
                        {active ? "כן" : "לא"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="p-4 border-b border-border space-y-3">
          <h2 className="text-lg font-semibold">הרשאות לפי משתמש</h2>
          <div className="flex gap-2 flex-wrap">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="חיפוש משתמש..." className="rounded-lg border border-input bg-background px-3 py-2 text-sm" />
            <select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)} className="min-w-64 rounded-lg border border-input bg-background px-3 py-2 text-sm">
              <option value="">בחר משתמש</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.display_name} · {u.email}</option>)}
            </select>
          </div>
          <p className="text-xs text-muted-foreground">"לפי תפקיד" מסיר חריגה אישית. "כן" או "לא" גוברים על הרשאת התפקיד.</p>
        </div>
        {selected ? (
          <table className="w-full text-sm">
            <tbody>
              {permissions.map((p) => {
                const override = userOverride(selected.id, p.key);
                return (
                  <tr key={p.key} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-medium">{p.label}</td>
                    <td className="px-4 py-3 text-left">
                      <select value={override === undefined ? "inherit" : override ? "allow" : "deny"}
                        onChange={(e) => {
                          if (e.target.value === "inherit") clearMut.mutate({ data: { crmKey, user_id: selected.id, permission: p.key } });
                          else userMut.mutate({ data: { crmKey, user_id: selected.id, permission: p.key, allowed: e.target.value === "allow" } });
                        }}
                        className="rounded-md border border-input bg-background px-2 py-1 text-sm">
                        <option value="inherit">לפי תפקיד</option>
                        <option value="allow">כן - חריגה אישית</option>
                        <option value="deny">לא - חריגה אישית</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <div className="p-6 text-sm text-muted-foreground text-center">בחר משתמש כדי להגדיר חריגות אישיות.</div>}
      </div>
    </div>
  );
}

// ============= Shared bits =============
// ============= Email settings (Gmail relay, templates, signature) =============
function EmailSettingsPanel() {
  const qc = useQueryClient();
  const getConfigFn = useServerFn(getEmailRelayConfig);
  const setConfigFn = useServerFn(setEmailRelayConfig);
  const getProfileFn = useServerFn(getMyEmailProfile);
  const setSignatureFn = useServerFn(setMyEmailSignature);
  const listTemplatesFn = useServerFn(listEmailTemplates);
  const upsertTemplateFn = useServerFn(upsertEmailTemplate);
  const deleteTemplateFn = useServerFn(deleteEmailTemplate);

  const { data: config } = useQuery({
    queryKey: ["email_relay_config"],
    queryFn: async () => getConfigFn({ headers: await getAuthHeaders() }),
  });
  const { data: myProfile } = useQuery({
    queryKey: ["my_email_profile"],
    queryFn: async () => getProfileFn({ headers: await getAuthHeaders() }),
  });
  const { data: templates } = useQuery({
    queryKey: ["email_templates"],
    queryFn: async () => listTemplatesFn({ headers: await getAuthHeaders() }),
  });
  const listAgentNamesFn = useServerFn(listAgentEmailNames);
  const setAgentNameFn = useServerFn(setAgentEmailDisplayName);
  const { data: agentNames, error: agentNamesError } = useQuery({
    queryKey: ["agent_email_names"],
    queryFn: async () => listAgentNamesFn({ headers: await getAuthHeaders() }),
    retry: false,
  });
  const [agentNameDrafts, setAgentNameDrafts] = useState<Record<string, string>>({});
  const saveAgentNameMut = useMutation({
    mutationFn: async (v: { user_id: string; email_display_name: string }) => setAgentNameFn({ data: v, headers: await getAuthHeaders() }),
    onSuccess: () => { toast.success("נשמר"); qc.invalidateQueries({ queryKey: ["agent_email_names"] }); },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה בשמירה"),
  });

  const [webAppUrl, setWebAppUrl] = useState("");
  const [address, setAddress] = useState("");
  const [generalName, setGeneralName] = useState("");
  const [secret, setSecret] = useState("");
  useEffect(() => { if (config) { setWebAppUrl(config.url); setAddress(config.address); setGeneralName(config.generalName ?? ""); } }, [config]);

  const saveConfigMut = useMutation({
    mutationFn: async () => setConfigFn({ data: { url: webAppUrl, address, generalName, secret: secret || undefined }, headers: await getAuthHeaders() }),
    onSuccess: () => { toast.success("החיבור נשמר"); setSecret(""); qc.invalidateQueries({ queryKey: ["email_relay_config"] }); },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה בשמירה"),
  });

  const [signature, setSignatureLocal] = useState("");
  const [emailCleanupLevel, setEmailCleanupLevel] = useState<EmailCleanupLevel>("standard");
  useEffect(() => { if (myProfile) setSignatureLocal(myProfile.signature); }, [myProfile]);
  const saveSignatureMut = useMutation({
    mutationFn: async () => setSignatureFn({ data: { signature: cleanEmailContent(signature, emailCleanupLevel) }, headers: await getAuthHeaders() }),
    onSuccess: () => toast.success("החתימה נשמרה"),
    onError: (e: any) => toast.error(e?.message ?? "שגיאה בשמירה"),
  });

  const [editingTemplate, setEditingTemplate] = useState<{ id?: string; name: string; subject: string; body: string } | null>(null);
  const saveTemplateMut = useMutation({
    mutationFn: async (t: { id?: string; name: string; subject: string; body: string }) => upsertTemplateFn({ data: { ...t, body: cleanEmailContent(t.body, emailCleanupLevel) }, headers: await getAuthHeaders() }),
    onSuccess: () => { toast.success("התבנית נשמרה"); setEditingTemplate(null); qc.invalidateQueries({ queryKey: ["email_templates"] }); },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה בשמירה"),
  });
  const deleteTemplateMut = useMutation({
    mutationFn: async (id: string) => deleteTemplateFn({ data: { id }, headers: await getAuthHeaders() }),
    onSuccess: () => { toast.success("התבנית נמחקה"); qc.invalidateQueries({ queryKey: ["email_templates"] }); },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה במחיקה"),
  });

  const configured = !!config?.url && config?.hasSecret;

  return (
    <div className="space-y-6">
      {/* Connection */}
      <div className="bg-card border border-border p-5 rounded-xl shadow-sm space-y-3">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Mail className="h-5 w-5 text-primary" />
          חיבור Gmail (Google Apps Script)
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${configured ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
            {configured ? "מחובר" : "לא מוגדר"}
          </span>
        </h2>
        <p className="text-xs text-muted-foreground">
          כל הנציגים שולחים מאותה תיבת Gmail משותפת; השם שיוצג לפונה נקבע לפי הנציג ששולח, לא לפי כתובת המייל.
          יש להתקין תחילה את קובץ ה-Apps Script (זמין להורדה בריפו תחת <code dir="ltr">apps-script/email-relay.gs</code>) ולפרוס אותו כ-Web App.
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">כתובת Web App (מה-Deploy ב-Apps Script)</label>
            <input value={webAppUrl} onChange={(e) => setWebAppUrl(e.target.value)} dir="ltr" placeholder="https://script.google.com/macros/s/.../exec"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">כתובת תיבת המייל המשותפת</label>
            <input value={address} onChange={(e) => setAddress(e.target.value)} dir="ltr" placeholder="office@example.com"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium mb-1">שם כללי לשליחה (למשל "ועד בני תורה")</label>
            <input value={generalName} onChange={(e) => setGeneralName(e.target.value)} placeholder="ועד בני תורה"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            <p className="text-[11px] text-muted-foreground mt-1">כשמוגדר, כל נציג יוכל לבחור בעת שליחת מייל אם לשלוח בשם האישי שלו או בשם הכללי הזה.</p>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium mb-1">
              סוד משותף {config?.hasSecret && <span className="text-emerald-700">(כבר הוגדר — השאר ריק כדי לא לשנות)</span>}
            </label>
            <input value={secret} onChange={(e) => setSecret(e.target.value)} type="password" dir="ltr"
              placeholder={config?.hasSecret ? "••••••••" : "אותו ערך שיוזן ב-SHARED_SECRET ב-Apps Script"}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          </div>
        </div>
        <button onClick={() => saveConfigMut.mutate()} disabled={saveConfigMut.isPending || !webAppUrl}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50">
          {saveConfigMut.isPending ? "שומר..." : "שמור"}
        </button>
      </div>

      {/* My signature */}
      <div className="bg-card border border-border p-5 rounded-xl shadow-sm space-y-3">
        <h2 className="text-lg font-bold">החתימה האישית שלי</h2>
        <p className="text-xs text-muted-foreground">
          תתווסף אוטומטית לסוף כל מייל שאתה שולח מכרטיס מערכת. שם התצוגה שלך ({myProfile?.displayName || "—"}) נלקח מהפרופיל שלך במערכת.
        </p>
        <EmailContentEditor value={signature} onChange={setSignatureLocal} rows={4}
          placeholder={"בברכה,\nשם הנציג\nועד בני תורה"} label="חתימה"
          cleanupLevel={emailCleanupLevel} onCleanupLevelChange={setEmailCleanupLevel} />
        <button onClick={() => saveSignatureMut.mutate()} disabled={saveSignatureMut.isPending}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50">
          {saveSignatureMut.isPending ? "שומר..." : "שמור חתימה"}
        </button>
      </div>

      {/* Per-agent email display name (admin override) */}
      {!agentNamesError && (
        <div className="bg-card border border-border p-5 rounded-xl shadow-sm space-y-3">
          <h2 className="text-lg font-bold">שם תצוגה למייל לכל נציג</h2>
          <p className="text-xs text-muted-foreground">
            קובע איזה שם יופיע לפונה כשולח, לכל נציג בנפרד - בלי קשר לשם התצוגה הרגיל שלו במערכת. אם לא מוגדר, ישתמש בשם התצוגה הרגיל.
          </p>
          <div className="space-y-2">
            {(agentNames ?? []).map((a) => {
              const draft = agentNameDrafts[a.id] ?? a.email_display_name ?? "";
              return (
                <div key={a.id} className="flex items-center gap-3">
                  <span className="text-sm w-40 shrink-0 truncate text-muted-foreground">{a.display_name}</span>
                  <input value={draft}
                    onChange={(e) => setAgentNameDrafts((d) => ({ ...d, [a.id]: e.target.value }))}
                    placeholder={a.display_name}
                    className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm" />
                  <button
                    onClick={() => saveAgentNameMut.mutate({ user_id: a.id, email_display_name: draft })}
                    disabled={saveAgentNameMut.isPending}
                    className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-accent disabled:opacity-50 shrink-0">
                    שמור
                  </button>
                </div>
              );
            })}
            {(agentNames ?? []).length === 0 && <p className="text-sm text-muted-foreground italic">אין נציגים להצגה.</p>}
          </div>
        </div>
      )}

      {/* Templates */}
      <div className="bg-card border border-border p-5 rounded-xl shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">תבניות מייל מוכנות</h2>
          <button onClick={() => setEditingTemplate({ name: "", subject: "", body: "" })}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-accent">
            <Plus className="h-3.5 w-3.5" />תבנית חדשה
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          ניתן להשתמש בשדות <code dir="ltr">{"{{system_code}}"}</code>, <code dir="ltr">{"{{system_name}}"}</code>, <code dir="ltr">{"{{caller_phone}}"}</code>, <code dir="ltr">{"{{agent_name}}"}</code> - ימולאו אוטומטית בעת השליחה מכרטיס מערכת.
        </p>
        <div className="space-y-2">
          {(templates ?? []).length === 0 && <p className="text-sm text-muted-foreground italic">אין עדיין תבניות.</p>}
          {(templates ?? []).map((t: any) => (
            <div key={t.id} className="flex items-center justify-between gap-3 border border-border rounded-lg px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium">{t.name}</div>
                <div className="text-xs text-muted-foreground truncate">{t.subject}</div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => setEditingTemplate(t)} className="p-1.5 rounded hover:bg-accent text-muted-foreground"><Pencil className="h-3.5 w-3.5" /></button>
                <button onClick={() => { if (window.confirm("למחוק תבנית זו?")) deleteTemplateMut.mutate(t.id); }} className="p-1.5 rounded hover:bg-accent text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
        {editingTemplate && (
          <div className="border border-border rounded-lg p-3 space-y-2 bg-muted/20">
            <input value={editingTemplate.name} onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
              placeholder="שם התבנית" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            <input value={editingTemplate.subject} onChange={(e) => setEditingTemplate({ ...editingTemplate, subject: e.target.value })}
              placeholder="נושא" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            <EmailContentEditor value={editingTemplate.body}
              onChange={(body) => setEditingTemplate({ ...editingTemplate, body })}
              rows={5} cleanupLevel={emailCleanupLevel} onCleanupLevelChange={setEmailCleanupLevel} />
            <div className="flex items-center gap-2">
              <button onClick={() => saveTemplateMut.mutate(editingTemplate)} disabled={saveTemplateMut.isPending || !editingTemplate.name}
                className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50">
                שמור תבנית
              </button>
              <button onClick={() => setEditingTemplate(null)} className="px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-accent">ביטול</button>
            </div>
          </div>
        )}
      </div>
    </div>
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

const ROLE_LABELS: Record<string, string> = {
  super_admin: "סופר-אדמין",
  admin: "אדמין",
  agent: "נציג",
  viewer: "צופה",
};

function NotificationsPanel({ crms = [] }: { crms?: CrmSummary[] }) {
  const listFn = useServerFn(listRoleNotificationDefaults);
  const upFn = useServerFn(updateRoleNotificationDefault);
  const qc = useQueryClient();
  const [scope, setScope] = useState<string>("yemot");

  const { data, isLoading } = useQuery({
    queryKey: ["notif_role_defaults", scope],
    queryFn: async () => listFn({ data: { crmKey: scope }, headers: await getAuthHeaders() }),
  });

  const mut = useMutation({
    mutationFn: (v: { role: string; event_key: string; enabled: boolean }) => upFn({ data: v as any }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notif_role_defaults"] });
      qc.invalidateQueries({ queryKey: ["my_notification_prefs"] });
      toast.success("עודכן");
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה בעדכון"),
  });

  const scopeTabs = crms.length ? crms : [{ key: "yemot", name: "ימות המשיח", color: "#2563eb" } as any];

  return (
    <div className="border rounded-xl bg-card p-6 shadow-soft space-y-4">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2"><BellRing className="h-4 w-4" />הגדרת פעמון התראות</h2>
        <p className="text-sm text-muted-foreground mt-1">
          בחר אילו סוגי התראות יופיעו בפעמון לכל תפקיד, בכל אחת ממערכות ה-CRM. נציגים יכולים לדרוס את ברירת המחדל מההגדרות האישיות שלהם.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {scopeTabs.map((c: any) => (
          <button
            key={c.key}
            onClick={() => setScope(c.key)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition ${
              scope === c.key ? "border-primary bg-accent font-medium" : "border-border hover:bg-accent/50"
            }`}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
            {c.name}
          </button>
        ))}
      </div>

      {isLoading || !data ? <div className="text-muted-foreground text-sm">טוען...</div> : <NotificationsGrid data={data} mut={mut} />}
    </div>
  );
}

function NotificationsGrid({ data, mut }: { data: any; mut: any }) {
  const { grid, events, roles } = data as any;
  const cellFor = (role: string, key: string) =>
    (grid as any[]).find((g) => g.role === role && g.event_key === key)?.enabled ?? true;

  return (
    <>


      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-right py-2 px-3 font-medium">אירוע</th>
              {(roles as string[]).map((role) => (
                <th key={role} className="text-center py-2 px-3 font-medium">{ROLE_LABELS[role] ?? role}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(events as any[]).map((ev) => (
              <tr key={ev.key} className="border-b last:border-0 hover:bg-accent/40">
                <td className="py-2 px-3">
                  <div className="font-medium">{ev.label}</div>
                  <div className="text-xs text-muted-foreground">{ev.description}</div>
                </td>
                {(roles as string[]).map((role) => {
                  const enabled = cellFor(role, ev.key);
                  return (
                    <td key={role} className="text-center py-2 px-3">
                      <input
                        type="checkbox"
                        checked={!!enabled}
                        disabled={mut.isPending}
                        onChange={(e) => mut.mutate({ role, event_key: ev.key, enabled: e.target.checked })}
                        className="h-4 w-4 cursor-pointer accent-primary"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

