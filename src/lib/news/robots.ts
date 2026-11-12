// robots.txt evaluation for the news collector (RFC 9309: longest matching rule wins, Allow wins a tie, * and $ wildcards).
//
// Policy: a feed is fetched only when robots.txt allows it for our user agent (falling back to the "*" group) AND for the
// AI opt-out token a publisher may name to refuse use of its content by Google's AI models ("Google-Extended"),
// because the feed text is sent to Google Gemini to be summarised. A robots.txt that cannot be read (404) allows everything, as the RFC
// says; a server error (5xx) or network failure is treated as "disallowed" for this run.

export const NEWS_USER_AGENT = "TryAITools-NewsBot/1.0 (+https://tryaitools.io/news)";
const AGENT_TOKENS = ["tryaitools-newsbot", "google-extended"];

type Rule = { allow: boolean; pattern: string };
type Group = { agents: string[]; rules: Rule[] };

export function parseRobots(txt: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (current && (key === "allow" || key === "disallow"))
        current.rules.push({ allow: key === "allow", pattern: value });
    }
  }
  return groups;
}

const toRegex = (pattern: string) =>
  new RegExp(
    "^" +
      pattern
        .replace(/[.+?^{}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\\\$$|\$$/, "$"),
  );

function allowedFor(
  groups: Group[],
  agent: string,
  path: string,
  fallbackToStar: boolean,
): boolean {
  let group = groups.filter((g) => g.agents.includes(agent));
  if (group.length === 0 && fallbackToStar) group = groups.filter((g) => g.agents.includes("*"));
  let best: Rule | null = null;
  for (const r of group.flatMap((g) => g.rules)) {
    if (r.pattern === "") continue; // "Disallow:" with no value allows everything
    if (!toRegex(r.pattern).test(path)) continue;
    if (
      !best ||
      r.pattern.length > best.pattern.length ||
      (r.pattern.length === best.pattern.length && r.allow)
    )
      best = r;
  }
  return best ? best.allow : true;
}

/** True when `url` may be fetched under this robots.txt (see the policy above). */
export function robotsAllows(txt: string, url: string): boolean {
  const groups = parseRobots(txt);
  const u = new URL(url);
  const path = u.pathname + u.search;
  // Our own agent follows the "*" group when not named; the AI opt-out agents count only when named explicitly.
  return AGENT_TOKENS.every((agent, i) => allowedFor(groups, agent, path, i === 0));
}
