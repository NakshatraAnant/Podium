import { z } from "zod";

export const projectStatusEnum = z.enum([
  "PLANNING", "PLANNED", "IN_PROGRESS", "CLIENT_REVIEW", "ON_HOLD", "COMPLETED", "CANCELLED",
]);
export const projectHealthEnum = z.enum(["GREEN", "AMBER", "RED"]);

export const createProjectSchema = z.object({
  name: z.string().min(1),
  clientId: z.string().uuid(),
  playbookId: z.string().uuid().optional(),
  type: z.string().min(1),
  cityId: z.string().uuid(),
  eventDate: z.coerce.date(),
  pmId: z.string().uuid(),
  revenue: z.number().nonnegative().default(0),
  estCost: z.number().nonnegative().default(0),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = createProjectSchema.partial().extend({
  status: projectStatusEnum.optional(),
});
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
