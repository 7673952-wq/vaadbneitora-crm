import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSystem, listAgents, updateSystem, addNote, deleteSystem, addSubSystem } from "@/lib/systems.functions";
import { getMyRole } from "@/lib/admin.functions";
import { STATUS_OPTIONS, STATUS_LABEL, STATUS_TONE, toneClasses, type SystemStatus } from "@/lib/status";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight, History, MessageSquare, Trash2, Send, Plus, Network } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/systems/$id")({
  head: () => ({ meta: [{ title: "מערכת | CRM" }] }),
  component: SystemDetail,
});

function SystemDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const getFn = useServerFn(getSystem);
  const agentsFn = useServerFn(listAgents);
  const updateFn = useServerFn(updateSystem);
  const noteFn = useServerFn(addNote);
  const deleteFn = useServerFn(deleteSystem);
  const meFn = useServerFn(getMyRole);

  const { data, isLoading } = useQuery({ queryKey: ["system", id], queryFn: () => getFn({ data: { id } }) });
  const { data: agents } = useQuery({ queryKey: ["agents"], queryFn: () => agentsFn() });
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => meFn() });
  const [noteText, setNoteText] = useState("");

  const updateMut = useMutation({
    mutationFn: updateFn,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["system", id] }); toast.success("עודכן"); },
    onError: (e: any) => toast.error(e.message),
  });
  const noteMut = useMutation({
    mutationFn: noteFn,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["system", id] }); setNoteText(""); toast.success("ההערה נוספה"); },
    onError: (e: any) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: deleteFn,
    onSuccess: () => { toast.success("נמחק"); navigate({ to: "/dashboard" }); },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !data) return <div className="text-center py-20 text-muted-foreground">טוען...</div>;
  const s = data.system;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowRight className="h-4 w-4" />חזרה לדשבורד
      </Link>

      <div className="bg-card border border-border rounded-2xl p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs font-mono text-muted-foreground">{s.system_code}</div>
            <h1 className="text-3xl font-bold tracking-tight mt-1">{s.name}</h1>
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              <span className={`text-xs rounded-full px-3 py-1 font-medium ${toneClasses(STATUS_TONE[s.status as SystemStatus])}`}>
                {STATUS_LABEL[s.status as SystemStatus]}
              </span>
              <span className="text-sm text-muted-foreground">נציג: <span className="font-medium text-foreground">{s.agent_name || "לא משויך"}</span></span>
            </div>
          </div>
          {me?.isAdmin && (
            <button onClick={() => { if (confirm("למחוק מערכת זו?")) deleteMut.mutate({ data: { id } }); }}
              className="flex items-center gap-2 px-3 py-2 text-sm text-destructive border border-destructive/30 rounded-lg hover:bg-destructive/10">
              <Trash2 className="h-4 w-4" />מחק
            </button>
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-4 mt-6 pt-6 border-t border-border">
          <div>
            <label className="text-sm font-medium block mb-2">סטטוס</label>
            <select value={s.status} onChange={(e) => updateMut.mutate({ data: { id, status: e.target.value } })}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium block mb-2">נציג מטפל</label>
            <select value={s.assigned_agent_id || ""} onChange={(e) => updateMut.mutate({ data: { id, assigned_agent_id: e.target.value || null } })}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
              <option value="">— לא משויך —</option>
              {(agents ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.display_name}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-2xl p-6">
          <h2 className="font-semibold flex items-center gap-2 mb-4"><MessageSquare className="h-4 w-4" />הערות ({data.notes.length})</h2>
          <form onSubmit={(e) => { e.preventDefault(); if (noteText.trim()) noteMut.mutate({ data: { system_id: id, body: noteText.trim() } }); }}
            className="flex gap-2 mb-4">
            <input value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="הוסף הערה..."
              className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm" />
            <button type="submit" className="px-3 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
              <Send className="h-4 w-4" />
            </button>
          </form>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {data.notes.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">אין הערות עדיין</p>}
            {data.notes.map((n: any) => (
              <div key={n.id} className="border border-border rounded-lg p-3 bg-background">
                <div className="text-sm">{n.body}</div>
                <div className="text-xs text-muted-foreground mt-2 flex justify-between">
                  <span>{n.author_name}</span>
                  <span>{new Date(n.created_at).toLocaleString("he-IL")}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6">
          <h2 className="font-semibold flex items-center gap-2 mb-4"><History className="h-4 w-4" />היסטוריית העברות ({data.transfers.length})</h2>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {data.transfers.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">אין העברות</p>}
            {data.transfers.map((t: any) => (
              <div key={t.id} className="border-r-2 border-primary pr-3">
                <div className="text-sm">
                  <span className="text-muted-foreground">{t.from_name}</span>
                  <span className="mx-2">→</span>
                  <span className="font-medium">{t.to_name}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  ע"י {t.by_name} · {new Date(t.created_at).toLocaleString("he-IL")}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
