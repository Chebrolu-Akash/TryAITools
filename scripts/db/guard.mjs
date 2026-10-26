// Shared safety guard: every script that can talk to Cloudflare D1 may only target a PREVIEW database.
// Production database work stays disabled until it is explicitly approved and this guard is changed in review.
export const PREVIEW_NAME = /^[a-z0-9][a-z0-9-]*-preview$/;
export function assertPreviewDb(name) {
  if (typeof name !== "string" || !PREVIEW_NAME.test(name)) {
    console.error(`Refusing to run: database "${name}" is not a preview database (name must end in "-preview", e.g. tryaitools-preview).`);
    process.exit(2);
  }
  if (/prod/i.test(name)) {
    console.error(`Refusing to run: "${name}" looks like a production database.`);
    process.exit(2);
  }
  return name;
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
