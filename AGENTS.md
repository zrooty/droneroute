# Agent conventions

Rules for AI agents working on this codebase.

## Solo workflow

Personal fork, single user — commit and push directly to `main`. No feature branches, no PRs.

Lefthook pre-commit hook still runs `prettier --check` and `oxlint` on staged files — fix with `npm run fmt` if it fails. Run `npm run build` locally before pushing to catch errors before CI does.

<!-- BEGIN:specs-sync-rules -->

## Spec documentation sync — MANDATORY

The `specs/` folder contains plain-language descriptions of every feature from the user's perspective. **If a commit adds, removes, or changes any user-facing feature, the corresponding spec file in `specs/` must be updated.** Treat outdated specs the same as a missing changelog entry.

See `specs/README.md` for the full index.

<!-- END:specs-sync-rules -->

## Text casing

Use **sentence case** for all user-visible strings: labels, buttons, headings, descriptions, dropdown options, tooltips, and section titles.

- Capitalize only the first word and proper nouns/acronyms.
- Abbreviations like WP, POI, KMZ, RTH, CW, CCW, EGM96, MSL stay uppercase.
- Brand names like DroneRoute and DJI keep their casing.

Good: `"Grid survey"`, `"Heading mode"`, `"Go to first WP"`, `"Above ground level"`
Bad: `"Grid Survey"`, `"Heading Mode"`, `"Go to First WP"`, `"Above Ground Level"`

This applies to both source code and documentation (GUIDE.md, README.md).
Markdown section headings (`## Like This`) may use standard title case since they are structural, not UI text.

## Package versioning

The `droneroute` npm package (`packages/cli`) must always have the same version as the root workspace and the other packages. When bumping the version, update `packages/cli/package.json` to match.

## Public page

The "public page" refers to the GitHub Pages site hosted from the `gh-pages` branch — not the app's AboutDialog or SharedMissionPage. When asked to change the public page, switch to the `gh-pages` branch and edit its static assets.

## Screenshots

All application screenshots are taken at these coordinates: 41.25797725781744, 0.9322907667035154.

<!-- BEGIN:env-safety-rules -->

## Environment variable safety — MANDATORY

- **Never commit `.env` files** — they are in `.gitignore`
- **JWT_SECRET must be cryptographically random** in production — never use default or placeholder values
- **Database paths** should use the `/app/data/` mount in Docker, never a hardcoded host path
- **Before running ANY script that writes to a database**, verify the target. If it contains a remote host, STOP and confirm with the user
- **CORS origins** should be explicitly configured — never `*` in production

<!-- END:env-safety-rules -->

<!-- BEGIN:security-rules -->

## Security — MANDATORY

**Every API route that handles user data MUST validate the JWT token via middleware as its first operation.** All DB queries for user-specific data must be scoped with the authenticated user's ID from the JWT. Never accept a `userId` parameter from the client for authorization purposes.

**Never expose raw errors, stack traces, or internal paths to the client.** Log errors server-side and return generic messages to clients.

**All file uploads (KMZ/WPML) MUST be validated** — check file extension, MIME type, and enforce maximum file size. Never use user-supplied filenames directly on the filesystem.

**SQL queries must always use parameterized statements.** The backend uses `better-sqlite3` — always use `?` placeholders, never string concatenation.

Full security patterns are in the `security` OpenCode skill.

<!-- END:security-rules -->

<!-- BEGIN:github-issues-rules -->

## GitHub Issues tracking

All tasks, features, and bugs are tracked as **GitHub Issues** (not a local TODO file). Use `gh issue list` at the start of every session to understand what's open.

When a commit resolves an issue, reference it in the commit message (`Fixes #N`) so GitHub auto-closes it.

<!-- END:github-issues-rules -->

<!-- BEGIN:task-completion-rules -->

## Task completion workflow

When executing a multi-step plan (e.g., the user says "proceed" or "do it"), **always include committing and pushing as the final steps in the todo list**. The user expects code changes to be deployed — don't stop at "build passes".

Final todos should be:

1. ... (all implementation steps)
2. Commit changes with a descriptive message
3. Push to remote

<!-- END:task-completion-rules -->
