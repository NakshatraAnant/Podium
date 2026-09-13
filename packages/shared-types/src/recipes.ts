import { z } from "zod";

/**
 * Menu costing (blueprint §19/§40, Phase E): a recipe's ingredient list
 * against real inventory items, priced against their real standardCost.
 * The server always computes cost/margin from live `standard_cost` and
 * `size_ml` at read time — never stored or trusted from the client — so a
 * SKU's cost changing (a new vendor quote, a purchase-order rate change)
 * is reflected on every recipe that uses it without any recipe edit.
 */
export const recipeItemSchema = z.object({
  skuId: z.string().uuid(),
  qtyMl: z.number().int().positive(),
});
export type RecipeItemInput = z.infer<typeof recipeItemSchema>;

export const createRecipeSchema = z.object({
  name: z.string().min(1).max(200),
  glass: z.string().min(1).max(120),
  garnishCost: z.number().nonnegative().default(0),
  price: z.number().positive(),
  items: z.array(recipeItemSchema).min(1),
});
export type CreateRecipeInput = z.infer<typeof createRecipeSchema>;

export const updateRecipeSchema = createRecipeSchema.partial();
export type UpdateRecipeInput = z.infer<typeof updateRecipeSchema>;
