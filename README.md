# 9Router WYx0

WYx0 fork of 9Router focused on provider automation, multi-account workflows, and quota tracking for coding agents.

This repository is forked from [decolua/9router](https://github.com/decolua/9router). The upstream project remains the base AI router. This fork documents and ships the WYx0 changes on top: Kiro automation, CodeBuddy automation, quota tracker upgrades, and small dashboard quality-of-life updates.

## Focus

- Kiro bulk login automation with browser-assisted Google account flow.
- CodeBuddy bulk login automation that completes onboarding and generates a saved Access Key.
- CodeBuddy chat through generated Access Keys, with IDE OAuth metadata retained for supported upstream quota reads.
- Quota Tracker improvements, including provider pagination and single-account/bulk display modes.
- Provider UX polish: CodeBuddy icon, provider icon fallback, Discord link, connection status filtering, and related dashboard updates.
- Safer provider workflows: token refresh handling, account fallback, request detail compaction, and focused tests around the new automation paths.

## What Changed In This Fork

### Automation

- Added `/dashboard/automation` as the entry point for bulk provider workflows.
- Added Kiro bulk import routes and services for browser-based account onboarding.
- Added CodeBuddy bulk import routes and services, including Google login, onboarding, OAuth polling, and Access Key creation.
- CodeBuddy automation only finishes successfully after the generated key is stored in the provider connection.
- Existing CodeBuddy Access Keys are reused instead of generating duplicates.
- A restricted CodeBuddy page no longer immediately ends the worker; automation attempts the Access Key request with the authenticated browser session and reports the actual API result.
- Added reusable browser automation helpers for Google login, provider onboarding, region selection, privacy prompts, and manual follow-up.

### Quota Tracking

- Added CodeBuddy to supported usage providers.
- Added CodeBuddy quota parsing for credit packages such as monthly, gift, extra, and activity credits.
- Added IDE OAuth identity capture (`uid` and enterprise metadata) for supported CodeBuddy upstream quota requests.
- Generated-key or restricted accounts without a valid IDE OAuth token use 9Router Usage for locally observed request/token tracking.
- Added Quota Tracker pagination and a display mode switch for single-account versus bulk provider views.

### Provider And Dashboard Polish

- Added CodeBuddy visual assets and provider icon fallback behavior.
- Added a Discord shortcut in the header pointing to [dsc.gg/wyxhub](https://dsc.gg/wyxhub).
- Improved connection status utilities and provider table ergonomics for automation-heavy workflows.
- Added supporting tests for Kiro/CodeBuddy import managers, route behavior, connection status, and account fallback.

## CodeBuddy Quota Note

CodeBuddy uses two separate credentials:

- **Generated Access Key:** used for chat/model requests.
- **IDE OAuth token:** retained with `uid` and enterprise identity metadata for upstream quota requests when CodeBuddy accepts the session.

Restricted accounts may have a working generated Access Key while CodeBuddy rejects their IDE OAuth token for quota access. In that case chat remains available, Quota Tracker reports that upstream quota is unavailable, and `Dashboard -> Usage` remains the source for locally observed requests and token totals. The tracker does not retry stale web cookies or invent quota values.

## Install From npm

Requirements: Node.js 18 or newer.

Run without a permanent installation:

```bash
npx wyxrouter
```

Or install the CLI globally:

```bash
npm install -g wyxrouter
wyxrouter
```

The published package installs the bundled dashboard and runtime. The CLI creates its runtime data under the user's 9Router home directory and starts the local dashboard.

## Run From Source

```bash
git clone https://github.com/Wisyam/9router_wyx0.git
cd 9router_wyx0
cp .env.example .env
npm install
npm run dev
```

Default local URLs:

- Dashboard: `http://localhost:20128/dashboard`
- OpenAI-compatible API: `http://localhost:20128/v1`
- Automation: `http://localhost:20128/dashboard/automation`
- Quota Tracker: `http://localhost:20128/dashboard/quota`

Production build:

```bash
npm run build
PORT=20128 HOSTNAME=0.0.0.0 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run start
```

## Build The npm Bundle

The npm package name is `wyxrouter`. Build and pack the CLI bundle from the repository:

```bash
cd cli
npm install
npm run pack:cli
```

This runs the CLI bundle builder and writes a `wyxrouter-<version>.tgz` package in the repository root. Test the generated package locally with:

```bash
npm install -g ./wyxrouter-<version>.tgz
wyxrouter
```

Maintainers can publish from `cli/` with:

```bash
npm run publish:cli
```

## Verification

Recommended checks before opening a PR:

```bash
npm run build
```

Focused unit tests may be run when the local test setup is available:

```bash
npm test -- kiro
npm test -- codebuddy
```

## PR Scope

This fork's current PR scope is intentionally centered on WYx0 changes:

- Add Kiro automation.
- Add CodeBuddy automation.
- Add CodeBuddy quota usage support.
- Add quota tracker pagination and bulk/single view behavior.
- Update README and metadata to describe this fork instead of the upstream product pitch.

## Upstream Credit

9Router WYx0 builds on the original 9Router project by decolua. Keep upstream credit and license notices intact when redistributing or merging changes.
