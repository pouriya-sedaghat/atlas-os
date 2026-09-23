import { readFile } from 'node:fs/promises';

import { parse } from 'yaml';
import { z } from 'zod';

import { AppError } from './errors.js';

const regionDescriptorSchema = z
  .object({
    bounds: z
      .object({
        east: z.number().min(-180).max(180),
        north: z.number().min(-90).max(90),
        south: z.number().min(-90).max(90),
        west: z.number().min(-180).max(180),
      })
      .strict(),
    defaultLabelLanguages: z.array(z.string().regex(/^[a-z]{2}$/)).min(1),
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
    name: z.string().min(1),
    schemaVersion: z.literal(1),
  })
  .strict()
  .refine((value) => value.bounds.west < value.bounds.east, {
    message: 'Region bounds must have an increasing longitude axis.',
    path: ['bounds'],
  })
  .refine((value) => value.bounds.south < value.bounds.north, {
    message: 'Region bounds must have an increasing latitude axis.',
    path: ['bounds'],
  });

export type RegionDescriptor = z.infer<typeof regionDescriptorSchema>;

/**
 * Loads and validates a region descriptor.
 *
 * The descriptor holds metadata and geography only. It never references a dataset, so reading it
 * cannot trigger a download and a missing dataset is not a configuration failure.
 */
export async function loadRegionDescriptor(
  path: string,
  expectedId: string,
): Promise<RegionDescriptor> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (cause) {
    throw new AppError('CONFIGURATION_INVALID', 'Region descriptor could not be read.', {
      cause,
      details: { path },
      statusCode: 500,
    });
  }

  const parsed = regionDescriptorSchema.safeParse(parse(raw));
  if (!parsed.success) {
    throw new AppError('CONFIGURATION_INVALID', 'Region descriptor is invalid.', {
      details: { issues: parsed.error.issues, path },
      statusCode: 500,
    });
  }
  if (parsed.data.id !== expectedId) {
    throw new AppError(
      'CONFIGURATION_INVALID',
      'Region descriptor does not match the configured region.',
      {
        details: { configured: expectedId, descriptor: parsed.data.id },
        statusCode: 500,
      },
    );
  }
  return parsed.data;
}
