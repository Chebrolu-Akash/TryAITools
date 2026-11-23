# Cloudflare: HTTPS and www → root redirects (instructions only; nothing was changed)

## Current behaviour (read-only checks, 2026-11-12)

| Request | Today | Should be |
|---|---|---|
| `http://tryaitools.io/` and `http://tryaitools.io/tools/chatgpt` | **200** (served over HTTP) | 301 → `https://tryaitools.io/…` |
| `https://www.tryaitools.io/` | **403 Forbidden** (from Cloudflare) | 301 → `https://tryaitools.io/` |
| `https://tryaitools.io/tools/chatgpt/` | 301 → `/tools/chatgpt` | correct, keep |

**Why www fails.** `www.tryaitools.io` already resolves to Cloudflare (proxied, the same addresses as the root domain).
However, the production Worker is attached only to `tryaitools.io`, so Cloudflare has nothing to serve for `www`. **No DNS
change is needed.** A redirect rule is enough.

## Steps (Cloudflare dashboard → the `tryaitools.io` zone)

### 1. Always use HTTPS
**SSL/TLS → Edge Certificates → Always Use HTTPS → On.**

Cloudflare then answers every `http://` request with a 301 to the same URL on `https://`, before the Worker runs.
Check that **SSL/TLS → Overview** is "Full" or "Full (strict)". With a Workers custom domain it is normally already correct.

### 2. Redirect www to the root domain
**Rules → Redirect Rules → Create rule** (or "Single Redirects"):

- **Name:** `www to root`
- **When incoming requests match:** Custom filter expression → Field `Hostname`, operator `equals`, value `www.tryaitools.io`
  - Expression: `(http.host eq "www.tryaitools.io")`
- **Then:**
  - Type: **Dynamic**
  - Expression: `concat("https://tryaitools.io", http.request.uri.path)`
  - Status code: **301**
  - **Preserve query string:** on
- Deploy.

### 3. Don't do yet
- **HSTS** (SSL/TLS → Edge Certificates → HTTP Strict Transport Security). It is hard to undo, because browsers cache it.
  Enable it only after HTTPS and www have run cleanly for a while, starting with a short max-age.
- Don't add `www` to the Worker as a second custom domain. That would serve duplicate pages instead of redirecting.

## Check afterwards (read-only; I can run these for you)

```bash
curl -sI http://tryaitools.io/tools/chatgpt
```

```bash
curl -sI "https://www.tryaitools.io/tools/chatgpt?x=1"
```

**Expected results:**
- The first returns `301` with `Location: https://tryaitools.io/tools/chatgpt`.
- The second returns `301` with `Location: https://tryaitools.io/tools/chatgpt?x=1`.
- `https://tryaitools.io/sitemap.xml` and `/robots.txt` still return 200.
- Each request takes exactly one redirect, with no chains.

**Rollback:** turn off "Always Use HTTPS" and disable the redirect rule. Both take effect immediately.
