# Pricing research: batch 1

Generated 2026-10-31T19:45:12Z from the preview database export (no database changes).
Scope: the 27 featured tools and the 72 tools with written content: **31 product URLs covering 103 tools** (many tools are the same product listed in several categories).
Rules: [RULES.md](RULES.md).

## Summary

| | Product URLs | Tools |
|---|---|---|
| verified | 19 | 69 |
| unknown | 2 | 8 |
| failed | 10 | 26 |
| **total** | **31** | **103** |

Verified by label:

| Label | Product URLs | Tools |
|---|---|---|
| Free | 0 | 0 |
| Freemium | 16 | 52 |
| Free Trial | 3 | 17 |
| Paid | 0 | 0 |

## Verified

| Product | Label | Tools | Pricing page | Review note |
|---|---|---|---|---|
| https://www.jasper.ai | Free Trial | 6 | https://www.jasper.ai/pricing |  |
| https://www.grammarly.com | Freemium | 5 | https://www.grammarly.com/plans |  |
| https://www.anthropic.com/claude | Freemium | 1 | https://claude.com/pricing |  |
| https://gemini.google.com | Freemium | 2 | https://gemini.google/subscriptions/ |  |
| https://writesonic.com | Free Trial | 8 | https://writesonic.com/pricing | REVIEW: trial length not stated on the page. |
| https://www.notion.so/product/ai | Free Trial | 3 | https://www.notion.com/pricing | REVIEW: Notion AI is a limited trial on Notion's free plan; full AI is paid. |
| https://runwayml.com | Freemium | 4 | https://runway.com/pricing | REVIEW: the free plan is permanent but its credits are one-time. runwayml.com redirects to runway.com. |
| https://www.synthesia.io | Freemium | 4 | https://www.synthesia.io/pricing |  |
| https://www.heygen.com | Freemium | 3 | https://www.heygen.com/pricing |  |
| https://www.descript.com | Freemium | 6 | https://www.descript.com/pricing |  |
| https://elevenlabs.io | Freemium | 3 | https://elevenlabs.io/pricing |  |
| https://otter.ai | Freemium | 6 | https://otter.ai/pricing |  |
| https://suno.ai | Freemium | 1 | https://suno.com/pricing |  |
| https://claude.ai | Freemium | 3 | https://claude.com/pricing |  |
| https://www.cursor.sh | Freemium | 2 | https://cursor.com/pricing | REVIEW: read twice (plans differ from older Cursor plans). The tool's stored URL still uses the old cursor.sh domain. |
| https://www.adobe.com/products/firefly.html | Freemium | 2 | https://www.adobe.com/products/firefly/plans.html | REVIEW: the free plan is described in the FAQ, not as a plan card. Prices in INR (fetch location). |
| https://www.notion.so | Freemium | 5 | https://www.notion.com/pricing |  |
| https://www.figma.com | Freemium | 2 | https://www.figma.com/pricing/ |  |
| https://zapier.com | Freemium | 3 | https://zapier.com/pricing |  |

## Unknown (page read, label not settled)

| Product | Tools | Why |
|---|---|---|
| https://www.copy.ai | 7 | Cannot tell whether "Try for free" is a free plan or a trial. |
| https://pika.art | 1 | A free plan exists but includes no monthly credits; unclear whether it is usable without buying packs. |

## Failed (could not read; check by hand)

| Product | Tools | Reason |
|---|---|---|
| https://chat.openai.com | 5 | HTTP 403 at https://openai.com/chatgpt/pricing/ and https://chatgpt.com/pricing (automated access blocked). Check by hand. |
| https://quillbot.com | 2 | HTTP 403 at https://quillbot.com/premium and https://quillbot.com/pricing. Check by hand. |
| https://leonardo.ai | 3 | HTTP 403 at https://leonardo.ai/pricing/ and https://leonardo.ai/pricing. Check by hand. |
| https://www.canva.com | 7 | HTTP 403 at https://www.canva.com/pricing/ and https://www.canva.com/pro/. Check by hand. |
| https://klingai.com | 1 | Page text not available to an automated reader (rendered by JavaScript). Check by hand. |
| https://murf.ai | 3 | Page text not available to an automated reader (only the word "Murf" returned). Check by hand. |
| https://www.perplexity.ai | 1 | Page text not available to an automated reader. Check by hand. |
| https://poe.com | 1 | HTTP 403. Check by hand. |
| https://www.midjourney.com | 2 | HTTP 403 on the official plans documentation. Check by hand. |
| https://gamma.app | 1 | HTTP 403. Check by hand. |

## Next steps

1. Review `batch-01-tools.csv`: set `approved` to `yes` on rows to import, or change `status` to `unknown` to hold one back.
2. Optionally check the failed pages by hand and fill in `pricing_model`, `pricing_url`, `evidence`, `verified_at` and `status=verified`.
3. Nothing is imported until the import script and migration are approved separately.
