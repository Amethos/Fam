# Design

## Look: Midnight & Amber

Chosen for the helper app (grown-up, calm, professional; helpers are adults
40-60). Dark and light versions; the app follows the phone's setting and
has an Appearance switch (Automatic / Light / Dark).

| Token | Light | Dark | Use |
|---|---|---|---|
| background | `#F3F5F9` | `#0E1726` | page |
| surface | `#FFFFFF` | `#17233A` | cards |
| surface-2 | `#E9EEF5` | `#24324D` | secondary buttons, info |
| line | `#DCE2EC` | `#33425E` | borders |
| text | `#0E1726` | `#EEF2F8` | |
| muted | `#4A5568` | `#9AA8BD` | secondary text |
| amber | `#F2B33D` | `#F2B33D` | brand, primary buttons, "needs help" card |
| amber text | `#8A5A00` | `#F2B33D` | small amber labels (readable on light) |
| navy | `#0E1726` | `#0E1726` | text/buttons on amber |

- Type: **Manrope** (Google Fonts), 400-800.
- Wordmark: "My Tech Kid" with an amber period. App icon: "tk." on navy.
- The amber "needs help" card is always the loudest thing on screen.
- Source of truth in code: `web/src/styles.css`.

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
