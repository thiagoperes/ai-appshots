# Project instructions

1.1 Follow the user's global instructions. Do not add usage examples or documentation unless requested. Use numbered items when reporting results.

1.2 Run commands non-interactively as one-shot operations. For visual changes, inspect the rendered screenshots as well as running relevant checks.

## npm releases

2.1 Publish `ai-appshots` through `.github/workflows/release.yml` with npm trusted publishing: the job's GitHub OIDC identity is exchanged for a one-time publish credential. No npm token is stored anywhere. The package's trusted publisher on npmjs.com names user `thiagoperes`, repository `ai-appshots`, and workflow `release.yml`; renaming the workflow file breaks publishing until that setting is updated.

2.2 Never use Chrome, another browser, `npm login`, passkeys, security keys, OTP prompts, or interactive authentication helpers to publish. Do not create, request, or store npm tokens as a fallback. As of 2026-09-30 npm rejects writes from tokens without 2FA bypass, and is restricting tokens that bypass it.

2.3 If publishing fails with an authentication error, report it: the trusted publisher on npmjs.com is missing or no longer matches the repository and workflow. Only the user can change that setting.

2.4 Publish an existing `v<package.json version>` tag only after CI succeeds for that exact commit. The Release workflow supports tag pushes and manual dispatch with a tag input. It skips versions already on npm and publishes the packed tag contents with provenance.

2.5 Verify npm's version, `latest` tag, and artifact integrity after publishing. Keep the GitHub release, npm package, and README consistent. Never overwrite or move an already published release tag.

2.6 For manual publication, dispatch the Release workflow from the release tag itself and provide that same tag as the input. This keeps npm provenance tied to the commit being published. Dispatching from main is safe only for checking a version that is already published.
