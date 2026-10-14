.pragma library

// What the host needs to know from inside the Outlook page.
//
// Unread count, from three places, best first:
//  - the Inbox entry of the folder pane, whose tooltip says "Inbox - 110
//    items (18 unread)" in every language: the number in the closing
//    parentheses. Only there while the folder pane is drawn, and a window
//    started hidden has no size, so Outlook draws none;
//  - Outlook's own data: the start-up data (startupdata.ashx) carries every
//    folder with its UnreadCount, the Inbox marked "DistinguishedFolderId":
//    "inbox", and the push channel then sends UnreadCountNotification for
//    every change. Read off the page's own fetch, XHR and WebSocket, so it
//    works hidden, in the calendar, and from the first second;
//  - Outlook's app badge (navigator.setAppBadge, which it calls once it
//    believes it runs as the installed app), which counts new mail since the
//    window was last looked at, as a last resort.
//
// Busy: the background reload (see Main.qml) must never throw away a message
// someone is writing. Outlook saves drafts on its own, but not every second;
// a page with an editor that holds text counts as busy and is left alone.

var BADGE = "[omaoutlook] badge "

// What Outlook calls the Inbox in the languages it ships most, lower case.
var INBOX_NAMES = [
  "inbox", "posteingang", "boîte de réception", "bandeja de entrada", "posta in arrivo",
  "postvak in", "caixa de entrada", "skrzynka odbiorcza", "входящие", "indbakke", "inkorgen",
  "innboks", "saapuneet", "doručená pošta", "beérkezett üzenetek", "gelen kutusu",
  "εισερχόμενα", "dosarul inbox", "doručena pošta", "prejeta pošta", "primljena pošta",
  "受信トレイ", "收件箱", "받은 편지함", "收件匣", "תיבת דואר נכנס", "البريد الوارد"
]

