# TryAITools

A web app built with TanStack Start, React and Vite.

## Development

```bash
bun install
bun run dev
```

## Deployment

`bun run build` produces a Cloudflare-targeted build (Nitro). Security headers (CSP, HSTS, etc.) are added to every
server response in `src/server.ts` (policy in `src/lib/security-headers.ts`) and to static assets via `public/_headers`.

Before going live, set `CONTACT_EMAIL` in `src/lib/site.ts` to show a contact line on the legal pages, and confirm
`SITE_URL` matches your production domain (used for canonical URLs, Open Graph tags and `public/sitemap.xml`).
