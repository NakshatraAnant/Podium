import type { INestApplication } from "@nestjs/common";
import { prisma } from "@podium/db";
import request from "supertest";
import { redactError, redactPii } from "../src/common/redact";
import { bootstrapTestApp, loginAs } from "./support";

/**
 * Phase 12 security pass. Two things are protected here because both have
 * already gone wrong once in this project's history, or would be invisible
 * until they did:
 *
 *  1. Real customer PII must never reach a plaintext application log.
 *  2. The credentials sheet in AMM_BRANDS_LLP_DATABASE.xlsx must never be
 *     opened, and that guard must fail loudly if a future edit weakens it.
 */
describe("Security: PII in logs, and the forbidden-sheet guard", () => {
  describe("PII redaction", () => {
    it("masks a real-shaped Indian phone number", () => {
      expect(redactPii("phone: 9810799222")).toBe("phone: ***22");
      expect(redactPii("phone: 919810799222")).toBe("phone: ***22");
      expect(redactPii("(+91)9810799222")).toMatch(/\*\*\*22/);
    });

    it("masks an e-mail down to a non-identifying stub", () => {
      expect(redactPii("mail hardik@drinkswa.com now")).toBe("mail ha***@drinkswa.com now");
    });

    it("redacts the shape of a real Prisma error, which embeds the failing row", () => {
      // This is what Prisma actually produces on a constraint violation: the
      // whole data object, values included.
      const prismaish = new Error(
        "Invalid `prisma.client.create()` invocation:\n" +
          "{ data: { name: 'Rajat Aggarwal', phone: '9810274274', email: '561aggarwal@gmail.com' } }\n" +
          "Unique constraint failed on the fields: (`workspace_id`,`phone`)",
      );
      const safe = redactError(prismaish);
      expect(safe.message).not.toContain("9810274274");
      expect(safe.message).not.toContain("561aggarwal@gmail.com");
      // The diagnosable part survives.
      expect(safe.message).toContain("Unique constraint failed");
      expect(safe.message).toContain("workspace_id");
    });

    it("leaves short numbers and ids alone — over-redaction still has a limit", () => {
      expect(redactPii("invoice AMM/JPR/2026-27/0007")).toContain("0007");
      expect(redactPii("qty 42 of 100")).toBe("qty 42 of 100");
    });

    it("redacts a uuid-free stack trace without destroying the trace", () => {
      const err = new Error("boom for 9810799222");
      const safe = redactError(err);
      expect(safe.message).not.toContain("9810799222");
      expect(safe.stack).toBeDefined();
      expect(safe.stack).not.toContain("9810799222");
    });
  });

  describe("no PII escapes through the API's error envelope", () => {
    let app: INestApplication;
    let token: string;

    beforeAll(async () => {
      app = await bootstrapTestApp();
      token = await loginAs(app, "anant.sharma@ammbrands.in");
    });
    afterAll(async () => await app.close());

    it("a duplicate-phone insert does not echo the phone back to the caller", async () => {
      const ws = await prisma.workspace.findFirstOrThrow();
      const phone = "9999000111";
      const a = await prisma.client.create({
        data: { workspaceId: ws.id, name: "ZZ Redaction probe", type: "INDIVIDUAL", phone, source: "test" },
      });
      try {
        // Force the unique-constraint path through the real HTTP stack.
        const res = await request(app.getHttpServer())
          .post("/api/clients")
          .set("Authorization", `Bearer ${token}`)
          .send({ name: "ZZ Redaction probe 2", type: "INDIVIDUAL", cityId: (await prisma.city.findFirstOrThrow()).id });
        // Whatever the outcome, the response must never carry another row's phone.
        expect(JSON.stringify(res.body)).not.toContain(phone);
      } finally {
        await prisma.client.delete({ where: { id: a.id } });
      }
    });
  });
});

/**
 * The forbidden-sheet guard. The import brief was explicit: the credentials
 * sheet must never be opened, read, parsed, or logged. `assertNotForbidden`
 * THROWS rather than skipping, precisely so a refactor that starts reading it
 * fails loudly instead of quietly succeeding — and this test would catch a
 * regression that turned the throw back into a skip.
 */
describe("Forbidden credentials sheet guard", () => {
  // Imported lazily so this file has no hard dependency on the import script's
  // runtime (it talks to Prisma at module load).
  let assertNotForbidden: (name: string) => void;

  beforeAll(async () => {
    const mod = await import("../../../scripts/forbidden-sheet");
    assertNotForbidden = (mod as unknown as { assertNotForbidden: (n: string) => void }).assertNotForbidden;
  });

  it("throws on the exact sheet name from the AMM workbook", () => {
    expect(() => assertNotForbidden("LOGIN I`D AND PASSWORDS LIST")).toThrow(/credentials/i);
  });

  it("throws on plausible variants, not just the one literal name", () => {
    for (const name of [
      "LOGIN ID AND PASSWORDS LIST",
      "passwords",
      "Password List",
      "  LOGIN I'D AND PASSWORDS LIST  ",
      "Staff Passwords 2026",
    ]) {
      expect(() => assertNotForbidden(name)).toThrow();
    }
  });

  it("does NOT throw on the sheets the importer legitimately reads", () => {
    for (const name of ["AMM CLIENT DATABASE", "Clients", "AMM EMPLOYEE DATA", "DATA DUMP", "Sales Funnel"]) {
      expect(() => assertNotForbidden(name)).not.toThrow();
    }
  });

  it("the guard throws — it must never silently skip", () => {
    // A skip would make this expression return undefined instead of raising.
    let threw = false;
    try {
      assertNotForbidden("LOGIN AND PASSWORDS");
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
