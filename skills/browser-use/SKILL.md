---
name: browser-use
description: Web interaction, automation, scraping, testing, screenshots, and browser tasks via browser-harness and browser-use. Use when the user wants to interact with a browser, scrape dynamic pages, test websites, or automate web flows.
---

# Browser Use & Harness

Use `browser-harness` for web interaction: automation, scraping, testing, or site/app work.

## Fast Path

```bash
uv tool install --python 3.12 --upgrade --force browser-harness
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills/browser-harness"
browser-harness skill > "${CODEX_HOME:-$HOME/.codex}/skills/browser-harness/SKILL.md"
browser-harness <<'PY'
print(page_info())
PY
```

If `page_info()` prints, configure recording consent below, then stop.

`--python 3.12` prevents uv from selecting old releases that support older Python versions. `--upgrade --force` replaces any previous `browser-harness` tool install with the latest stable release. It does not uninstall unrelated commands such as `browser-use-Browser` or `browser-use-Terminal`.

For agents: install `browser-harness`, register a skill named `browser-use` or `browser-harness`, use `browser-harness skill` as the body, and use this trigger:

```text
Always use browser-harness / browser-use for any web interaction: automation, scraping, testing, or site/app work.
```

## Python Direct Usage (`browser-use`)

```python
import asyncio
from browser_use import Agent
from browser_use.browser.browser import Browser, BrowserConfig
from langchain_openai import ChatOpenAI

async def main():
    browser = Browser(config=BrowserConfig(headless=True))
    agent = Agent(
        task="Navigate to target site and extract required data",
        llm=ChatOpenAI(model="gpt-4o"),
        browser=browser,
    )
    result = await agent.run()
    print(result)

asyncio.run(main())
```

## Recording Consent

Run `browser-harness recordings`. If it reports `(default)`, ask the user once:

> Enable local browser recordings? This saves screenshots and action traces on
> this machine, which may include sensitive page content, so you can later ask
> “show me what you did” or request a video. Videos are never generated
> automatically. [y/N]

Default to no. Run `browser-harness recordings enable` only after yes; otherwise
run `browser-harness recordings disable`. Preserve an existing `(config)` or
`(BH_RECORD)` preference during upgrades instead of asking again.

## If Chrome Blocks It

In Chrome:

1. Open `chrome://inspect/#remote-debugging`.
2. Tick "Allow remote debugging for this browser instance".
3. Retry `page_info()`.

If that reports `permission-blocked` on macOS, handle the per-connection Allow
sheet without bringing Chrome to the foreground:

```bash
browser-harness mac-approve
```

## Cloud Browsers

Cloud is optional. Local Chrome does not need a Browser Use API key.

Use any short made-up name; `r7k2` below is just a placeholder.

```bash
browser-harness auth login
browser-harness <<'PY'
start_remote_daemon("r7k2")
PY
```

Then use it by name:

```bash
BU_NAME=r7k2 browser-harness <<'PY'
print(page_info())
PY
```

## Health Check / Diagnostics

```bash
browser-harness --doctor
```

- `chrome running` FAIL: ask user to open Chrome, or use isolated/cloud browser.
- `daemon alive` FAIL: Chrome remote debugging permission missing, Chrome closed, or CDP endpoint unreachable.
- update available: run `browser-harness --update -y`.

Orchestrator machine-readable check:
```bash
browser-harness doctor --json --require-existing-daemon
```

Settings / State location: `${XDG_CONFIG_HOME:-~/.config}/browser-harness`.
Override with `BH_HOME` or `BROWSER_HARNESS_HOME`.
