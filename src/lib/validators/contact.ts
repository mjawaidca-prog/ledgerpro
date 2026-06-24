import { z } from 'zod';

export const contactSchema = z.object({
  name: z.string().min(1, 'Contact name is required').max(120),
  companyName: z.string().max(200).nullable().optional(),
  type: z.enum(['customer', 'supplier']),
  email: z.string().email('Invalid email address').max(200).nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  status: z.enum(['active', 'inactive']).default('active'),
  notes: z.string().max(2000).nullable().optional(),
});

export type ContactInput = z.infer<typeof contactSchema>;

export const contactUpdateSchema = contactSchema.partial();
export type ContactUpdate = z.infer<typeof contactUpdateSchema>;
