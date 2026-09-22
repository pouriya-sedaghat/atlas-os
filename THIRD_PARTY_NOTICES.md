# Third-party notices

M0 adds the following direct runtime and development dependencies. Their own license texts and
transitive dependency notices remain authoritative in the installed packages and upstream
projects.

| Dependency               |          Version | Purpose                                     | License      |
| ------------------------ | ---------------: | ------------------------------------------- | ------------ |
| Fastify                  |            5.6.0 | Local HTTP API                              | MIT          |
| React                    |           19.1.1 | Local Web UI                                | MIT          |
| React DOM                |           19.1.1 | Web DOM rendering                           | MIT          |
| Zod                      |            4.1.5 | Runtime schema and configuration validation | MIT          |
| Vite                     |            7.1.5 | Web build and development server            | MIT          |
| Vitest                   |            3.2.4 | Test runner                                 | MIT          |
| TypeScript               |            5.9.2 | Type checking and compilation               | Apache-2.0   |
| ESLint                   |           9.35.0 | Static analysis                             | MIT          |
| `@eslint/js`             |           9.35.0 | ESLint JavaScript rules                     | MIT          |
| typescript-eslint        |           8.43.0 | TypeScript lint integration                 | BSD-2-Clause |
| Prettier                 |            3.6.2 | Formatting                                  | MIT          |
| tsx                      |           4.20.5 | TypeScript development runner               | MIT          |
| globals                  |           16.3.0 | ESLint environment globals                  | MIT          |
| `@vitejs/plugin-react`   |            5.0.2 | React transform for Vite                    | MIT          |
| React type definitions   | 19.1.12 / 19.1.9 | Type declarations                           | MIT          |
| Node.js type definitions |          22.20.4 | Type declarations                           | MIT          |

Container foundations:

- Node.js `22.14.0-alpine3.21` pinned to manifest digest
  `sha256:9bef0ef1e268f60627da9ba7d7605e8831d5b56ad07487d24d1aa386336d1944` (Node.js is MIT; the
  Alpine image includes separately licensed system packages).
- NGINX Unprivileged `1.27.5-alpine` pinned to manifest digest
  `sha256:65e3e85dbaed8ba248841d9d58a899b6197106c23cb0ff1a132b7bfe0547e4c0` (NGINX uses the
  BSD-2-Clause license; the image includes separately licensed Alpine packages).

No future GIS engine or data-processing tool is installed in M0. This repository has no selected
project-level open-source license; that remains a governance decision.
