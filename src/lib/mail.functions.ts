import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fromSupabase } from "@/lib/errors";

export type MailContact = {
  address: string;
  lastSubject: string | null;
  lastAt: string;
  count: number;
  unread: boolean;
  systemIds: string[];
};

export type MailMessage = {
  id: string;
  systemId: string | null;
  direction: string;
  subject: string | null;
  body: string;
  fromAddress: string | null;
  toAddress: string | null;
  agentName: string | null;
  createdAt: string;
};

function counterpart(m: any): string | null {
  const addr = m.direction === "in" || m.direction === "inbound" ? m.from_address : m.to_address;
  return addr ? String(addr).trim().toLowerCase() : null;
}

/** Unified mail inbox: one conversation per email address, across all CRMs. */
export const listMailContacts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ search: z.string().max(120).optional() }).parse(input ?? {}))
  .handler(async ({ data, context }): Promise<MailContact[]> => {
    const { data: rows, error } = await context.supabase
      .from("email_messages")
      .select("id, system_id, direction, subject, from_address, to_address, created_at")
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) throw fromSupabase(error);

    const map = new Map<string, MailContact>();
    for (const m of (rows ?? []) as any[]) {
      const addr = counterpart(m);
      if (!addr) continue;
      const existing = map.get(addr);
      if (existing) {
        existing.count += 1;
        if (m.system_id && !existing.systemIds.includes(m.system_id)) existing.systemIds.push(m.system_id);
      } else {
        map.set(addr, {
          address: addr,
          lastSubject: m.subject ?? null,
          lastAt: m.created_at,
          count: 1,
          unread: false,
          systemIds: m.system_id ? [m.system_id] : [],
        });
      }
    }

    const systemIds = [...new Set([...map.values()].flatMap((c) => c.systemIds))];
    if (systemIds.length) {
      const { data: sys } = await context.supabase
        .from("systems")
        .select("id, has_unread_email")
        .in("id", systemIds.slice(0, 500));
      const unreadSet = new Set((sys ?? []).filter((s: any) => s.has_unread_email).map((s: any) => s.id));
      for (const c of map.values()) c.unread = c.systemIds.some((id) => unreadSet.has(id));
    }

    let list = [...map.values()].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
    const q = data.search?.trim().toLowerCase();
    if (q) list = list.filter((c) => c.address.includes(q) || (c.lastSubject ?? "").toLowerCase().includes(q));
    return list.slice(0, 200);
  });

/** All messages exchanged with one email address. */
export const getMailConversation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ address: z.string().trim().min(3).max(200) }).parse(input))
  .handler(async ({ data, context }): Promise<MailMessage[]> => {
    const addr = data.address.toLowerCase();
    const { data: rows, error } = await context.supabase
      .from("email_messages")
      .select("id, system_id, direction, subject, body, from_address, to_address, agent_name, created_at")
      .or(`from_address.ilike.${addr},to_address.ilike.${addr}`)
      .order("created_at", { ascending: true })
      .limit(300);
    if (error) throw fromSupabase(error);
    return (rows ?? []).map((m: any) => ({
      id: m.id,
      systemId: m.system_id ?? null,
      direction: m.direction,
      subject: m.subject ?? null,
      body: m.body ?? "",
      fromAddress: m.from_address ?? null,
      toAddress: m.to_address ?? null,
      agentName: m.agent_name ?? null,
      createdAt: m.created_at,
    }));
  });
