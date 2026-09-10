import type { INestApplication } from "@nestjs/common";
import { prisma } from "@podium/db";
import request from "supertest";
import { bootstrapTestApp, loginAs } from "./support";

/**
 * The ledger's whole reason to exist (blueprint §14) is that concurrent
 * stock movements on the same SKU/location can never oversell or produce a
 * negative balance — the direct fix for the prototype's unguarded
 * `qty[cityIdx] -= n`. This fires a burst of concurrent CONSUME requests
 * whose combined quantity exceeds on-hand stock and asserts the ledger
 * never goes negative and the final balance is exactly what the *accepted*
 * movements justify.
 */
describe("Inventory ledger concurrency (e2e)", () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await bootstrapTestApp();
    // Needs multi-city access since this spec moves stock across Goa/Jaipur/Delhi stores —
    // Kritika Bansal (Admin) holds the workspace's ALL-city grant, same as Founder.
    token = await loginAs(app, "kritika.bansal@ammbrands.in");
  });

  afterAll(async () => {
    await app.close();
  });

  it("never lets concurrent CONSUME movements take on-hand stock negative", async () => {
    const location = await prisma.inventoryLocation.findFirstOrThrow({ where: { name: "Goa Store" } });
    const item = await prisma.inventoryItem.findFirstOrThrow({ where: { sku: "SP-CAM" } }); // low seeded qty in Goa: 2
    const before = await prisma.inventoryBalance.findFirstOrThrow({ where: { skuId: item.id, locationId: location.id } });
    expect(before.qtyOnHand).toBeGreaterThan(0);

    // Fire 5 concurrent consumes of 1 unit each against a balance that can only satisfy `before.qtyOnHand` of them.
    const attempts = Array.from({ length: 5 }, () =>
      request(app.getHttpServer())
        .post("/api/inventory/movements")
        .set("Authorization", `Bearer ${token}`)
        .send({ skuId: item.id, type: "CONSUME", fromLocationId: location.id, qty: 1, note: "concurrency test" }),
    );
    const results = await Promise.all(attempts);

    const succeeded = results.filter((r) => r.status === 201).length;
    const rejected = results.filter((r) => r.status === 400).length;
    expect(succeeded).toBe(before.qtyOnHand);
    expect(succeeded + rejected).toBe(5);

    const after = await prisma.inventoryBalance.findFirstOrThrow({ where: { skuId: item.id, locationId: location.id } });
    expect(after.qtyOnHand).toBe(0);
    expect(after.qtyOnHand).toBeGreaterThanOrEqual(0);
  });

  it("a transfer moves stock atomically between two locations", async () => {
    const item = await prisma.inventoryItem.findFirstOrThrow({ where: { sku: "SP-VOD-AB" } });
    const from = await prisma.inventoryLocation.findFirstOrThrow({ where: { name: "Jaipur Store" } });
    const to = await prisma.inventoryLocation.findFirstOrThrow({ where: { name: "Delhi Store" } });
    const beforeFrom = await prisma.inventoryBalance.findFirstOrThrow({ where: { skuId: item.id, locationId: from.id } });
    const beforeTo = await prisma.inventoryBalance.findFirstOrThrow({ where: { skuId: item.id, locationId: to.id } });

    await request(app.getHttpServer())
      .post("/api/inventory/movements")
      .set("Authorization", `Bearer ${token}`)
      .send({ skuId: item.id, type: "TRANSFER_OUT", fromLocationId: from.id, toLocationId: to.id, qty: 3 })
      .expect(201);

    const afterFrom = await prisma.inventoryBalance.findFirstOrThrow({ where: { skuId: item.id, locationId: from.id } });
    const afterTo = await prisma.inventoryBalance.findFirstOrThrow({ where: { skuId: item.id, locationId: to.id } });
    expect(afterFrom.qtyOnHand).toBe(beforeFrom.qtyOnHand - 3);
    expect(afterTo.qtyOnHand).toBe(beforeTo.qtyOnHand + 3);
  });
});
