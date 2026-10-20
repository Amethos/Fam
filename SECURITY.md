# Security

My Tech Kid will let a family member see and control a parent's phone. That
makes it exactly the kind of tool scammers abuse, so security comes before
features. Every change is checked against this page.

## Who we defend against

1. **Phone scammers** who talk a parent into installing or opening something
   ("I'm from the bank / Microsoft / your grandson's new number").
2. **Strangers on the internet** trying to reach the backend, guess invite
   links, or read another family's data.
3. **A stolen or borrowed helper phone or password.**
4. **Malicious web pages** trying to trick a helper into clicking (framing,
   injected scripts).

## What protects families today

| Risk | Protection | Where |
|---|---|---|
| Stranger joins a family | Only the backend adds members; apps can't write circles | `firestore.rules`, `functions/` |
| Scammer sends Mom their own invite | A linked phone can never be moved to another family | `requireUnlinked` |
| Someone else uses an invite link | Single use, expires in 1 hour (opened-but-unfinished ones too); both phones must confirm matching pictures on a call | `functions/index.js` |
| Guessing invite links | 192-bit random token, stored only as a hash | `pairing.js` |
| Reading another family's help requests or scam checks | Rules check circle membership on every read and write | `firestore.rules` |
| Faking a scam answer or answering twice | Only helpers answer, once | `firestore.rules` |
| Injected scripts (XSS) | All person-supplied text escaped (`esc()`); Content-Security-Policy allows only our own scripts | `web/src/util.js`, `firebase.json` |
| Clickjacking ("click here" over a hidden app) | `frame-ancestors 'none'`, `X-Frame-Options: DENY` | `firebase.json` |
| Invite tokens leaking to other sites | `Referrer-Policy: no-referrer` | `firebase.json` |
| Known-vulnerable libraries | `npm audit` fails the build on high-severity issues in shipped code; Dependabot proposes updates monthly | `.github/` |
| Fake update replacing Mom's app | Updates come only from our own site over HTTPS; the app checks the file is a newer My Tech Kid, and Android refuses any update not signed with the same key | `Updater.kt` |
| Lost, replaced or given-away phone | A helper taps **Remove this phone**; it loses access at once and can only rejoin through a new invite and picture check | `removeMember` |
| Pictures of the parent's screen seen by others | Only the parent's phone can add one, into its family's folder; only the family's helpers (and the sender) can view; can't be replaced; deleted after 30 days | `storage.rules`, `cleanupScamShots` |
| Codes and passwords in those pictures | Covered on the parent's phone before sending (helper can switch off); protected screens stay black; the parent sees the picture and taps Send | `ask/Secrets.kt`, `ask/AskService.kt` |
| Private text on lock screens | Scam-check alerts never include the message or picture | `functions/alerts.js` |
| Parent's data in phone backups | `allowBackup="false"` | Android manifest |

Every change to rules or pairing is covered by tests that run on every build:
`backend-tests/rules.test.js` and `backend-tests/pairing.e2e.js`.

## Rules for screen sharing and remote control (stages 2-3)

These are requirements, not nice-to-haves:

- **Never unattended.** A session starts only when the parent taps Get help
  (or approves the helper's request on their own screen). No background access.
- **Always visible.** While shared, the parent's phone shows a banner with the
  helper's name and a big Stop button. Stopping ends it instantly.
- **24-hour safety wait** before a newly linked helper can take control
  (`controlAllowedAt`), enforced on the parent's phone, not just the server.
- **End-to-end encrypted** video and control (WebRTC, DTLS-SRTP). The relay
  server (TURN) can't see the screen.
- **Short-lived session credentials** issued by the backend only to members of
  the circle; nothing reusable is stored on the helper's phone.
- **Mom says yes each time.** Tapping for her (stage 3) starts only when the
  helper asks during a share she started and she taps Yes on her own phone.
  While the question shows, and on her Stop bar, the helper's taps are refused,
  so only her finger can answer or stop. Taps travel in the same end-to-end
  encrypted connection as the video (a WebRTC data channel) and are rate-limited.
  The accessibility service reads nothing on the screen (`RemoteControlService.kt`).
- **Respect protected screens.** Apps that block screenshots (banking,
  passwords) stay black; we never try to get around that.
- **Nothing recorded or stored.** Screens are streamed, not saved.
- **A history the parent's family can see**: who connected, when, how long.
- Microphone/camera permissions stay off on the website
  (`Permissions-Policy`) until voice needs them, then only for our own page.

## Before any public launch

- Delete `functions/.env.my-tech-kid`, which turns the 24-hour safety wait
  off on the real project for beta testing.
- Replace the committed beta signing key with a private one. (Until then,
  anyone who can read this repo could sign an update; the self-updater only
  downloads from our own site, but the key must not stay public.)
- Turn on **Firebase App Check** (only our real apps can call the backend).
- Firebase Authentication settings: **email enumeration protection** on and a
  **password policy** (8+ characters).
- An outside security review of the remote-control code.
- A way to remove a helper, once a family can have more than one (removing
  a parent's phone is built: `removeMember`).

## Reporting a problem

If you find a security issue, email the owner privately instead of opening a
public issue.
