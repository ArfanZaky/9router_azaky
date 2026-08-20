# GitHub Workflows

## discord-announce.yml

Auto-posts a release announcement to Discord after the
`Build CLI & Publish to npm` workflow completes successfully on `master`.

### Setup

1. In your Discord server, create a webhook for the channel that should
   receive announcements:
   - Channel settings → Integrations → Webhooks → New Webhook
   - Copy the webhook URL.
2. In GitHub, add the URL as a repository secret:
   - Repo settings → Secrets and variables → Actions → New repository secret
   - Name: `DISCORD_WEBHOOK_URL`
   - Value: the full Discord webhook URL.
3. Push a release commit that bumps `package.json#version`. After the npm
   publish workflow succeeds, the announce workflow reads the matching
   `# vX.Y.Z` section from `CHANGELOG.md`, formats it into the project's
   announcement template, and POSTs it to the webhook.

### Output format

```
@everyone
## <TYPE> UPDATE v<VERSION>
[NEW]
- ...
[FIX]
- ...
[IMPROVEMENT]
- ...

run ```npm update -g 9router```
```

`<TYPE>` is `MAJOR UPDATE` / `FEATURE UPDATE` / `HOTFIX UPDATE` /
`PATCH UPDATE`, picked from the version bump shape and CHANGELOG content.

### Local preview

```
node scripts/discord-announce.mjs 0.4.85
```

The script writes `discord-payload.json` next to `CHANGELOG.md` and prints
the rendered Discord content. Re-run with a different version argument to
preview different sections.

### Skipping a release

If you bump the version but don't want to announce (e.g. internal-only
fix), do not publish that version to npm yet, or temporarily remove the
`DISCORD_WEBHOOK_URL` secret before re-running the announce workflow.
