import { defineCollection, z } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        audience: z.enum(['everyone', 'owner', 'admin', 'developer', 'operator']).default('everyone'),
        readingTime: z.string().optional(),
      }),
    }),
  }),
};
