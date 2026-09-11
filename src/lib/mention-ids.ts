// Pure, client-safe helpers that keep the "who gets tagged" decision honest:
// a mention only counts while its `@name` (or `@כולם`) text still appears in
// the note body. IDs — not display names — are the source of truth once a
// pick has been made from the mention list.

export type MentionPick = { id: string; name: string } | { all: true; name?: string };

const ALL_LABEL = "כולם";

function pickName(p: MentionPick): string {
  return "all" in p && p.all ? (p.name ?? ALL_LABEL) : (p as { id: string; name: string }).name;
}

function isAllPick(p: MentionPick): p is { all: true; name?: string } {
  return "all" in p && p.all === true;
}

/** A pick survives only while its `@name` still appears in the text. */
export function mentionsStillInText(body: string, picks: MentionPick[]): MentionPick[] {
  const text = body ?? "";
  return picks.filter((p) => text.includes(`@${pickName(p)}`));
}

/** Reduce a list of picks (already filtered against the text) to the
 * payload shape the server functions expect: deduped user ids + a single
 * "mention everyone" flag. */
export function collectMentionPayload(picks: MentionPick[]): { mentionedUserIds: string[]; mentionAll: boolean } {
  let mentionAll = false;
  const seen = new Set<string>();
  const mentionedUserIds: string[] = [];
  for (const p of picks) {
    if (isAllPick(p)) { mentionAll = true; continue; }
    const id = (p as { id: string }).id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    mentionedUserIds.push(id);
  }
  return { mentionedUserIds, mentionAll };
}

/** Legacy edit path: no chip/pick state is tracked, so mentions are derived
 * straight from the free-text body against the known agent list. Matches
 * longest name first so "דני כהן" wins over "דני". */
export function deriveMentionsFromText(
  body: string,
  agents: Array<{ id: string; name: string }>,
): { mentionedUserIds: string[]; mentionAll: boolean } {
  const text = body ?? "";
  const sorted = [...agents]
    .filter((a) => a.name)
    .sort((a, b) => b.name.length - a.name.length);

  let mentionAll = false;
  const seen = new Set<string>();
  const mentionedUserIds: string[] = [];

  if (text.includes(`@${ALL_LABEL}`)) mentionAll = true;

  for (const a of sorted) {
    if (seen.has(a.id)) continue;
    if (text.includes(`@${a.name}`)) {
      seen.add(a.id);
      mentionedUserIds.push(a.id);
    }
  }

  return { mentionedUserIds, mentionAll };
}
