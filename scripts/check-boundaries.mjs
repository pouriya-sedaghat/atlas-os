import { checkBoundaries } from './boundaries.mjs';

const violations = await checkBoundaries(process.cwd());
if (violations.length > 0) {
  process.stderr.write(
    `Dependency boundary violations:\n${violations.map((item) => `- ${item}`).join('\n')}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write('Dependency boundaries are valid: apps -> core -> atlas-os.\n');
}
