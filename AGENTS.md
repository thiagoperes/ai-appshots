# Project instructions

1.1 Follow the user's global instructions. Do not add usage examples or documentation unless requested. Use numbered items when reporting results.

1.2 Run commands non-interactively as one-shot operations. For visual changes, inspect the rendered screenshots as well as running relevant checks.

## npm releases

2.1 Publish `ai-appshots` through `.github/workflows/release.yml`, using the repository's `NPM_TOKEN` Actions secret. `actions/setup-node` reads it through `NODE_AUTH_TOKEN`. This is the same token-based pattern used by `thiagoperes/ai-translate`.

2.2 Never use Chrome, another browser, `npm login`, passkeys, security keys, OTP prompts, or interactive authentication helpers to publish. Do not overwrite local npm credentials as a fallback. The user explicitly requires token-based publishing.

2.3 Check the release workflow and secret metadata first. GitHub repository secrets are not shared automatically and their values cannot be read back. If `NPM_TOKEN` is missing or lacks publishing access to `ai-appshots`, report that specific problem; do not switch authentication methods or expose credentials in logs, artifacts, or source control.

2.4 Publish an existing `v<package.json version>` tag only after CI succeeds for that exact commit. The Release workflow supports tag pushes and manual dispatch with a tag input. It skips versions already on npm and publishes the packed tag contents with provenance.

2.5 Verify npm's version, `latest` tag, and artifact integrity after publishing. Keep the GitHub release, npm package, and README consistent. Never overwrite or move an already published release tag.

2.6 The established ai-translate token has Bypass 2FA enabled but is scoped only to `@ai-translate`; it cannot publish `ai-appshots`. As of 2026-09-05, this repository has no `NPM_TOKEN` Actions secret. Future releases need that secret set to a token with read/write access to `ai-appshots` and Bypass 2FA enabled. Check the global instructions for the private local token location; never copy its value into this repository.

2.7 For manual publication, dispatch the Release workflow from the release tag itself and provide that same tag as the input. This keeps npm provenance tied to the commit being published. Dispatching from main is safe only for checking a version that is already published.
