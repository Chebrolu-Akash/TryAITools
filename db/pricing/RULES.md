# Tool pricing: classification rules

Applied to what a tool's **official** pricing page states. Never inferred from the tool's name, reputation or other sites.

| Label | Rule |
|---|---|
| `free` | Everything is free; no paid plan exists. |
| `freemium` | A permanent free plan or tier (including recurring free credits, or free open-source plus a paid hosted version) **and** paid plans. |
| `free_trial` | No permanent free plan, but a time- or usage-limited trial (or one-off credits) before paying. |
| `paid` | No free plan and no self-serve trial (paid only, demo or "contact sales"). |
| Unknown | The page is unclear, contradictory or has no pricing. Stored as empty: no badge. |

## Status of each research row

- `verified`: the quoted evidence clearly supports the label.
- `unknown`: the page was read but does not settle the label.
- `failed`: the page could not be read (blocked, rendered only by JavaScript, unreachable). Automated blocks are never worked around; these need a manual check.

Rows marked `REVIEW` in `notes` are verified but have an edge case worth a second look.

## Review gate

Only rows with `status = verified` **and** `approved = yes` (set by the owner after review) are imported. Prices change: re-check rows whose `verified_at` is older than 90 days.
