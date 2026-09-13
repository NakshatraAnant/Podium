import { z } from "zod";

export const vendorStatusEnum = z.enum(["PREFERRED", "APPROVED", "BLACKLISTED"]);

export const createVendorSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  cityId: z.string().uuid(),
  contactName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  address: z.string().optional(),
  rating: z.number().min(0).max(5).optional(),
  gstin: z.string().optional(),
  status: vendorStatusEnum.default("APPROVED"),
});
export type CreateVendorInput = z.infer<typeof createVendorSchema>;

export const updateVendorSchema = createVendorSchema.partial();
export type UpdateVendorInput = z.infer<typeof updateVendorSchema>;
