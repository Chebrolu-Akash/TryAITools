// Per-isolate cache for small shared public results (site summary, home summary, sitemap, category list, /tools page 1),
// keyed by meta.catalog_version. Admin writes and imports bump that version, so a publish is visible on the next request.
//
// Race safety: every request takes a ticket BEFORE it reads the version, so tickets follow the order versions were seen.
// A load may store its value only if its ticket is newer than the stored entry's and than the last reset; concurrent
// requests for the same key share one in-flight load (or join a load of a version observed after theirs).

let tickets = 0;
let resetFloor = 0;
const entries = new Map<string, { version: string; ticket: number; value: unknown }>();
const inflight = new Map<string, { version: string; ticket: number; promise: Promise<unknown> }>();

export const takeTicket = () => ++tickets;

export function cachedByVersion<T>(
  key: string,
  version: string,
  ticket: number,
  load: () => Promise<T>,
): Promise<T> {
  const hit = entries.get(key);
  if (hit && hit.version === version) return Promise.resolve(hit.value as T);
  const running = inflight.get(key);
  if (running && (running.version === version || running.ticket > ticket))
    return running.promise as Promise<T>;
  const promise = load().then((value) => {
    if (ticket > resetFloor && ticket > (entries.get(key)?.ticket ?? 0))
      entries.set(key, { version, ticket, value });
    return value;
  });
  inflight.set(key, { version, ticket, promise });
  const clear = () => {
    if (inflight.get(key)?.promise === promise) inflight.delete(key);
  };
  void promise.then(clear, clear);
  return promise;
}

/** The last value stored for `key` (any version), used when D1 fails. */
export const lastGood = <T>(key: string): T | undefined => entries.get(key)?.value as T | undefined;

/** Test hook: forget everything. Loads already in flight can no longer store their values. */
export function resetVersionedCache() {
  resetFloor = tickets;
  entries.clear();
  inflight.clear();
}
