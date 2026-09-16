/**
 * PHASE 0 §6 — classify every automation rule BEFORE anything is disabled.
 *
 * The instruction was explicit: do not switch off the apparently-dead rules
 * on the strength of them looking dead. A rule can look dead for six quite
 * different reasons, and only two of them are "turn it off".
 *
 * So this decides nothing by eye. It reads the repository and the database
 * and derives each rule's category from four facts it can actually check:
 *
 *   emitted   — does any code path raise this trigger? (grep of emit() sites)
 *   handled   — is a handler REGISTERED for it in AutomationModule? A handler
 *               class that exists but is never registered is not wired up.
 *   runs      — has it ever executed, and how did it end?
 *   enabled   — the is_enabled flag, which is a real kill switch (every
 *               candidate query in AutomationService filters on it).
 *
 * Usage:
 *   DATABASE_URL=... pnpm classify:automation
 *   DATABASE_URL=... pnpm classify:automation --markdown
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const API_SRC = path.join(ROOT, "apps/api/src");
const MARKDOWN = process.argv.includes("--markdown");

const prisma = new PrismaClient();

/** Every .ts file under apps/api/src, read once. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

const SOURCES = sourceFiles(API_SRC).map((f) => ({ file: path.relative(ROOT, f), text: fs.readFileSync(f, "utf8") }));

/**
 * Trigger strings actually raised by `automation.emit({ trigger: ... })`.
 *
 * Template literals are kept as a prefix match: `lead.stage_changed:${stage}`
 * can raise any stage, so a rule configured for `lead.stage_changed:Won` IS
 * reachable through it.
 */
