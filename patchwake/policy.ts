import type { Activity } from "./models.js";
import { lookup } from "./json.js";

export interface Candidate {
  readonly priority: number;
  readonly key: string;
  readonly kind: "retry" | "activity" | "bootstrap" | "claim";
}
export function freshActivities(
  activities: readonly Activity[],
  seen: Readonly<Record<string, number>>,
  botIdentities: ReadonlySet<string>,
  requireDirected: boolean,
): Activity[] {
  return activities.filter(
    (event) =>
      !botIdentities.has(event.author) &&
      event.cursor > (lookup(seen, event.stream) ?? 0) &&
      (event.directed !== false || !requireDirected),
  );
}
export function advanceSeen(
  seen: Readonly<Record<string, number>>,
  activities: readonly Activity[],
): Record<string, number> {
  const advanced = Object.assign(
    Object.create(null) as Record<string, number>,
    seen,
  );
  for (const event of activities)
    advanced[event.stream] = Math.max(
      advanced[event.stream] ?? 0,
      event.cursor,
    );
  return { ...advanced };
}
export function activityPrompt(activities: readonly Activity[]): string {
  const groups = new Map<
    string,
    { event: Activity; count: number; cursor: number }
  >();
  for (const event of activities) {
    const key = JSON.stringify([
      event.ref ?? "",
      event.thread ?? "",
      event.author,
      event.kind,
      event.url,
    ]);
    const previous = groups.get(key);
    groups.set(key, {
      event,
      count: (previous?.count ?? 0) + 1,
      cursor: Math.min(previous?.cursor ?? event.cursor, event.cursor),
    });
  }
  const lines = ["New activity is waiting at the source:"];
  for (const { event, count } of [...groups.values()].sort(
    (a, b) => a.cursor - b.cursor,
  )) {
    const where =
      (event.ref || "task") +
      (event.thread ? ` / thread "${event.thread}"` : "");
    lines.push(
      `- ${where}: ${count} ${event.kind} event(s)${event.author ? ` from ${event.author}` : ""}\n  ${event.url}`,
    );
  }
  return [
    ...lines,
    "\nRead the authoritative content there, then act on it.",
  ].join("\n");
}
export function sortCandidates(candidates: readonly Candidate[]): Candidate[] {
  const order = { retry: 0, activity: 1, bootstrap: 2, claim: 2 };
  return [...candidates].sort(
    (a, b) =>
      order[a.kind] - order[b.kind] ||
      a.priority - b.priority ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
}
