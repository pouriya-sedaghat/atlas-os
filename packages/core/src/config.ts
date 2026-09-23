import { resolve } from 'node:path';

import { z } from 'zod';

import { AppError } from './errors.js';

const booleanFromString = z
  .enum(['true', 'false'])
  .default('true')
  .transform((value) => value === 'true');

function portFromString(defaultValue: number) {
  return z.preprocess((value) => {
    if (value === undefined) return defaultValue;
    if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
    return value;
  }, z.number().int().min(1).max(65_535));
}

const environmentSchema = z.object({
  ATLAS_ACTIVE_SNAPSHOT_PATH: z.string().min(1).default('./data/active.json'),
  ATLAS_API_HOST: z.string().min(1).default('127.0.0.1'),
  ATLAS_API_PORT: portFromString(3000),
  ATLAS_DATA_ROOT: z.string().min(1).default('./data'),
  ATLAS_GATEWAY_ORIGIN: z.url().default('http://127.0.0.1:8080'),
  ATLAS_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  ATLAS_OFFLINE: booleanFromString,
  ATLAS_PROFILE: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]*$/)
    .default('default'),
  ATLAS_REGION: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]*$/)
    .default('iran'),
  ATLAS_FONT_PATH: z.string().min(1).default('./assets/fonts/Vazirmatn-Regular.ttf'),
  ATLAS_REGION_CONFIG_PATH: z.string().min(1).default(''),
  ATLAS_UPDATE_MODE: z.enum(['disabled', 'manual']).default('disabled'),
  ATLAS_UPDATER_HOST: z.string().min(1).default('127.0.0.1'),
  ATLAS_UPDATER_PORT: portFromString(3001),
});

export interface AppConfig {
  readonly activeSnapshotPath: string;
  readonly api: { readonly host: string; readonly port: number };
  readonly dataRoot: string;
  /** Font the basemap's label glyphs are generated from. Domain configuration, not tooling. */
  readonly fontPath: string;
  readonly regionConfigPath: string;
  readonly gatewayOrigin: string;
  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  readonly offline: boolean;
  readonly profile: string;
  readonly region: string;
  readonly updateMode: 'disabled' | 'manual';
  readonly updater: { readonly host: string; readonly port: number };
}

export function loadConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  workingDirectory = process.cwd(),
): AppConfig {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new AppError('CONFIGURATION_INVALID', 'Application configuration is invalid.', {
      details: { issues: parsed.error.issues },
      statusCode: 500,
    });
  }

  const values = parsed.data;
  return {
    activeSnapshotPath: resolve(workingDirectory, values.ATLAS_ACTIVE_SNAPSHOT_PATH),
    api: { host: values.ATLAS_API_HOST, port: values.ATLAS_API_PORT },
    dataRoot: resolve(workingDirectory, values.ATLAS_DATA_ROOT),
    fontPath: resolve(workingDirectory, values.ATLAS_FONT_PATH),
    gatewayOrigin: values.ATLAS_GATEWAY_ORIGIN,
    logLevel: values.ATLAS_LOG_LEVEL,
    offline: values.ATLAS_OFFLINE,
    profile: values.ATLAS_PROFILE,
    region: values.ATLAS_REGION,
    regionConfigPath: resolve(
      workingDirectory,
      values.ATLAS_REGION_CONFIG_PATH === ''
        ? `./config/regions/${values.ATLAS_REGION}.yaml`
        : values.ATLAS_REGION_CONFIG_PATH,
    ),
    updateMode: values.ATLAS_UPDATE_MODE,
    updater: { host: values.ATLAS_UPDATER_HOST, port: values.ATLAS_UPDATER_PORT },
  };
}