function pageScript() {
  return "(function () {\n"
    + "  if (window.__omaoutlookPage) return;\n"
    + "  window.__omaoutlookPage = true;\n"
    + "  var marker = " + JSON.stringify(BADGE) + ";\n"
    + "  var last = null;\n"
    + "  function report(n) {\n"
    + "    n = Math.max(0, Math.floor(Number(n) || 0));\n"
    + "    if (n === last) return;\n"
    + "    last = n;\n"
    + "    console.info(marker + n);\n"
    + "  }\n"
    + "  var fromPane = false, fromData = false;\n"
    + "  function findInbox(node, depth) {\n"
    + "    if (!node || typeof node !== 'object' || depth > 12) return null;\n"
    + "    if (node.DistinguishedFolderId === 'inbox' && typeof node.UnreadCount === 'number') return node.UnreadCount;\n"
    + "    if (typeof node.id === 'string' && node.id.indexOf('UnreadCountNotification') === 0 && typeof node.UnreadCount === 'number') return node.UnreadCount;\n"
    + "    for (var k in node) {\n"
    + "      var v = node[k];\n"
    + "      if (v && typeof v === 'object') { var r = findInbox(v, depth + 1); if (r !== null) return r; }\n"
    + "    }\n"
    + "    return null;\n"
    + "  }\n"
    + "  function fromText(text) {\n"
    + "    if (typeof text !== 'string' || text.indexOf('UnreadCount') < 0) return;\n"
    + "    if (text.indexOf('\"inbox\"') < 0 && text.indexOf('UnreadCountNotification') < 0) return;\n"
    // SignalR frames are JSON records separated by 0x1e.
    + "    var parts = text.split('\\u001e');\n"
    + "    for (var i = 0; i < parts.length; i++) {\n"
    + "      var json; try { json = JSON.parse(parts[i]); } catch (e) { continue; }\n"
    + "      var n = findInbox(json, 0);\n"
    + "      if (n !== null) { fromData = true; if (!fromPane) report(n); return; }\n"
    + "    }\n"
    + "  }\n"
    + "  function interesting(url) { return /startupdata|action=(GetFolder|FindFolder)|graphql/i.test(String(url)); }\n"
    + "  try {\n"
    + "    var origFetch = window.fetch;\n"
    + "    window.fetch = function (input, init) {\n"
    + "      var url = typeof input === 'string' ? input : (input && input.url) || '';\n"
    + "      var p = origFetch.apply(this, arguments);\n"
    + "      if (interesting(url)) p.then(function (r) { try { r.clone().text().then(fromText, function () {}); } catch (e) {} }, function () {});\n"
    + "      return p;\n"
    + "    };\n"
    + "    var open = XMLHttpRequest.prototype.open;\n"
    + "    XMLHttpRequest.prototype.open = function (method, url) {\n"
    + "      if (interesting(url)) this.addEventListener('load', function () {\n"
    + "        try { if (this.responseType === '' || this.responseType === 'text') fromText(this.responseText); } catch (e) {}\n"
    + "      });\n"
    + "      return open.apply(this, arguments);\n"
    + "    };\n"
    + "    var WS = window.WebSocket;\n"
    + "    var Wrapped = function (url, protocols) {\n"
    + "      var ws = protocols === undefined ? new WS(url) : new WS(url, protocols);\n"
    + "      ws.addEventListener('message', function (e) { if (typeof e.data === 'string') fromText(e.data); });\n"
    + "      return ws;\n"
    + "    };\n"
    + "    Wrapped.prototype = WS.prototype;\n"
    + "    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) { Wrapped[k] = WS[k]; });\n"
    + "    window.WebSocket = Wrapped;\n"
    + "  } catch (e) {}\n"
    + "  try {\n"
    + "    navigator.setAppBadge = function (n) { if (!fromPane && !fromData) report(n === undefined ? 1 : n); return Promise.resolve(); };\n"
    + "    navigator.clearAppBadge = function () { if (!fromPane && !fromData) report(0); return Promise.resolve(); };\n"
    + "  } catch (e) {}\n"
    // The installed-app check Outlook makes before it badges at all.
    + "  try {\n"
    + "    var mm = window.matchMedia.bind(window);\n"
    + "    window.matchMedia = function (q) {\n"
    + "      var s = String(q);\n"
    + "      if (/display-mode\\s*:\\s*(standalone|window-controls-overlay|minimal-ui)/.test(s)) {\n"
    + "        var r = mm('(min-width: 0px)');\n"
    + "        try { Object.defineProperty(r, 'media', { value: s }); } catch (e) {}\n"
    + "        return r;\n"
    + "      }\n"
    + "      if (/display-mode\\s*:\\s*browser/.test(s)) {\n"
    + "        var f = mm('(max-width: 0px)');\n"
    + "        try { Object.defineProperty(f, 'media', { value: s }); } catch (e) {}\n"
    + "        return f;\n"
    + "      }\n"
    + "      return mm(q);\n"
    + "    };\n"
    + "  } catch (e) {}\n"
    + "  var names = " + JSON.stringify(INBOX_NAMES) + ";\n"
    + "  function inboxCount() {\n"
    + "    var nodes = document.querySelectorAll('[role=\"treeitem\"][data-folder-name]');\n"
    + "    for (var i = 0; i < nodes.length; i++) {\n"
    + "      var name = String(nodes[i].getAttribute('data-folder-name')).toLowerCase();\n"
    + "      if (names.indexOf(name) < 0) continue;\n"
    + "      var title = nodes[i].getAttribute('title') || '';\n"
    + "      var m = title.match(/\\(([\\d.,\\s\\u00a0\\u202f']+)[^()]*\\)\\s*$/);\n"
    + "      if (m) return parseInt(m[1].replace(/[^\\d]/g, ''), 10) || 0;\n"
    + "      return 0;\n"
    + "    }\n"
    + "    return null;\n"
    + "  }\n"
    + "  setInterval(function () {\n"
    + "    if (window.top !== window) return;\n"
    + "    var n = inboxCount();\n"
    + "    if (n === null) return;\n"
    + "    fromPane = true;\n"
    + "    report(n);\n"
    + "  }, 4000);\n"
    + "  window.__omaoutlookBusy = function () {\n"
    + "    var editors = document.querySelectorAll('[contenteditable=\"true\"], textarea');\n"
    + "    for (var i = 0; i < editors.length; i++) {\n"
    + "      var e = editors[i];\n"
    + "      if (!e.isConnected || e.offsetParent === null) continue;\n"
    + "      var text = e.tagName === 'TEXTAREA' ? e.value : e.textContent;\n"
    + "      if (String(text || '').trim().length > 0) return true;\n"
    + "    }\n"
    + "    return false;\n"
    + "  };\n"
    + "})();\n"
}
