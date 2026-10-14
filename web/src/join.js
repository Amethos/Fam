// The page an invite link opens. On Mom's Android phone it opens the invite
// in the My Tech Kid app, or downloads the app first.

import "./styles.css";
import { androidPackage, apkPath } from "./config.js";
import { esc } from "./util.js";

const root = document.getElementById("app");
const params = new URLSearchParams(location.search);
const invite = { c: params.get("c"), i: params.get("i"), t: params.get("t") };
const isAndroid = /Android/i.test(navigator.userAgent);

const LOGO = `<svg width="30" height="30" viewBox="0 0 34 34" fill="none" aria-hidden="true"><circle cx="11" cy="17" r="8" stroke="#1D5BD6" stroke-width="3"/><circle cx="23" cy="17" r="8" stroke="#F08A3C" stroke-width="3"/></svg>`;

function render() {
  const brand = `<div class="brand">${LOGO} My Tech Kid</div>`;
  if (!invite.c || !invite.i || !invite.t) {
    root.innerHTML = `${brand}<div class="card"><h1>This link is incomplete</h1><p>Ask the person who sent it to send a new one.</p></div>`;
    return;
  }
  if (!isAndroid) {
    root.innerHTML = `${brand}<div class="card"><h1>Open this on the Android phone</h1>
      <p>This invite is for the phone of the person getting help. Text the link to them and open it there.</p>
      <p class="muted">My Tech Kid for iPhone users getting help isn't ready yet.</p></div>`;
    return;
  }
  const query = new URLSearchParams(invite).toString();
  const fallback = encodeURIComponent(new URL(apkPath, location.origin).href);
  const intentUrl = `intent://join?${query}#Intent;scheme=mytechkid;package=${androidPackage};S.browser_fallback_url=${fallback};end`;
  root.innerHTML = `${brand}
    <h1>Your family invited you to My Tech Kid</h1>
    <p class="muted">My Tech Kid puts a big button on your phone that reaches your family when you need help.</p>
    <a class="button full" style="min-height:64px;font-size:1.25rem" href="${esc(intentUrl)}">Open my invite</a>
    <div class="card">
      <h2>First time? Install My Tech Kid</h2>
      <a class="button secondary full" href="${esc(apkPath)}" download>Download My Tech Kid</a>
      <p>When it finishes, tap the download and choose <strong>Install</strong>. If your phone asks, allow your browser to <strong>install unknown apps</strong>.</p>
      <p>Then come back to the text message and tap the link again.</p>
    </div>
    <div class="alert orange"><p><strong>Only continue if this came from family you know.</strong> Banks, Samsung, Google, Microsoft and the police will never ask you to install this app.</p></div>`;
}

render();
