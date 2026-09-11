import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@podium/db";
import type { CreateMovementInput } from "@podium/shared-types";
import { CityScopeService } from "../common/city-scope/city-scope.service";
import { PrismaService } from "../common/prisma/prisma.service";
import type { RequestUser } from "../common/types";

type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

const DECREMENTS_FROM = new Set(["CONSUME", "DAMAGE", "TRANSFER_OUT"]);
const INCREMENTS_TO = new Set(["RECEIVE", "TRANSFER_IN", "RETURN", "PURCHASE"]);

/**
 * The inventory ledger (blueprint §14). inventory_balances is NEVER written
 * to directly from outside this service — every change is an
 * inventory_movements row, and the balance is recomputed under a row lock
 * (SELECT ... FOR UPDATE) inside the same transaction as the movement
 * insert. This is the direct fix for the prototype's `qty[cityIdx] -= n`
 * in-place array mutation, which had no concurrency control at all.
 *
 * RESERVE/consume-of-reservation are deliberately NOT handled as balance-
 * affecting movements here — reservations live in inventory_reservations
 * and reduce *available* stock (qtyOnHand - reserved), not qtyOnHand itself.
 * Recipe-driven auto-reservation from guest count x drinks is schema-ready
 * (recipe_items, inventory_reservations) but not yet wired to an endpoint —
 * see docs/STATUS.md.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cityScope: CityScopeService,
  ) {}

  async listBalances(user: RequestUser, cityId?: string) {
    // scopeFilter() returns a filter shaped for a model with its own
    // `cityId` column (e.g. `{ cityId: { in: [...] } }`) -- InventoryLocation
    // has that column directly, so the scope applies to `location`, not to
    // `location.city` (City's own key is `id`, not `cityId`; nesting the
    // scope filter there produced an invalid Prisma query that 500'd for
    // every non-ALL-scope caller -- caught by the RBAC audit, not by the
    // original test suite, since every inventory test happened to run as
    // an ALL-scope Admin/Founder user).
    const scope = this.cityScope.scopeFilter(user, cityId);
    return this.prisma.client.inventoryBalance.findMany({
      where: {
        item: { workspaceId: user.workspaceId },
        location: { ...scope },
      },
      include: { item: true, location: { include: { city: true } } },
      orderBy: [{ item: { name: "asc" } }],
    });
  }

  async createMovement(user: RequestUser, input: CreateMovementInput, idempotencyKey?: string) {
    if (idempotencyKey) {
      const existing = await this.prisma.client.inventoryMovement.findUnique({ where: { idempotencyKey } });
      if (existing) return existing;
    }
    if (input.type === "TRANSFER_OUT" || input.type === "TRANSFER_IN") {
      if (!input.fromLocationId || !input.toLocationId) {
        throw new BadRequestException("Transfers require both fromLocationId and toLocationId.");
      }
      return this.transfer(user, input, idempotencyKey);
    }
    if (DECREMENTS_FROM.has(input.type) && !input.fromLocationId) {
      throw new BadRequestException(`${input.type} requires fromLocationId.`);
    }
    if (INCREMENTS_TO.has(input.type) && !input.toLocationId) {
      throw new BadRequestException(`${input.type} requires toLocationId.`);
    }
    if (input.type === "ADJUSTMENT" && !input.fromLocationId && !input.toLocationId) {
      throw new BadRequestException("ADJUSTMENT requires fromLocationId (decrease) or toLocationId (increase).");
    }

    return this.prisma.client.$transaction(async (tx) => {
      const locationId = input.fromLocationId ?? input.toLocationId!;
      const location = await tx.inventoryLocation.findUniqueOrThrow({ where: { id: locationId }, include: { city: true } });
      this.cityScope.assertCanAccessCity(user, location.cityId);

      const decrement = DECREMENTS_FROM.has(input.type) || (input.type === "ADJUSTMENT" && !!input.fromLocationId);
      await this.applyBalanceDelta(tx, input.skuId, locationId, decrement ? -input.qty : input.qty);

      return tx.inventoryMovement.create({
        data: {
          skuId: input.skuId,
          type: input.type,
          fromLocationId: input.fromLocationId,
          toLocationId: input.toLocationId,
          qty: input.qty,
          refType: input.refType,
          refId: input.refId,
          actorId: user.id,
          note: input.note,
          idempotencyKey,
        },
      });
    });
  }

  private async transfer(user: RequestUser, input: CreateMovementInput, idempotencyKey?: string) {
    return this.prisma.client.$transaction(async (tx) => {
      const [fromLoc, toLoc] = await Promise.all([
        tx.inventoryLocation.findUniqueOrThrow({ where: { id: input.fromLocationId! } }),
        tx.inventoryLocation.findUniqueOrThrow({ where: { id: input.toLocationId! } }),
      ]);
      this.cityScope.assertCanAccessCity(user, fromLoc.cityId);
      this.cityScope.assertCanAccessCity(user, toLoc.cityId);

      await this.applyBalanceDelta(tx, input.skuId, fromLoc.id, -input.qty);
      await this.applyBalanceDelta(tx, input.skuId, toLoc.id, input.qty);

      const out = await tx.inventoryMovement.create({
        data: {
          skuId: input.skuId, type: "TRANSFER_OUT", fromLocationId: fromLoc.id, toLocationId: toLoc.id,
          qty: input.qty, refType: input.refType, refId: input.refId, actorId: user.id, note: input.note,
          idempotencyKey: idempotencyKey ? `${idempotencyKey}:out` : undefined,
        },
      });
      await tx.inventoryMovement.create({
        data: {
          skuId: input.skuId, type: "TRANSFER_IN", fromLocationId: fromLoc.id, toLocationId: toLoc.id,
          qty: input.qty, refType: input.refType, refId: input.refId, actorId: user.id, note: input.note,
          idempotencyKey: idempotencyKey ? `${idempotencyKey}:in` : undefined,
        },
      });
      return out;
    });
  }

  /**
   * The single supported way for another module to write to the ledger.
   * Procurement's goods receipts call this inside their own transaction, so a
   * received PO line and its RECEIVE movement and the balance change are one
   * atomic unit — and so there is exactly one implementation of the row-locked
   * balance update, not a second copy that could drift from this one.
   */
  async recordMovementInTx(
    tx: Tx,
    params: {
      skuId: string;
      type: "RECEIVE" | "PURCHASE" | "RETURN" | "CONSUME" | "DAMAGE" | "ADJUSTMENT";
      locationId: string;
      qty: number;
      actorId: string;
      refType?: string;
      refId?: string;
      note?: string;
      idempotencyKey?: string;
    },
  ) {
    const decrement = DECREMENTS_FROM.has(params.type);
    await this.applyBalanceDelta(tx, params.skuId, params.locationId, decrement ? -params.qty : params.qty);
    return tx.inventoryMovement.create({
      data: {
        skuId: params.skuId,
        type: params.type,
        fromLocationId: decrement ? params.locationId : null,
        toLocationId: decrement ? null : params.locationId,
        qty: params.qty,
        refType: params.refType,
        refId: params.refId,
        actorId: params.actorId,
        note: params.note,
        idempotencyKey: params.idempotencyKey,
      },
    });
  }

  /**
   * Row-locks the (sku, location) balance and applies `delta`, creating the
   * balance row first (qty 0) if this is the first movement ever recorded
   * for that pair. Throws if a decrement would take on-hand stock negative —
   * the ledger is the source of truth, so this check is authoritative, not
   * advisory.
   */
  private async applyBalanceDelta(tx: Tx, skuId: string, locationId: string, delta: number) {
    await tx.inventoryBalance.upsert({
      where: { skuId_locationId: { skuId, locationId } },
      update: {},
      create: { skuId, locationId, qtyOnHand: 0, reorderLevel: 0 },
    });
    const [locked] = await tx.$queryRaw<Array<{ qty_on_hand: number }>>(
      Prisma.sql`SELECT qty_on_hand FROM inventory_balances WHERE sku_id = ${skuId}::uuid AND location_id = ${locationId}::uuid FOR UPDATE`,
    );
    const newQty = (locked?.qty_on_hand ?? 0) + delta;
    if (newQty < 0) {
      throw new BadRequestException("This movement would take on-hand stock negative.");
    }
    await tx.$executeRaw(
      Prisma.sql`UPDATE inventory_balances SET qty_on_hand = ${newQty}, updated_at = now() WHERE sku_id = ${skuId}::uuid AND location_id = ${locationId}::uuid`,
    );
  }
}
