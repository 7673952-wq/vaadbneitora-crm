// Extracted from the dashboard so the header's "מערכת חדשה" button does not
// pull the whole dashboard route into the initial bundle.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CornerUpRight } from "lucide-react";
import {
  createSystem, findSystemByName, findSystemByCode,
  findSystemsByCallerPhone, addSubSystem, ensureCategoryRoot,
} from "@/lib/systems.functions";

export type CreateInitial = {
  system_code?: string;
  name?: string;
  parent_id?: string;
  parent?: { id: string; system_code: string; name: string };
  createMode?: "root" | "sub";
};

export function YemotCreateModal({ initial, onClose, agents: _agents, statusOptions, onDone }: { initial?: CreateInitial; onClose: () => void; agents: any[]; statusOptions: any[]; onDone: () => void }) {
  const [form, setForm] = useState({ system_code: initial?.system_code ?? "", name: initial?.name ?? "", status: "", assigned_agent_id: "", notes: "", phone: "", caller_phone: "", source: "", email: "", is_blocking_number: false });
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [matchedParent, setMatchedParent] = useState<any | null>(initial?.parent ?? null);
  const [matchedParentOptions, setMatchedParentOptions] = useState<any[]>(initial?.parent ? [initial.parent] : []);
  // When a duplicate name is detected the user must choose: create a sub-system
  // under the matched parent, or open a new root with the same name.
  const [createMode, setCreateMode] = useState<"sub" | "root">(initial?.createMode ?? (initial?.parent_id ? "sub" : "root"));
  const [busy, setBusy] = useState(false);
  const findFn = useServerFn(findSystemByName);
  const createFn = useServerFn(createSystem);
  const subFn = useServerFn(addSubSystem);
  const ensureCategoryRootFn = useServerFn(ensureCategoryRoot);
  const navigate = useNavigate();

  // Duplicate system-code (מזהה מערכת) detection: when the typed code
  // exactly matches an existing system, block creation and offer to open
  // that system's card instead — same behavior as "בדיקה מהירה".
  const codeFn = useServerFn(findSystemByCode);
  const [existingByCode, setExistingByCode] = useState<any | null>(null);
  useEffect(() => {
    const raw = form.system_code.trim();
    if (raw.length < 2) { setExistingByCode(null); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const rows = await codeFn({ data: { code: raw } });
        if (cancelled) return;
        const exact = (rows ?? []).find((r: any) => r.system_code === raw);
        setExistingByCode(exact ?? null);
      } catch { /* ignore */ }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [form.system_code, codeFn]);

  // Caller-phone lookup: while typing, list other systems that already have
  // this caller (primary, dial phone, or an additional caller number).
  const callerLookupFn = useServerFn(findSystemsByCallerPhone);
  const [callerMatches, setCallerMatches] = useState<any[]>([]);
  useEffect(() => {
    const digits = form.caller_phone.replace(/\D/g, "");
    if (digits.length < 6) { setCallerMatches([]); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const rows = await callerLookupFn({ data: { phone: form.caller_phone } });
        if (!cancelled) setCallerMatches(rows ?? []);
      } catch { if (!cancelled) setCallerMatches([]); }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [form.caller_phone, callerLookupFn]);
  // Names that must ALWAYS present the "open as sub / open as new root" choice,
  // even when no matching root exists yet in the DB. If sub is chosen the root
  // is created on-the-fly by ensureCategoryRoot before the sub is attached.
  const CATEGORY_NAMES = ["קו ההגנה"];
  const normalizeName = (s: string) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const isCategoryName = (s: string) => CATEGORY_NAMES.some((c) => normalizeName(c) === normalizeName(s));
  const VIRTUAL_PARENT_ID = "__virtual_category_root__";

  useEffect(() => {
    const v = form.name.trim();
    if (v.length < 2) { setSuggestions([]); setMatchedParent(null); setMatchedParentOptions([]); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const rows = await findFn({ data: { name: v } });
        if (cancelled) return;
        setSuggestions(rows ?? []);
        const norm = (s: string) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
        const target = norm(v);
        const exactMatches = (rows ?? []).filter((r: any) => norm(r.name) === target);
        // Parent options: always resolve to the TRUE ROOT system so the new
        // sub-system is attached directly to the root, never to a sub-of-sub.
        // Walk up using both the row and its embedded parent (findSystemByName
        // embeds one level) plus any other rows returned by the search.
        const isValidParent = (p: any) =>
          !!p && typeof p.id === "string" && p.id.trim()
            && typeof p.name === "string" && p.name.trim();
        const byId = new Map<string, any>();
        for (const r of (rows ?? [])) {
          byId.set(r.id, r);
          if (r.parent && r.parent.id) byId.set(r.parent.id, r.parent);
        }
        const resolveRoot = (r: any): any | null => {
          let node = r;
          for (let hop = 0; hop < 10 && node; hop++) {
            if (!node.parent_system_id) return node;
            const next = byId.get(node.parent_system_id) ?? node.parent ?? null;
            if (!next || next.id === node.id) return node;
            node = next;
          }
          return node;
        };
        const optsMap = new Map<string, any>();
        const addOpt = (p: any) => {
          if (!isValidParent(p)) return;
          if (optsMap.has(p.id)) return;
          optsMap.set(p.id, { id: p.id, system_code: p.system_code ?? "", name: p.name });
        };
        for (const r of exactMatches) {
          const root = resolveRoot(r);
          if (root) addOpt(root);
        }
        const opts = Array.from(optsMap.values());
        const initialParent = isValidParent(initial?.parent) ? initial!.parent : null;
        const initialPick = initial?.parent_id
          ? (opts.find((p: any) => p.id === initial.parent_id) ?? initialParent ?? null)
          : (opts[0] ?? null);
        setMatchedParentOptions(initial?.parent_id && initialPick ? [initialPick] : opts);
        setMatchedParent(initialPick);
        setCreateMode((current) => initial?.createMode ?? (initial?.parent_id ? "sub" : (initialPick ? current : "root")));
        // Category-name fallback: even when no root match was found, present the
        // sub/root choice so users can always attach a new sub under the category.
        if (!initialPick && isCategoryName(v)) {
          const virtual = { id: VIRTUAL_PARENT_ID, name: v.trim(), system_code: "" };
          setMatchedParent(virtual);
          setMatchedParentOptions([virtual]);
          setCreateMode((current) => initial?.createMode ?? current);
        }
      } catch { /* ignore */ }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [form.name, findFn, initial?.parent_id, initial?.createMode]);


  const willCreateAsSub = !!matchedParent && createMode === "sub";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.status) { toast.error("יש לבחור סטטוס"); return; }
    if (existingByCode) { toast.error("מזהה מערכת זה כבר קיים במערכת אחרת"); return; }
    setBusy(true);
    try {
      if (willCreateAsSub && matchedParent?.id) {
        let parentId = matchedParent.id;
        if (parentId === VIRTUAL_PARENT_ID) {
          const root = await ensureCategoryRootFn({ data: { name: matchedParent.name } });
          if (!root?.id) throw new Error("לא הצלחתי לוודא את מערכת האב");
          parentId = root.id;
        }

        await subFn({ data: {
          parent_id: parentId,
          system_code: form.system_code,
          name: form.name.trim() || undefined,
          status: form.status,
          notes: form.notes,
          phone: buildDialNumber(form.system_code) || form.phone || undefined,
          source: form.source,
          caller_phone: form.caller_phone,
          email: form.email || undefined,
        } });
        toast.success(`נוספה תת-מערכת למערכת "${matchedParent.name}"`);
      } else {
        await createFn({ data: {
          system_code: form.system_code,
          name: form.name,
          status: form.status,
          assigned_agent_id: form.assigned_agent_id || null,
          notes: form.notes,
          phone: buildDialNumber(form.system_code) || form.phone || undefined,
          source: form.source,
          caller_phone: form.caller_phone,
          email: form.email || undefined,
          is_blocking_number: form.is_blocking_number,
        } });
        toast.success("נוסף בהצלחה");
      }
      onDone();
    } catch (e: any) {
      toast.error(e.message);
    } finally { setBusy(false); }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-hidden" onClick={onClose}>
      <div className="bg-card border border-border rounded-lg max-w-2xl w-full shadow-xl max-h-[calc(100dvh-1rem)] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold px-3 sm:px-4 pt-3 sm:pt-4 pb-2 shrink-0">הוספת מערכת חדשה</h2>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2 flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 sm:px-4 pb-3 sm:pb-4 content-start">
          <div>
            <label className="text-sm font-medium block mb-1">מזהה מערכת (מספר לחיוג)</label>
            <div className="flex items-center gap-2">
              <input required value={form.system_code} onChange={(e) => setForm({ ...form, system_code: e.target.value })}
                className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm" />
              <label className="flex items-center gap-1 text-xs text-muted-foreground shrink-0 whitespace-nowrap" title="בהודעה קולית על סיום הפניה יישלח המספר הפוך וללא קידומת 0">
                <input type="checkbox" checked={form.is_blocking_number}
                  onChange={(e) => setForm({ ...form, is_blocking_number: e.target.checked })} />
                מספר חסימה
              </label>
            </div>
            {!willCreateAsSub && form.is_blocking_number && (
              <p className="text-[11px] text-amber-700 mt-1">
                בשליחת הודעה קולית, המספר שיישלח בהודעה יהיה מספר המערכת הפוך (בלי קידומת 0).
              </p>
            )}
            {existingByCode && (
              <div className="mt-2 border-2 border-red-300 bg-red-50 rounded-lg p-2.5 space-y-2">
                <div className="text-sm text-red-900 font-medium">
                  מזהה מערכת "{existingByCode.system_code}" כבר קיים במערכת:
                </div>
                <div className="text-sm font-semibold text-red-950">{existingByCode.name}</div>
                <button type="button"
                  onClick={() => navigate({ to: "/systems/$id", params: { id: existingByCode.id } })}
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-medium hover:bg-primary/90">
                  פתח כרטיסייה
                </button>
                <p className="text-[11px] text-red-800">לא ניתן לפתוח מערכת חדשה עם מזהה זהה. שנה את מזהה המערכת כדי להמשיך.</p>
              </div>
            )}
          </div>
          <div className="relative">
            <label className="text-sm font-medium block mb-1">שם המערכת</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              autoComplete="off"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
            {suggestions.length > 0 && form.name.trim().length >= 2 && !matchedParent && (
              <div className="absolute z-10 left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {suggestions.map((s: any) => (
                  <button type="button" key={s.id}
                    onClick={() => setForm({ ...form, name: s.name })}
                    className="w-full text-right px-3 py-2 text-sm hover:bg-accent flex items-center justify-between gap-2">
                    <span className="truncate"><span className="font-mono text-xs text-muted-foreground">{s.system_code}</span> · {s.name}</span>
                    {s.parent_system_id && <CornerUpRight className="h-3 w-3 text-amber-600 shrink-0" />}
                  </button>
                ))}
              </div>
            )}
            {matchedParent && (
              <div className="mt-2 text-xs bg-amber-50 border border-amber-300 text-amber-900 rounded-md p-2 space-y-1.5">
                <div className="font-medium">{matchedParent.id === VIRTUAL_PARENT_ID ? `"${matchedParent.name}" היא קטגוריה קיימת. מה לעשות?` : `שם זה כבר קיים כאב-מערכת (${matchedParent.system_code}). מה לעשות?`}</div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="createMode" checked={createMode === "sub"} onChange={() => setCreateMode("sub")} />
                  <span>פתח כתת-מערכת תחת "{matchedParent.name}"</span>
                </label>
                {createMode === "sub" && matchedParentOptions.length > 1 && (
                  <select
                    value={matchedParent.id}
                    onChange={(e) => {
                      const chosen = matchedParentOptions.find((p: any) => p.id === e.target.value);
                      if (chosen) setMatchedParent(chosen);
                    }}
                    className="w-full rounded-md border border-amber-300 bg-white px-2 py-1 text-xs"
                  >
                    {matchedParentOptions.map((p: any) => (
                      <option key={p.id} value={p.id}>{p.system_code} · {p.name}</option>
                    ))}
                  </select>
                )}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="createMode" checked={createMode === "root"} onChange={() => setCreateMode("root")} />
                  <span>פתח אב-מערכת חדשה עם אותו שם</span>
                </label>
              </div>
            )}
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">טלפון לחיוג (אופציונלי)</label>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="נוצר אוטומטית לפי מזהה המערכת"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">טלפון פונה</label>
            <input required value={form.caller_phone} onChange={(e) => setForm({ ...form, caller_phone: e.target.value })}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
            {callerMatches.length > 0 && (
              <div className="mt-1.5 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs">
                <div className="font-semibold text-amber-900 mb-1">
                  המספר קיים כבר ב-{callerMatches.length} מערכות:
                </div>
                <ul className="max-h-40 overflow-y-auto space-y-1">
                  {callerMatches.map((m: any) => (
                    <li key={m.id} className="flex items-center justify-between gap-2">
                      <span className="truncate">
                        <span className="font-mono">{m.system_code}</span>
                        {m.name ? ` · ${m.name}` : ""}
                        {m.agent_name ? ` · ${m.agent_name}` : ""}
                      </span>
                      <a href={`/systems/${m.id}`} target="_blank" rel="noreferrer"
                        className="shrink-0 rounded border border-amber-400 px-1.5 py-0.5 hover:bg-amber-100">
                        פתח
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">מקור</label>
            <select required value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
              <option value="">— בחר מקור —</option>
              {CALLER_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">דוא"ל (אופציונלי)</label>
            <div className="flex gap-1">
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="example@gmail.com"
                className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm" />
              <button type="button" onClick={() => {
                const v = form.email.trim();
                if (!v || v.includes("@")) return;
                setForm({ ...form, email: v + "@gmail.com" });
              }} className="px-2 py-2 text-xs border border-input rounded-lg hover:bg-accent whitespace-nowrap">
                @gmail.com
              </button>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">סטטוס <span className="text-red-600">*</span></label>
            <select required value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
              <option value="">— בחר סטטוס —</option>
              {statusOptions.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div className="text-xs text-muted-foreground bg-muted/40 rounded-md p-2 sm:col-span-2">
            {willCreateAsSub ? "תת־המערכת תיפתח עם הסטטוס שנבחר כאן, בלי לרשת סטטוס מהאב." : "המערכת תיפתח אוטומטית על שמך כנציג המטפל. ניתן לשייך לנציג אחר לאחר הפתיחה."}
          </div>
          <div className="sm:col-span-2">
            <label className="text-sm font-medium block mb-1">הערות</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
          </div>
          <div className="flex gap-2 justify-end pt-2 sm:col-span-2 sticky bottom-0 bg-card border-t border-border py-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-border rounded-lg text-sm hover:bg-accent">ביטול</button>
            <button type="submit" disabled={busy || !!existingByCode} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
              {busy ? "..." : willCreateAsSub ? "הוסף תת-מערכת" : "הוסף"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
