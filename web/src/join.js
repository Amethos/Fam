// The page an invite link opens. On the invited Android phone it opens the
// invite in the My Tech Kid app, or downloads the app first. Downloading also
// copies the invite, so the app can pick it up the first time it opens and
// nobody has to find the text message and tap the link again.

import "./styles.css";
import { androidPackage, apkPath } from "./config.js";
import { esc } from "./util.js";

const root = document.getElementById("app");
const params = new URLSearchParams(location.search);
const invite = { c: params.get("c"), i: params.get("i"), t: params.get("t") };
const isAndroid = /Android/i.test(navigator.userAgent);
const isIPhone = /iPhone|iPad/.test(navigator.userAgent);

const LOGO = `My Tech Kid<span class="dot">.</span>`;

function render() {
  const brand = `<div class="brand">${LOGO}</div>`;
  if (!invite.c || !invite.i || !invite.t) {
    root.innerHTML = `${brand}<div class="card"><h1>This link is incomplete</h1><p>Ask the person who sent it to send a new one.</p></div>`;
    return;
  }
  const query = new URLSearchParams(invite).toString();
  if (!isAndroid) {
    // The iPhone app is in testing: only phones with the test version can open it.
    const testLink = isIPhone
      ? `<a class="button secondary full" href="${esc(`mytechkid://join?${query}`)}">Testing the iPhone app? Open the invite there</a>`
      : "";
    root.innerHTML = `${brand}<div class="card"><h1>Open this on the Android phone</h1>
      <p>This invite is for the phone of the person getting help. Text the link to them and open it there.</p>
      <p class="muted">My Tech Kid for iPhone users getting help isn't ready yet.</p>${testLink}</div>`;
    return;
  }
  const fallback = encodeURIComponent(new URL(apkPath, location.origin).href);
  const intentUrl = `intent://join?${query}#Intent;scheme=mytechkid;package=${androidPackage};S.browser_fallback_url=${fallback};end`;
  root.innerHTML = `${brand}
    <h1>You're invited to My Tech Kid</h1>
    <p class="muted">My Tech Kid puts a big button on your phone that reaches someone you trust when you need help.</p>
    <a class="button full" id="open" style="min-height:64px;font-size:1.25rem" href="${esc(intentUrl)}">Open my invite</a>
    <div class="card">
      <h2>First time? Install My Tech Kid</h2>
      <a class="button secondary full" id="download" href="${esc(apkPath)}" download>Download My Tech Kid</a>
      <p>When it finishes, tap the download and choose <strong>Install</strong>. If your phone asks, allow your browser to <strong>install unknown apps</strong>.</p>
      <p>Then tap <strong>Open</strong>. Your invite will be waiting.</p>
    </div>
    <div class="alert blue"><p><strong>Only continue if this came from someone you know.</strong> Banks, Samsung, Google, Microsoft and the police will never ask you to install this app.</p></div>`;
}

render();

// Both buttons can end in a download (Open falls back to it when the app
// isn't installed yet). The copy only holds this invite's link, which still
// needs the "Link with ...?" question and the picture check on the phone call.
for (const id of ["open", "download"]) document.getElementById(id)?.addEventListener("click", () => {
  const link = `${location.origin}/join?${new URLSearchParams(invite)}`;
  navigator.clipboard?.writeText(link).catch(() => { /* not allowed: they tap the link again instead */ });
});
