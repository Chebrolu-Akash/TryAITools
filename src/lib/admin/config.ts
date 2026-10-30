// Cloudflare Access + owner allowlist configuration, read from Worker secrets/vars.
// Everything is required: if any value is missing or malformed the admin FAILS CLOSED (503).
// No value has a default, and none is ever logged or returned to the browser.

export type AdminConfig = {
  issuer: string; // https://<team>.cloudflareaccess.com
  jwksUrl: string;
  audiences: string[]; // Access application AUD tag(s)
  owners: string[]; // lower-cased owner emails
};

export type ConfigResult = { ok: true; config: AdminConfig } | { ok: false; missing: string[] };

const TEAM = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/;
const AUD = /^[A-Za-z0-9]{16,128}$/;
const EMAIL = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/;

const list = (v: unknown) =>
  typeof v === "string"
    ? v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

/** Lower-cased OWNER_EMAILS, or null if the value is missing or contains anything that is not an email. */
export function readOwners(env: Record<string, unknown>): string[] | null {
  const owners = list(env.OWNER_EMAILS).map((e) => e.toLowerCase());
  return owners.length > 0 && owners.every((e) => EMAIL.test(e)) ? owners : null;
}

export function readAdminConfig(env: Record<string, unknown>): ConfigResult {
  const missing: string[] = [];

  let team =
    typeof env.ACCESS_TEAM_DOMAIN === "string" ? env.ACCESS_TEAM_DOMAIN.trim().toLowerCase() : "";
  team = team.replace(/^https:\/\//, "").replace(/\/+$/, "");
  if (!TEAM.test(team)) missing.push("ACCESS_TEAM_DOMAIN");

  const audiences = list(env.ACCESS_AUD);
  if (audiences.length === 0 || !audiences.every((a) => AUD.test(a))) missing.push("ACCESS_AUD");

  const owners = readOwners(env);
  if (!owners) missing.push("OWNER_EMAILS");

  if (missing.length || !owners) return { ok: false, missing };
  return {
    ok: true,
    config: {
      issuer: `https://${team}`,
      jwksUrl: `https://${team}/cdn-cgi/access/certs`,
      audiences,
      owners,
    },
  };
}
