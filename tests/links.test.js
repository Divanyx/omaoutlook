#!/usr/bin/env node
// Runs the link router under node: every kind of link Outlook hands out must
// land where the Outlook app would send it.
const fs = require("fs")
const path = require("path")
const assert = require("assert")

const source = fs.readFileSync(path.join(__dirname, "..", "host", "qml", "Links.js"), "utf8")
  .replace(/^\.pragma library\s*$/m, "")
const L = {}
new Function("exports", source + "\n" + ["classify", "parseMailto", "composeUrl", "isOutlook", "isMicrosoft", "hostOf", "appRoute"]
  .map(n => `exports.${n} = ${n};`).join("\n"))(L)

const cases = [
  // Outlook itself: popouts and deeplinks stay in the app
  ["https://outlook.cloud.microsoft/mail/inbox/id/AAQk", "outlook"],
  ["https://outlook.office.com/mail/deeplink/compose?to=a@b.c", "outlook"],
  ["https://outlook.office365.com/calendar/item/xyz", "outlook"],
  ["https://outlook.live.com/mail/0/", "outlook"],
  ["", "popout"],
  ["about:blank", "popout"],
  ["blob:https://outlook.cloud.microsoft/5f0c-11", "popout"],
  // sign-in stays in the app
  ["https://login.microsoftonline.com/common/oauth2/v2.0/authorize?x=1", "signin"],
  ["https://login.live.com/oauth20_authorize.srf", "signin"],
  ["https://autologon.microsoftazuread-sso.com/x", "signin"],
  ["https://aadcdn.msauth.net/shared/1.0/content/js/x.js", "signin"],
  ["https://aka.ms/mfasetup", "signin"],
  // links in mail: the browser, Safe Links included
  ["https://eur02.safelinks.protection.outlook.com/?url=https%3A%2F%2Fexample.com", "external"],
  ["https://example.com/newsletter", "external"],
  ["http://intranet.local/", "external"],
  ["https://bestinparking.sharepoint.com/sites/IT/doc.docx", "external"],
  ["https://www.office.com/launch/word", "external"],
  ["https://outlook.com.evil.example/", "external"],
  ["https://evil-outlook.com/", "external"],
  ["tel:+43123456", "external"],
  ["ms-word:ofe|u|https://x/y.docx", "external"],
  // Teams
  ["https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0?context=%7b%7d", "teams"],
  ["https://teams.live.com/meet/9312345", "teams"],
  ["msteams:/l/meetup-join/19:x", "teams"],
  ["https://teams.microsoft.com/download", "external"],
  // mail
  ["mailto:someone@example.com", "mailto"],
  ["MAILTO:someone@example.com?subject=Hi", "mailto"],
]
for (const [url, want] of cases) assert.strictEqual(L.classify(url), want, `${url} -> ${L.classify(url)}, want ${want}`)

const m = L.parseMailto("mailto:a@x.at,b@y.at?cc=c@z.at&subject=Gr%C3%BC%C3%9Fe%20aus%20Wien&body=Zeile%201%0AZeile%202&to=d@w.at")
assert.deepStrictEqual(m.to, ["a@x.at", "b@y.at", "d@w.at"])
assert.deepStrictEqual(m.cc, ["c@z.at"])
assert.strictEqual(m.subject, "Grüße aus Wien")
assert.strictEqual(m.body, "Zeile 1\nZeile 2")

assert.strictEqual(L.composeUrl("mailto:a@x.at?subject=Hi", "https://outlook.cloud.microsoft/mail/"),
  "https://outlook.cloud.microsoft/mail/deeplink/compose?to=a%40x.at&subject=Hi")
assert.strictEqual(L.composeUrl("mailto:a@x.at", "https://outlook.live.com/mail/0/"),
  "https://outlook.live.com/mail/0/deeplink/compose?to=a%40x.at")
assert.strictEqual(L.composeUrl("mailto:", "https://login.microsoftonline.com/"),
  "https://outlook.office.com/mail/deeplink/compose")

assert(L.isMicrosoft("https://outlook.cloud.microsoft/"))
assert(!L.isMicrosoft("https://example.com/"))
assert(!L.isMicrosoft("http://outlook.office.com/"))
// In-app routes: the running page shows these without a reload.
const page = "https://outlook.cloud.microsoft/mail/"
assert.strictEqual(L.appRoute("https://outlook.office365.com/owa/?itemid=AQMk%2FKI%3D%3D&exvsurl=1&path=/calendar/item", page),
  "/calendar/item/AQMk%2FKI%3D%3D?itemid=AQMk%2FKI%3D%3D&exvsurl=1")
assert.strictEqual(L.appRoute("https://outlook.office.com/calendar/view/day/2026/10/21", page), "/calendar/view/day/2026/10/21")
assert.strictEqual(L.appRoute("https://outlook.cloud.microsoft/mail/inbox/id/AAQk?x=1", page), "/mail/inbox/id/AAQk?x=1")
assert.strictEqual(L.appRoute("https://outlook.office365.com/owa/?itemid=X&path=/mail/inbox", page), "")
assert.strictEqual(L.appRoute("https://outlook.live.com/calendar/0/view/day", page), "")
assert.strictEqual(L.appRoute("https://outlook.office.com/people/", page), "")
assert.strictEqual(L.appRoute("https://example.com/calendar/x", page), "")
assert.strictEqual(L.appRoute("https://outlook.office.com/calendar/", "https://login.microsoftonline.com/x"), "")
console.log(`links: ${cases.length} routes, mailto, compose and in-app routes ok`)
