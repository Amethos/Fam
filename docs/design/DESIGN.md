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
- The parent's side uses **Warm Home** (below).

## The parent's app: Warm Home (Oct 2026)

Big, calm and high-contrast; no settings on their phone. Picked by the owner
from the "First looks" page of the mockup canvas
(https://claude.ai/artifact/PGUQsN3VoS1sbJa2qThgqj).

| Token | Color | Used for |
| --- | --- | --- |
| Ground | `#F5F0E1` cream | background |
| Card | `#FFFBF3` | cards, the "Yes" question |
| Clay | `#A3532F` terracotta, text `#FFF8EE` | help button, main buttons, initials |
| Olive | `#5C6B30` | day name, scam shield |
| Sand | `#E8DCC4` | "Is this a scam?" button |
| Ink / Muted | `#3B2A20` / `#6B5444` | text |
| Green / Red | `#1F6B45` / `#9C2F1E` | yes and safe / stop |

- Type: **Varela Round** for headings and the help button, **Nunito Sans**
  (400/700/800) for the rest. Bundled in `android/app/src/main/res/font`
  (Latin subset; licenses in `android/third_party/fonts`), sizes in sp so
  they follow the phone's font size.
- Home: day name (olive), big date, "Good morning, Pat", then the terracotta
  "Get help / from Josh" button and the sand "Is this a scam?" button with an
  olive shield and check mark.
- Earlier look: design 9 "Today's Date" (navy and amber), in `mom-picks.html`.
- Code: `android/app/src/main/java/com/amethos/mytechkid/ui/Screens.kt`, plus the
  "Yes" question and Stop banner in `RemoteControlService.kt`.

## Motion

Small, warm, and only on first appearance; never in the way.

- Helper app: a 4-panel story for new visitors (Mom is "typing…", then her
  text lands; the scam text buzzes; the final logo's amber dot drops in and
  bounces), staggered entrances on each new screen, help and scam cards
  bounce in when they arrive (the help card keeps a soft amber pulse), and
  confetti with a self-drawing check mark when a parent is linked.
- The parent's app: the big help button fades and settles in slowly (no bounce), the scam button a beat later;
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
