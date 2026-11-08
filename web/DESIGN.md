# StockPilot UI: design decisions

## How the skills were chosen

The UI Skills MCP server (`https://www.ui-skills.com/mcp`, server "UI Skills" v0.2.4) was queried over its streamable-HTTP endpoint with JSON-RPC calls:

1. `tools/call list_skills` returned the registry of 804 skills.
2. `tools/call get_skill ibelick/ui-skills-root` returned the routing skill. Its rules: pick the smallest useful set, prefer specific over broad, never more than 3 for a build, plus focused review skills.
3. `get_skill` was then called for:

| Skill (registry path) | Why it was picked |
|---|---|
| `dammyjay93/interface-design` | The registry's skill for "dashboards, admin panels, SaaS apps, tools, data interfaces". It sets direction, hierarchy, tokens and states. |
| `wshobson/tailwind-design-system` | The project uses Tailwind v4; this skill covers CSS-first `@theme` tokens. |
| `ibelick/baseline-ui` | Hard constraints that keep the UI from looking generated (typography, states, animation, accessible primitives). |
| `ibelick/fixing-accessibility` | Rules for forms, dialogs and keyboard access, applied while building. |

Note on installation: the workspace MCP config (`.kiro/settings/mcp.json`) is write-protected in this environment, so the agent could not register the server there. The same MCP tools (`list_skills`, `get_skill`) were called directly over HTTP. To use the server from the IDE, add `{"mcpServers":{"ui-skills":{"url":"https://www.ui-skills.com/mcp"}}}` to `.kiro/settings/mcp.json` or `~/.kiro/settings/mcp.json`.

## Direction (interface-design: "Intent first")

- **Who:** a warehouse or counter worker between deliveries and pick lists, and a manager fixing the catalogue. They are on their feet and in a hurry.
- **What they must do:** see what can be sold right now, reserve it, receive deliveries, and react to shortages.
- **Feel:** a stockroom ledger. It is dense, calm and factual, like printed bin labels.
- **Domain words:** bin label, shelf, pick ticket, ledger, receiving dock, stock take, reorder point.
- **Colour world:** label-paper off-white, stencil-ink black, steel-grey racking, kraft brown, and safety-amber hazard tape.
- **Signature element:** the **stock gauge** (`src/components/stock-gauge.tsx`). It is a bin-fill bar: solid for available stock, **hatched** for stock that is reserved (on the shelf but promised), and a tick at the reorder point. It answers "can I sell this, and how close to reordering is it" at a glance. It appears on every stock row, and its colour turns amber when the product is low.
- **Defaults rejected:**
  - Blue/purple SaaS accent → ink-black primary, plus *one* accent (safety amber) used only for "needs attention".
  - Metric-card dashboard grid → a ledger table as the home screen. The table *is* the product.
  - Inter → IBM Plex Sans plus IBM Plex Mono for SKUs and quantities (an industrial typeface family, self-hosted so the CSP stays `'self'`).

## Decisions and their sources

| Decision | Where | Source skill / rule |
|---|---|---|
| Tokens in `@theme` (OKLCH), semantic names (`paper`, `sheet`, `well`, `shelf`, `ink-1..4`, `rule`, `amber`, `go`, `stop`) | `src/styles.css` | tailwind-design-system ("CSS-first config", "semantic tokens"); interface-design ("token names should evoke the world") |
| One hue for all surfaces, shifting only lightness. Inputs (`well`) are slightly *darker* than panels | `styles.css` | interface-design ("Surface elevation", "Inputs are inset") |
| Four text levels (`ink`, `ink-2`, `ink-3`, `ink-4`) | `styles.css` | interface-design ("Text hierarchy: four levels") |
| Borders-only depth: low-opacity rules `rgba`-style (`--color-rule` at 10%). The only shadow is on dialogs | `ui.tsx`, `dialogs.tsx` | interface-design ("choose ONE depth strategy", "borders should disappear") |
| Sidebar uses the same background as the canvas, separated by a rule | `app-shell.tsx` | interface-design ("Sidebars: same background as canvas") |
| One focal point per view: the **Available** column is bold `ink`; on hand and reserved are muted | `stock-page.tsx` | interface-design ("One focal point", "weight beats size") |
| Scale: 11/13/14/22 px with weight and colour doing the hierarchy work | components | interface-design ("type scale is a ratio") |
| `tabular-nums` on every number column; SKUs in mono | `Td numeric`, `Sku` | baseline-ui ("MUST use tabular-nums for data"); interface-design ("tabular numbers") |
| `text-wrap: balance` on headings and `pretty` on paragraphs; antialiased root | `styles.css` | baseline-ui (typography); interface-design (font smoothing) |
| No animation | everywhere | baseline-ui ("NEVER add animation unless explicitly requested") |
| No gradients and no glow. The only pattern is the hatching, which carries meaning (reserved) | `styles.css .hatch` | baseline-ui (design); interface-design ("colour should mean something") |
| `h-dvh`, never `h-screen` | `app-shell.tsx` | baseline-ui (interaction) |
| Fixed z-index scale: Tailwind `z-40` backdrop, `z-50` popup only | `dialogs.tsx` | baseline-ui (layout) |
| `cn()` = `clsx` + `tailwind-merge` | `lib/format.ts` | baseline-ui (stack) |
| Dialogs and confirmations use **Base UI** `Dialog` / `AlertDialog`, so focus trap, Escape, focus return and ARIA come from the library | `components/dialogs.tsx` | baseline-ui ("accessible primitives", "prefer Base UI", "AlertDialog for destructive actions"); fixing-accessibility §3 |
| Cancelling an order and deactivating a product go through an AlertDialog | orders, products pages | baseline-ui |
| Native `<button>`, `<select>`, `<input>`; no clickable divs | everywhere | fixing-accessibility §2, §4; interface-design ("native first") |
| `Field` wires `label[for]`, `aria-describedby` and `aria-invalid`; errors sit under the field that caused them | `ui.tsx` | fixing-accessibility §5; baseline-ui ("show errors next to where the action happens") |
| Form-level errors use `role="alert"`; skeletons use `role="status" aria-busy` | `FormError`, `TableSkeleton` | fixing-accessibility §6 |
| Submit buttons are disabled only while a request is pending. Invalid input is explained on submit instead of disabling the button silently. "Remove" on the last line explains via `title` | stock and order forms | fixing-accessibility ("disabled submit actions must explain why") |
| Icon-free controls with text labels; the decorative logo has `alt=""` | sidebar, login | fixing-accessibility §1, §8 |
| Visible focus ring (`:focus-visible` 2 px ink outline) | `styles.css` | fixing-accessibility §7 |
| Small table buttons extend their hit area with `::after` | `Button size="sm"` | interface-design ("hit areas 40px minimum") |
| Every data view has loading (skeleton), empty (one next action) and error (retry) states | all pages | baseline-ui ("empty states: one clear next action", "structural skeletons"); interface-design ("states are not optional") |
| Accent limited to one per view (amber = low stock or open alerts) | stock, alerts, nav badge | baseline-ui ("limit accent colour to one per view") |
| Radius scale 4 / 6 / 10 px (chips / controls / panels and dialogs) | `styles.css` | interface-design ("border radius: a scale") |

