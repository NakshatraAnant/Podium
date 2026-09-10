import { config } from "dotenv";
import { resolve } from "path";

// Tests run against the local dev database (same one `pnpm --filter @podium/db seed`
// populates) rather than an isolated per-run test database — a known
// simplification given this build's time budget, documented in
// docs/STATUS.md. Do not point DATABASE_URL at anything but a local/dev
// database when running this suite; it creates real rows.
config({ path: resolve(__dirname, "../../../.env") });
