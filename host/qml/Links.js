.pragma library

// Where a link belongs.
//
// The Outlook app keeps what is Outlook inside Outlook and hands everything
// else to the browser: a link in a message opens in the default browser, a
// popped-out message or a new mail opens in an Outlook window of its own, the
// sign-in stays in the app so the session lands in its profile, a mailto link
// starts a new message, and a Teams meeting opens in Teams. This file is that
// decision, kept free of QML so tests/links.test.js can run it under node.
//
// Kinds:
//   "outlook"  an Outlook page: open in an Outlook popout window
//   "popout"   an empty or same-document window Outlook fills itself
//              (about:blank, blob:, data:): also an Outlook popout window
//   "signin"   Microsoft's sign-in: the in-app sign-in dialog
//   "mailto"   a new message in Outlook
//   "teams"    a Teams meeting or chat link: Teams (omateams if present)
//   "external" anything else: the default browser or the scheme's handler

// Only these exact hosts serve Outlook itself. Not a suffix match: Safe Links
// live under *.safelinks.protection.outlook.com and are links to the outside
// world, which belong in the browser like the link they wrap.
var OUTLOOK_HOSTS = [
  "outlook.cloud.microsoft", "outlook.office.com", "outlook.office365.com",
  "outlook.live.com", "outlook.com", "www.outlook.com", "outlook.office.de",
  "outlook.office365.us", "outlook.office365.cn"
]

var SIGNIN_SUFFIXES = [
  "login.microsoftonline.com", "login.microsoft.com", "login.live.com", "login.windows.net",
  "account.live.com", "account.microsoft.com", "msauth.net", "msftauth.net", "msauthimages.net",
  "microsoftazuread-sso.com", "login.microsoftonline.us", "login.partner.microsoftonline.cn",
  "device.login.microsoftonline.com", "mysignins.microsoft.com"
]

// The Microsoft services Outlook embeds and may ask for permissions:
// notifications, the clipboard, the microphone for dictation.
var MICROSOFT_SUFFIXES = [
  "cloud.microsoft", "office.com", "office.net", "office365.com", "outlook.com", "live.com",
  "microsoft.com", "microsoftonline.com", "sharepoint.com", "officeapps.live.com", "static.microsoft"
]

var TEAMS_HOSTS = ["teams.microsoft.com", "teams.live.com", "teams.cloud.microsoft"]

function schemeOf(url) {
  var m = String(url || "").match(/^([a-z][a-z0-9+.-]*):/i)
  return m ? m[1].toLowerCase() : ""
}

function hostOf(url) {
  var m = String(url || "").match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@\/?#]*@)?(\[[^\]]*\]|[^\/:?#]+)/i)
  return m ? m[1].toLowerCase() : ""
}

function pathOf(url) {
  var m = String(url || "").match(/^[a-z][a-z0-9+.-]*:\/\/[^\/?#]*([^?#]*)/i)
  return m ? m[1] : ""
}

function hostMatches(host, suffixes) {
  for (var i = 0; i < suffixes.length; i++) {
    var s = suffixes[i]
    if (host === s || host.slice(-(s.length + 1)) === "." + s) return true
  }
  return false
}

function isOutlookHost(host) {
  return OUTLOOK_HOSTS.indexOf(String(host || "").toLowerCase()) >= 0
}

function isOutlook(url) {
  var scheme = schemeOf(url)
  return (scheme === "https" || scheme === "http") && isOutlookHost(hostOf(url))
}

function isSignIn(url) {
  var host = hostOf(url)
  if (hostMatches(host, SIGNIN_SUFFIXES)) return true
  // The account pages of Outlook.com sign-ins and the MFA setup flow.
  return host === "aka.ms" && /^\/(mfasetup|mysecurityinfo)/i.test(pathOf(url))
}

function isMicrosoft(url) {
  var scheme = schemeOf(url)
  if (scheme !== "https") return false
  var host = hostOf(url)
  return isOutlookHost(host) || hostMatches(host, MICROSOFT_SUFFIXES) || hostMatches(host, SIGNIN_SUFFIXES)
}

// Meeting joins, chats and channels: a click on "Join Teams meeting" in an
// invitation. Anything else on a Teams host (the marketing pages) is a link.
function isTeams(url) {
  var scheme = schemeOf(url)
  if (scheme === "msteams") return true
  if (scheme !== "https") return false
  var host = hostOf(url)
  if (TEAMS_HOSTS.indexOf(host) < 0) return false
  return /^\/(l|meet|v2|_)(\/|$)|^\/?$/i.test(pathOf(url))
}

function classify(url) {
  var u = String(url || "").trim()
  if (u.length === 0 || u === "about:blank" || u === "about:srcdoc") return "popout"
  var scheme = schemeOf(u)
  if (scheme === "mailto") return "mailto"
  if (scheme === "blob" || scheme === "data") return "popout"
  if (scheme === "msteams") return "teams"
  if (scheme !== "https" && scheme !== "http") return "external"
  if (isOutlook(u)) return "outlook"
  if (isSignIn(u)) return "signin"
  if (isTeams(u)) return "teams"
  return "external"
}

function decode(v) {
  try { return decodeURIComponent(String(v).replace(/\+/g, "%20")) } catch (e) { return String(v) }
}

// mailto:a@x,b@y?cc=c@z&subject=Hi&body=Text  ->  { to, cc, bcc, subject, body }
// RFC 6068: the address part and every header are percent-encoded; "to" may
// also appear as a header and adds to the addresses before the "?".
function parseMailto(url) {
  var out = { to: [], cc: [], bcc: [], subject: "", body: "" }
  var rest = String(url || "").replace(/^mailto:/i, "")
  var q = rest.indexOf("?")
  var addresses = q >= 0 ? rest.slice(0, q) : rest
  var query = q >= 0 ? rest.slice(q + 1) : ""
  function addList(list, value) {
    decode(value).split(/[,;]/).forEach(function (a) {
      a = a.trim()
      if (a.length > 0) list.push(a)
    })
  }
  addList(out.to, addresses)
  query.split("&").forEach(function (pair) {
    if (pair.length === 0) return
    var eq = pair.indexOf("=")
    var key = (eq >= 0 ? pair.slice(0, eq) : pair).toLowerCase()
    var value = eq >= 0 ? pair.slice(eq + 1) : ""
    if (key === "to" || key === "cc" || key === "bcc") addList(out[key], value)
    else if (key === "subject") out.subject = decode(value)
    else if (key === "body") out.body = decode(value)
  })
  return out
}

// The Outlook on the web deeplink that opens a new message with these fields.
// Personal accounts (outlook.live.com) put the mailbox index in the path.
function composeUrl(mailto, base) {
  var origin = "https://outlook.office.com"
  var b = String(base || "")
  if (isOutlook(b)) origin = "https://" + hostOf(b)
  var path = hostOf(origin) === "outlook.live.com" ? "/mail/0/deeplink/compose" : "/mail/deeplink/compose"
  var m = parseMailto(mailto || "mailto:")
  var params = []
  function add(key, value) { if (value && value.length > 0) params.push(key + "=" + encodeURIComponent(value)) }
  add("to", m.to.join(";"))
  add("cc", m.cc.join(";"))
  add("bcc", m.bcc.join(";"))
  add("subject", m.subject)
  add("body", m.body)
  return origin + path + (params.length > 0 ? "?" + params.join("&") : "")
}
