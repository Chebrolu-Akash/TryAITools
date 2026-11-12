// Worker entry for a static build: the gate in front of the app's own (Nitro) entry. Bundled by
// scripts/static/build-gate.mjs into .output/server/gate.mjs, with "./index.mjs" left as an import of the Nitro entry
// that sits next to it. Both are loaded at Worker startup, not inside a request.
// The AI News cron module is a separate bundle (news-cron.mjs), imported only when a Cron Trigger fires.
// @ts-expect-error -- placeholder, rewritten to "./index.mjs" (the generated Nitro entry) by scripts/static/build-gate.mjs
import app from "__nitro_entry__";
import { createGate, type CronModule } from "./gate";

export default createGate(app, {
  // @ts-expect-error -- placeholder, rewritten to "./news-cron.mjs" by scripts/static/build-gate.mjs
  cron: () => import("__news_cron__").then((m: { default: CronModule }) => m.default),
});
