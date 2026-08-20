# 9Router Design System

## 1. Atmosphere & Identity

9Router feels like a dense local command center for provider routing: practical, dark-first, compact, and instrumentation-heavy. The signature is a quiet control-panel surface system: cards, modals, badges, and live status rows use muted borders, restrained accent color, and small technical labels so operators can scan quickly without visual noise.

## 2. Color

### Palette

| Role | Token | Light | Dark | Usage |
|------|-------|-------|------|-------|
| Surface/primary | `bg-background` | project token | project token | Main page background |
| Surface/secondary | `bg-surface` | project token | project token | Cards, panels, modal bodies |
| Surface/tertiary | `bg-sidebar` | project token | project token | Nested summaries and previews |
| Text/primary | `text-text-main` | project token | project token | Headings, labels, body text |
| Text/secondary | `text-text-muted` | project token | project token | Hints, metadata, helper text |
| Border/default | `border-border` | project token | project token | Cards, inputs, modal dividers |
| Accent/primary | `text-primary`, `bg-primary` | project token | project token | Primary actions, selected states, icons |
| Accent/subtle | `bg-primary/5`, `bg-primary/10` | project token | project token | Hover and selected background states |
| Status/success | `text-green-400`, `bg-green-500/10` | project token | project token | Successful imports/connections |
| Status/warning | `text-amber-200`, `bg-amber-900/20` | project token | project token | Manual assist, recoverable prompts |
| Status/error | `text-red-400`, `bg-red-500/10` | project token | project token | Failed jobs and validation errors |
| Status/info | `text-blue-200`, `bg-blue-900/20` | project token | project token | Explanatory automation guidance |

### Rules

- Prefer existing Tailwind theme tokens over raw hex/rgb values.
- Accent is functional: selected provider, primary action, focus ring, or icon emphasis.
- Status colors only appear in feedback blocks, badges, or job state messaging.

## 3. Typography

### Scale

| Level | Size | Weight | Line Height | Tracking | Usage |
|-------|------|--------|-------------|----------|-------|
| H1 | `text-2xl` | `font-semibold` | default | default | Dashboard page title |
| H2 | `text-lg` | `font-semibold` | default | default | Panel title |
| Body | `text-sm` | regular/medium | `leading-relaxed` when descriptive | default | Forms and panel descriptions |
| Caption | `text-xs` | regular/medium | default | default | Hints, status metadata |
| Micro label | `text-[11px]` | medium/semibold | default | `tracking-wide` when uppercase | Summary cards |

### Font Stack

- Primary: inherited app/system sans stack.
- Mono: inherited app monospace stack for keys, tokens, URLs, and job IDs.

### Rules

- Body text stays at `text-sm` or larger; only metadata uses `text-xs`.
- Technical values use `font-mono` only when scan accuracy matters.

## 4. Spacing & Layout

### Base Unit

All spacing derives from 4px.

| Token | Tailwind | Value | Usage |
|-------|----------|-------|-------|
| Space 1 | `gap-1`, `p-1` | 4px | Tight icon/label rhythm |
| Space 2 | `gap-2`, `p-2` | 8px | Inline control groups |
| Space 3 | `gap-3`, `p-3` | 12px | Feedback blocks |
| Space 4 | `gap-4`, `p-4`, `px-4`, `py-3` | 16px | Cards, buttons, form rows |
| Space 6 | `gap-6`, `p-6` | 24px | Modal body and page groups |

### Grid

- Provider option grids use `sm:grid-cols-2` and `xl:grid-cols-3`.
- Dashboard cards keep `rounded-lg` or `rounded-xl` with `border-border`.
- Modal content uses a single-column mobile flow and two-column form layout from `sm`.

### Rules

- New controls follow existing rounded card/button geometry.
- Use responsive grid utilities already present in the dashboard; do not introduce new layout systems.

## 5. Components

### Automation Action Card

- **Structure**: button card with `material-symbols-outlined` icon, semibold title, muted description.
- **Variants**: selected provider card, neutral action card.
- **Spacing**: `gap-2`, `px-4`, `py-3`, `min-h-[112px]`.
- **States**: default border, hover `border-primary/40 bg-primary/5`, selected `border-primary/50 bg-primary/10`.
- **Accessibility**: native `button` element with visible text label.
- **Motion**: color transition only via `transition-colors`.

### Automation Modal

- **Structure**: `Modal` shell, explanatory info block, form fields, status/job panel, footer actions.
- **Variants**: initial form, running job, finished job, error state.
- **Spacing**: `gap-4`, `p-3`, `p-4`.
- **States**: disabled primary action while required fields are missing or a job is starting.
- **Accessibility**: labels for every form field; error text rendered near the action.
- **Motion**: modal behavior inherited from shared component.

## 6. Motion & Interaction

### Timing

| Type | Duration | Easing | Usage |
|------|----------|--------|-------|
| Micro | existing `transition-colors` | default | Button and card hover |
| Standard | shared modal default | default | Modal open/close |

### Rules

- Do not animate layout properties.
- Every clickable card/button keeps hover and disabled states.
- Long-running jobs update via polling instead of animated progress illusions.

## 7. Depth & Surface

### Strategy

Borders-only with subtle tonal shifts.

| Type | Token | Usage |
|------|-------|-------|
| Default border | `border border-border` | Cards, modals, inputs |
| Subtle nested surface | `bg-sidebar` | Job summary and preview containers |
| Feedback surface | status `bg-*/10` or `bg-*/20` | Info/warning/error panels |

Shadows are not introduced for dashboard automation controls; depth is communicated by border, radius, and background tone.
