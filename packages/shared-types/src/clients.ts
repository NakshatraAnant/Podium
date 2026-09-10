import { z } from "zod";

export const clientTypeEnum = z.enum(["INDIVIDUAL", "CORPORATE", "BRAND"]);

export const createClientSchema = z.object({
  name: z.string().min(1),
  type: clientTypeEnum,
  cityId: z.string().uuid(),
  gstin: z.string().optional(),
  gstStateCode: z.string().length(2).optional(),
  ltv: z.number().nonnegative().default(0),
  since: z.coerce.date().optional(),
});
export type CreateClientInput = z.infer<typeof createClientSchema>;

export const updateClientSchema = createClientSchema.partial();
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
