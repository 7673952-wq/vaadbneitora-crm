export type QueueUrls = { voice_queue: string | null; mention_queue: string | null };

export type QueueProbeResult = {
  urlConfigured: boolean;
  tokenConfigured: boolean;
  armed: boolean;
  pending: number;
  reachable: boolean;
  status?: number;
  error?: string;
};

function extractUrl(entry: unknown): string | null {
  if (!entry) return null;
  if (typeof entry === "string") return entry;
  if (typeof entry === "object" && entry !== null && "url" in (entry as any)) {
    const u = (entry as any).url;
    return typeof u === "string" && u ? u : null;
  }
  return null;
}

/** Pure helper: extract queue URLs from get_queue_status() jsonb, tolerating
 * both the real shape { voice: {...}, mention: {...} } and a legacy
 * { queues: { voice_queue: {...}, mention_queue: {...} } } wrapper. */
export function queueUrlsFromStatus(status: unknown): QueueUrls {
  const s = (status ?? {}) as any;
  const legacy = s?.queues;
  const voiceEntry = s?.voice ?? legacy?.voice_queue;
  const mentionEntry = s?.mention ?? legacy?.mention_queue;
  return {
    voice_queue: extractUrl(voiceEntry),
    mention_queue: extractUrl(mentionEntry),
  };
}

/** Pure helper: extract per-queue info (url/token/armed/pending) from the
 * status jsonb, tolerating both shapes. */
export function queueInfoFromStatus(status: unknown, key: "voice_queue" | "mention_queue") {
  const s = (status ?? {}) as any;
  const legacy = s?.queues;
  const entry = key === "voice_queue" ? (s?.voice ?? legacy?.voice_queue) : (s?.mention ?? legacy?.mention_queue);
  const url = extractUrl(entry);
  const obj = typeof entry === "object" && entry !== null ? entry : {};
  return {
    url,
    tokenConfigured: !!(obj as any)?.token_configured,
    armed: !!(obj as any)?.armed,
    pending: Number((obj as any)?.pending ?? 0),
  };
}

/** Pure helper: classify an HTTP probe result (status code or network error)
 * into a Hebrew-facing reachability verdict. */
export function classifyQueueProbe(status?: number, error?: string): { reachable: boolean; error?: string } {
  if (error) return { reachable: false, error: "שגיאת רשת" };
  if (status === 200 || status === 405) return { reachable: true };
  if (status === 401 || status === 403) return { reachable: false, error: "טוקן או הרשאה שגויים" };
  if (status === 404) return { reachable: false, error: "הכתובת לא נמצאה — יש להגדיר מחדש" };
  return { reachable: false, error: `שגיאה (קוד ${status ?? "לא ידוע"})` };
}
