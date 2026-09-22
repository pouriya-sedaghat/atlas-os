export interface ParsedArguments {
  readonly command: readonly string[];
  readonly flags: Readonly<Record<string, string>>;
  readonly positional: readonly string[];
}

/**
 * Parses `command words --flag value --flag=value` without a dependency.
 *
 * A bare `--flag` with no value is treated as `--flag=true`, which is what the boolean options
 * here need.
 */
export function parseArguments(argv: readonly string[]): ParsedArguments {
  const command: string[] = [];
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  let seenFlag = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith('--')) {
      if (seenFlag) positional.push(token);
      else command.push(token);
      continue;
    }
    seenFlag = true;
    const body = token.slice(2);
    const equals = body.indexOf('=');
    if (equals !== -1) {
      flags[body.slice(0, equals)] = body.slice(equals + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[body] = 'true';
      continue;
    }
    flags[body] = next;
    index += 1;
  }

  return { command, flags, positional };
}
