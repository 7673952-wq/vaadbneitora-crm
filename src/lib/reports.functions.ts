import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuthMfa } from "@/lib/mfa.middleware";

const inputSchema = z.object({
  from: z.string().datetime().nullable().optional(),
  to: z.string().datetime().nullable().optional(),
  status: z.string().max(60).nullable().optional(),
  agent_id: z.string().uuid().nullable().optional(),
});

type Input = z.infer<typeof inputSchema>;

export const getReports = createServerFn({ method: "POST" })
  .middleware([requireAuthMfa])
  .inputValidator((d: Input) => inputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { assertPermission, hasRole } = await import("@/lib/permissions.server");
    await assertPermission(context.userId, "systems_read", "yemot");
    if (!(await hasRole(context.userId, "admin"))) {
      throw new Error("מסכי מנהלים זמינים למנהלים בלבד");
    }
    const sb = context.supabase;

    // All aggregation happens in one SQL roundtrip (reports_summary) instead of
    // pulling every system into the worker and counting in JavaScript.
    const { data: summary, error } = await (sb as any).rpc("reports_summary", {
      _status: data.status ?? null,
      _agent: data.agent_id ?? null,
      _from: data.from ?? null,
      _to: data.to ?? null,
    });
    if (error) throw new Error(error.message);
    const s = (summary ?? {}) as any;
    return {
      byStatus: s.byStatus ?? [],
      byAgent: s.byAgent ?? [],
      bySubsystem: s.bySubsystem ?? [],
      period: s.period ?? { opened: 0, updated: 0, closed: 0 },
    };
  });