function emitters(): Array<{ trigger: string; file: string; line: number; templated: boolean }> {
  const found: Array<{ trigger: string; file: string; line: number; templated: boolean }> = [];
  for (const { file, text } of SOURCES) {
    text.split("\n").forEach((line, i) => {
      const m = /trigger:\s*(`[^`]+`|"[^"]+")/.exec(line);
      if (!m) return;
      const raw = m[1]!.slice(1, -1);
      if (raw === "string" || !raw.includes(".")) return;
      found.push({ trigger: raw, file, line: i + 1, templated: raw.includes("${") });
    });
  }
  return found;
}

/** Triggers whose handler is REGISTERED at boot — not merely defined. */
function registeredTriggers(): string[] {
  const handlers = fs.readFileSync(path.join(API_SRC, "automation/handlers.ts"), "utf8");
  const module = fs.readFileSync(path.join(API_SRC, "automation/automation.module.ts"), "utf8");

  const byClass = new Map<string, string>();
  const classRe = /export class (\w+) implements ActionHandler \{[\s\S]*?readonly trigger = "([^"]+)"/g;
  for (let m = classRe.exec(handlers); m; m = classRe.exec(handlers)) byClass.set(m[1]!, m[2]!);

  const registered: string[] = [];
  for (const [cls, trigger] of byClass) {
    // `this.automation.register(this.dealWon)` — match the injected property
    // against its declared class, so a handler that is provided but never
    // registered does not count as wired.
    const prop = new RegExp(`private readonly (\\w+): ${cls}`).exec(module)?.[1];
    if (prop && new RegExp(`register\\(this\\.${prop}\\)`).test(module)) registered.push(trigger);
  }
  return registered;
}

function reachable(configured: string, emitted: ReturnType<typeof emitters>) {
  return emitted.filter((e) => {
    if (e.trigger === configured) return true;
    if (!e.templated) {
      // `project.event_date_minus_days:30,7,1` is one rule covering three
      // offsets — AutomationService.triggerMatches compares the arg list as
      // a set, so mirror that here rather than guessing.
      const [cName, cArgs] = split(configured);
      const [eName, eArgs] = split(e.trigger);
      return cName === eName && !!cArgs && !!eArgs && cArgs.split(",").map((a) => a.trim()).includes(eArgs.trim());
    }
    const prefix = e.trigger.slice(0, e.trigger.indexOf("${"));
    return configured.startsWith(prefix);
  });
}

function split(t: string): [string, string | undefined] {
  const i = t.indexOf(":");
  return i === -1 ? [t, undefined] : [t.slice(0, i), t.slice(i + 1)];
}

type Category =
  | "WORKING"
  | "PARTIALLY_IMPLEMENTED"
  | "CONFIGURED_BUT_INACTIVE"
  | "BROKEN"
  | "DEAD"
  | "DEMO_FIXTURE";

function classify(o: { emitted: boolean; handled: boolean; enabled: boolean; runs: number; failed: number }): {
  category: Category;
  because: string;
} {
  if (!o.handled && !o.emitted) {
    return { category: "DEMO_FIXTURE", because: "no handler is registered and no code path raises this trigger — the row describes an intention, not a mechanism" };
  }
  if (!o.handled) {
    return { category: "DEAD", because: "the trigger is raised but no handler is registered, so emit() logs and skips it" };
  }
  if (!o.emitted) {
    return { category: "DEAD", because: "a handler is registered but nothing ever raises this trigger" };
  }
  if (!o.enabled) {
    return { category: "CONFIGURED_BUT_INACTIVE", because: "fully wired, but is_enabled is false so emit() never selects it" };
  }
  if (o.runs === 0) {
    return { category: "CONFIGURED_BUT_INACTIVE", because: "fully wired and enabled, but has never run — nothing has raised its trigger yet" };
  }
  if (o.failed > 0 && o.failed === o.runs) return { category: "BROKEN", because: "every recorded run failed" };
  if (o.failed > 0) return { category: "PARTIALLY_IMPLEMENTED", because: `${o.failed} of ${o.runs} runs failed` };
  return { category: "WORKING", because: `${o.runs} run(s), none failed` };
}

async function main() {
  const dbName = (process.env.DATABASE_URL ?? "").split("/").pop()?.split("?")[0] ?? "(unknown)";
  const emitted = emitters();
  const registered = registeredTriggers();

  const rules = await prisma.automationRule.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } });

  const rows: Array<Record<string, unknown>> = [];
  for (const rule of rules) {
    const configured = (rule.triggerConfig as { trigger?: string } | null)?.trigger ?? "";
    const sites = reachable(configured, emitted);
    const handled = registered.includes(configured);

    const runs = await prisma.automationRun.findMany({ where: { ruleId: rule.id } });
    const failed = runs.filter((r) => r.status === "FAILED").length;
    const { category, because } = classify({ emitted: sites.length > 0, handled, enabled: rule.isEnabled, runs: runs.length, failed });

    rows.push({
      name: rule.name,
      trigger: configured,
      enabled: rule.isEnabled,
      handler: handled ? "registered" : "none",
      // A templated site is flagged: `lead.stage_changed:${stage}` can raise
      // any stage, so mechanical reachability is not the same as reachability
      // for THIS value — updateStage() throws on WON before reaching its own
      // emit, which no amount of grepping can see.
      emittedFrom: sites.map((s) => `${s.file}:${s.line}${s.templated ? " (templated)" : ""}`).join(", ") || "nowhere",
      runs: runs.length,
      failed,
      category,
      because,
      actions: (rule.actions as string[]).length,
    });
  }

  if (MARKDOWN) {
    console.log(`| Rule | Trigger | Enabled | Handler | Raised from | Runs | Classification |`);
    console.log(`| --- | --- | --- | --- | --- | --- | --- |`);
    for (const r of rows) {
      console.log(`| ${r.name} | \`${r.trigger}\` | ${r.enabled ? "yes" : "no"} | ${r.handler} | ${r.emittedFrom === "nowhere" ? "**nowhere**" : `\`${r.emittedFrom}\``} | ${r.runs} | **${r.category}** |`);
    }
    console.log(`\n_Derived by \`scripts/classify-automation-rules.ts\` against \`${dbName}\` on ${new Date().toISOString().slice(0, 10)}._`);
  } else {
    console.log(`AUTOMATION RULE CLASSIFICATION — ${dbName}\n${"=".repeat(72)}`);
    console.log(`registered handlers: ${registered.length ? registered.join(", ") : "(none)"}`);
    console.log(`emit() sites: ${emitted.length}\n`);
    for (const r of rows) {
      console.log(`${r.category}  ${r.name}`);
      console.log(`   trigger      ${r.trigger}`);
      console.log(`   enabled      ${r.enabled}`);
      console.log(`   handler      ${r.handler}`);
      console.log(`   raised from  ${r.emittedFrom}`);
      console.log(`   runs         ${r.runs} (${r.failed} failed)`);
      console.log(`   because      ${r.because}\n`);
    }
    const tally = rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.category as string]: (acc[r.category as string] ?? 0) + 1 }), {});
    console.log(`${"=".repeat(72)}\n${Object.entries(tally).map(([k, v]) => `${k}: ${v}`).join("   ")}`);
    console.log(`\nNothing was disabled. This script only classifies.`);
  }
}

main().finally(() => prisma.$disconnect());
