import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateRecipeInput, UpdateRecipeInput } from "@podium/shared-types";
import { PrismaService } from "../common/prisma/prisma.service";
import type { RequestUser } from "../common/types";

const RECIPE_INCLUDE = { items: { include: { item: true } } } as const;

/**
 * Menu costing (Phase E): a recipe's real cost, computed server-side from
 * live inventory data every time — never stored. `standardCost` is priced
 * per whole unit (a bottle, a case — whatever `sizeMl` measures), so a
 * recipe using `qtyMl` of it costs `qtyMl * (standardCost / sizeMl)`. A SKU
 * with no `sizeMl` (a non-volume item — e.g. garnish sold by the piece)
 * cannot be priced this way; its line is flagged `costable: false` rather
 * than silently contributing 0 or a wrong number to the total, per the
 * standing rule that the server never emits a financial figure it isn't
 * sure of.
 */
@Injectable()
export class RecipesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: RequestUser) {
    const recipes = await this.prisma.client.recipe.findMany({
      where: { workspaceId: user.workspaceId, deletedAt: null },
      include: RECIPE_INCLUDE,
      orderBy: { name: "asc" },
    });
    return recipes.map((r) => this.withCosting(r));
  }

  async get(user: RequestUser, id: string) {
    const recipe = await this.prisma.client.recipe.findFirst({
      where: { id, workspaceId: user.workspaceId, deletedAt: null },
      include: RECIPE_INCLUDE,
    });
    if (!recipe) throw new NotFoundException("Recipe not found.");
    return this.withCosting(recipe);
  }

  async create(user: RequestUser, input: CreateRecipeInput) {
    await this.assertSkusExist(user, input.items.map((i) => i.skuId));
    const recipe = await this.prisma.client.recipe.create({
      data: {
        workspaceId: user.workspaceId,
        name: input.name,
        glass: input.glass,
        garnishCost: input.garnishCost,
        price: input.price,
        items: { create: input.items.map((i) => ({ skuId: i.skuId, qtyMl: i.qtyMl })) },
      },
      include: RECIPE_INCLUDE,
    });
    return this.withCosting(recipe);
  }

  async update(user: RequestUser, id: string, input: UpdateRecipeInput) {
    const existing = await this.prisma.client.recipe.findFirst({ where: { id, workspaceId: user.workspaceId, deletedAt: null } });
    if (!existing) throw new NotFoundException("Recipe not found.");
    if (input.items) await this.assertSkusExist(user, input.items.map((i) => i.skuId));

    const { items, ...scalars } = input;
    const recipe = await this.prisma.client.$transaction(async (tx) => {
      await tx.recipe.update({ where: { id: existing.id }, data: scalars });
      // A recipe's item list is a single coherent formula, same reasoning as
      // budget lines — patching one ingredient in isolation risks a recipe
      // whose items no longer match what was actually agreed.
      if (items) {
        await tx.recipeItem.deleteMany({ where: { recipeId: existing.id } });
        await tx.recipeItem.createMany({ data: items.map((i) => ({ recipeId: existing.id, skuId: i.skuId, qtyMl: i.qtyMl })) });
      }
      return tx.recipe.findUniqueOrThrow({ where: { id: existing.id }, include: RECIPE_INCLUDE });
    });
    return this.withCosting(recipe);
  }

  async remove(user: RequestUser, id: string) {
    const existing = await this.prisma.client.recipe.findFirst({ where: { id, workspaceId: user.workspaceId, deletedAt: null } });
    if (!existing) throw new NotFoundException("Recipe not found.");
    return this.prisma.client.recipe.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
  }

  private async assertSkusExist(user: RequestUser, ids: string[]) {
    const unique = [...new Set(ids)];
    const found = await this.prisma.client.inventoryItem.count({
      where: { id: { in: unique }, workspaceId: user.workspaceId, deletedAt: null },
    });
    if (found !== unique.length) throw new BadRequestException("One or more items in this recipe do not exist in this workspace.");
  }

  private withCosting<
    T extends { garnishCost: unknown; price: unknown; items: Array<{ qtyMl: number; item: { standardCost: unknown; sizeMl: number | null } }> },
  >(recipe: T) {
    const garnishCost = Number(recipe.garnishCost);
    const price = Number(recipe.price);
    let ingredientCost = 0;
    let allCostable = true;
    const lines = recipe.items.map((i) => {
      if (!i.item.sizeMl || i.item.sizeMl <= 0) {
        allCostable = false;
        return { costable: false as const, cost: null };
      }
      const cost = i.qtyMl * (Number(i.item.standardCost) / i.item.sizeMl);
      ingredientCost += cost;
      return { costable: true as const, cost };
    });
    const totalCost = allCostable ? ingredientCost + garnishCost : null;
    const margin = totalCost === null ? null : price - totalCost;
    const marginPct = margin === null || price <= 0 ? null : Math.round((margin / price) * 1000) / 10;
    return {
      ...recipe,
      items: recipe.items.map((i, idx) => ({ ...i, ...lines[idx] })),
      costing: { ingredientCost: allCostable ? ingredientCost : null, garnishCost, totalCost, margin, marginPct, allCostable },
    };
  }
}
