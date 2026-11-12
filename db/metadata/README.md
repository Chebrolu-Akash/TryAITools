# Tool metadata: pricing models and functional tags

Pricing classification for all 2,235 tools and functional tags from the fixed vocabulary in `src/lib/tags.ts`.
Rules: [../pricing/RULES.md](../pricing/RULES.md).

## Files

| File | What it is |
|---|---|
| `metadata-review.xlsx` / `.csv` | One row per tool: pricing model, status, basis, pricing page, checked date, evidence, notes, tags, tag basis. |
| `enrichment.json`, `summary.json` | The same data as JSON, and the totals. |
| `research/` | Cached research per product URL (includes the captured page text, so the classifier can re-run without refetching). |
| `batches/batch-NN.json`, `progress.json`, `run.log` | Per-batch results (100 tools each) and resume state. |
| `metadata-import-1.sql` | First import: tags for all tools, pricing for 623 tools. |
| `metadata-import-2.sql` | Second import after the robots.txt matcher fix: pricing for 158 more tools (no tag changes). |
| `*.rollback.sql` | Undo each import. Run **import-2 rollback first, then import-1 rollback**. Each line only matches the exact values its import wrote, so later admin edits are never reverted. |

## Re-running

```bash
node scripts/metadata/research.mjs --snapshot <preview-export.sql>   # resumable; cached URLs are not refetched
node scripts/metadata/build.mjs --snapshot <preview-export.sql>      # merge, tags, report, import + rollback SQL
node scripts/metadata/report-xlsx.mjs                                # XLSX from enrichment.json
```

Pricing precedence: values already in the database (owner-verified) > manual research (`db/pricing/batch-01-research.json`)
> automated research with status `verified`. Unknown and failed rows are not imported: they keep no badge (Pending Review).
