import { z } from 'zod';
import { credentialAlias } from './config.js';
import { fail } from './errors.js';

export const languages = ['en', 'ru', 'zh', 'hi', 'es', 'fr', 'ar', 'bn', 'pt', 'id'];
export const uuid = z.string().uuid();
export const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const settings = z.object({
  name: z.string().trim().min(1).max(120),
  status: z.enum(['active', 'suspended']),
  seats: z.number().int().min(1).max(100000),
  monthly_characters: z.number().int().min(1).max(1e12),
  max_text: z.number().int().min(1).max(20000),
  rpm: z.number().int().min(1).max(10000),
  concurrency: z.number().int().min(1).max(500),
  model: z.string().trim().min(1).max(200),
  credential: credentialAlias,
  instructions: z.string().max(8000),
  languages: z.array(z.enum(languages)).min(1).max(10).refine(values => new Set(values).size === values.length),
  access_until: z.iso.datetime({ offset: true }).nullable(),
});

export function validate(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) fail(422, 'invalid_input', 'Проверьте введённые значения.');
  return result.data;
}

// Invitation expiry is evaluated after acquiring the tenant lock.
