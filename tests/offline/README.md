# Offline smoke test

The executable smoke test is `pnpm test:offline`. It starts only prebuilt Compose images on the
internal runtime network, checks the gateway, Web app, API, dataset response, and updater health,
then removes the test stack. See `docs/development.md` for provisioning and execution steps.
