# Design

## Look: Liquid Glass (helper app, Oct 2026)

Chosen Oct 22 2026 to replace Midnight & Amber on the helper side: modern,
clean, room for many future features. Frosted see-through cards over soft
color blobs, light and dark; the app follows the phone's setting and keeps
the Appearance switch (Automatic / Light / Dark). Picked from four modern
directions made with the ui-ux-pro-max design skill; mockups:
https://claude.ai/artifact/PGUQsN3VoS1sbJa2qThgqj ("Modern helper" page).

| Token | Light | Dark | Use |
|---|---|---|---|
| bg | `#EEF1F8` | `#070B14` | page, under the color blobs |
| surface | white 62% | white 7% | glass cards (blur 24px) |
| surface-2 | white 78% | white 12% | secondary buttons, quotes |
| fg / ink | `#0B1220` | `#F1F4FA` | text, primary buttons |
| muted | `#475467` | `#A9B4C7` | secondary text |
| amber (accent) | `#EA580C` | `#FF8A3D` | needs-help glow, avatars, "you're tapping" |
| blobs | blue / peach / mint | deep blue / rust / teal | background color |

- Type: **Geist** (Google Fonts), 400-700.
- Wordmark: "My Tech Kid" with an orange period.
- The "needs help" card is always the loudest thing: glass with an orange
  border and glow.
- Source of truth in code: `web/src/styles.css`. The remote screen
  (`#watch`) stays always dark.
- Mom's side will move to **Warm Home** (terracotta, cream, olive; Varela
  Round + Nunito Sans), same mockup canvas, "First looks" page. Not built yet.

## Mom's app

Same colors, but big, calm and high-contrast; no settings on her phone.
**Current: design 9, "Today's Date"** from `mom-picks.html` (light ground
`#EEF2F8`, day and date + "Good morning/afternoon/evening, Mom", big navy
help button with an amber initial, white "Is this a scam?" button with an
amber shield). Chosen by the owner for now; Mom's own feedback comes later.
Code: `android/app/src/main/java/com/amethos/mytechkid/ui/Screens.kt`.

## Motion

Small, warm, and only on first appearance; never in the way.

- Helper app: a 4-panel story for new visitors (Mom is "typing…", then her
  text lands; the scam text buzzes; the final logo's amber dot drops in and
  bounces), staggered entrances on each new screen, help and scam cards
  bounce in when they arrive (the help card keeps a soft amber pulse), and
  confetti with a self-drawing check mark when a parent is linked.
- Mom's app: the big help button bounces in, the scam button a beat later;
  a breathing dot while her request goes out.
- Everything respects the phone's "Reduce motion" / "Remove animations".
  Code: the Motion section at the end of `web/src/styles.css`, `popIn` in
  `Screens.kt`.

## Files here

- `mockups/` — design canvas files (open in the Claude design canvas):
  original screens, the restyle explorations (`Style*.dc.html`), and the
  landing page (`Main.dc.html`, Midnight & Amber version).
- `mom-picks.html` — the page sent to Mom with 10 numbered designs.

Live versions (owner's Claude account):
- Design canvas: https://claude.ai/artifact/JJ2wsqWtCRZqqjaP9qxHpj
- Mom's picks: https://claude.ai/artifact/SsbFZH9LKDgEsxUK85ieb5