## Checks run (interface-design "before showing")

- **Squint test:** the Available numbers and the amber "Low" chips stand out. Rules and secondary numbers drop back.
- **Swap test:** replacing the gauge with a plain number column, or Plex with Inter, would visibly change the product. Those choices carry meaning.
- **Token test:** `paper`, `sheet`, `well`, `shelf`, `ink`, `amber` read as a stockroom, not as a generic template.
- **Visual check:** headless Chrome screenshots at 1360 px of sign-in, stock, the receive form with validation, orders with an inline line error, alerts, products and the product editor. Two issues were fixed after review: the "reorder at" label wrapped (column widened, `nowrap`), and an oversized quantity produced a generic "Request is invalid" message (it is now validated per line, and server field errors are mapped onto lines).

## Review pass 2: narrow screens and web guidelines

For a review of the existing UI, the MCP was queried again (`list_skills` with `audit`, `polish` and `responsive`). Following the router's limit of 3, these were loaded with `get_skill`:

| Skill | Used for |
|---|---|
| `pbakaus/adapt` | Desktop to phone and tablet adaptation |
| `jakubkrehel/better-interface` | Severity ranking. "Content or a control clipped or unreachable at 320px" is an automatic HIGH |
| `vercel-labs/web-design-guidelines` | Rule checklist, fetched from its source URL |

**Measured before the fix** (headless Chrome, signed in as staff):
- At 320px the content column was **96px** wide, because the 224px sidebar never collapsed.
- The Stock page overflowed the screen by 665px at 320px and by 217px at 768px. Stock actions were off-screen. **HIGH.**

**Fixes:**

| Finding | Severity | Fix | Rule |
|---|---|---|---|
| Fixed sidebar eats phone screens | HIGH | Below `md`, a compact header: brand and sign-out on top, sections as tabs underneath (same links, same badge) | adapt: navigation adaptation, single column |
| Tables wider than the screen hide actions | HIGH | Below `md` (Stock: below `lg`, its table is widest), each row becomes a card with the same data and every action. The gauge and the Available number stay the focal point | adapt: "tables → cards on mobile"; "never hide core functionality" |
| New-order line grid cramped at 320px | MEDIUM | Product select full width, quantity and Remove underneath | adapt: vertical stacking |
| Inputs at 14px make iOS Safari zoom on focus | MEDIUM | `text-base` below `sm` | adapt: 16px minimum on mobile |
| No skip link | MEDIUM | "Skip to content" link targeting `#main` | guidelines: accessibility |
| Search placeholders and attributes | LOW | `…`, `autoComplete="off"`, `spellCheck={false}` | guidelines: forms |
| Tap delay and scroll chaining in dialogs | LOW | `touch-action: manipulation`, `overscroll-behavior: contain` on dialogs | guidelines: touch |
| Safe-area insets had no effect | LOW | `viewport-fit=cover` plus `env(safe-area-inset-*)` padding on header and main | adapt: safe areas |

**Verified after the fix:** horizontal overflow is 0px on Stock and Orders at 320, 390, 768 and 1360px, and the new-order dialog fits at 320px. The desktop layout is unchanged.

**Not verified:** behaviour on a real iOS or Android device and with real touch input. Only an emulated Chromium viewport was used.
