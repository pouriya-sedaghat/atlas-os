import { checkContainerSafety } from './container-safety.mjs';

await checkContainerSafety();
process.stdout.write('Docker context and production runtime policies are valid.\n');
