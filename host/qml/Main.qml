import QtQuick
import QtQuick.Window
import QtWebEngine
import "Theme.js" as Theme
import "WebAuth.js" as WebAuth
import "Page.js" as Page
import "Links.js" as Links

// The Outlook window. The real Outlook web client runs in a WebEngineView;
// this file owns everything around it: the persistent profile, the Omarchy
// theme and its live reload, where every link goes (Links.js), Outlook's own
// popout windows, sign-in dialogs, mailto, printing, downloads, desktop
// notifications, the unread badge, the reload that keeps a long-running page
// from growing without bound, the status file the bar widget reads, and the
// socket commands the widget and the CLI send.
Window {
  id: win

  // Set by main.cpp from the command line.
  property bool startHidden: false
  property string startUrl: ""
  property string startCommand: ""

  readonly property string home: Sys.home()
  readonly property string statusPath: Sys.runtimeDir() + "/omaoutlook/status.json"
  readonly property string printDir: Sys.runtimeDir() + "/omaoutlook/print"
  readonly property string configDir: Sys.configDir() + "/omaoutlook"
  readonly property string settingsPath: configDir + "/settings.json"
  readonly property string windowStatePath: Sys.stateDir() + "/omaoutlook/window.json"
  readonly property string omarchyState: home + "/.local/state/omarchy/current"
  readonly property string colorsPath: omarchyState + "/theme/colors.toml"
  readonly property string defaultUrl: "https://outlook.cloud.microsoft/mail/"
  // OMAOUTLOOK_DEBUG=1 logs where every link and window goes (journal);
  // OMAOUTLOOK_DRY_RUN=1 also keeps them from leaving the app, for tests.
  readonly property bool debug: Sys.env("OMAOUTLOOK_DEBUG").length > 0 || dryRun
  readonly property bool dryRun: Sys.env("OMAOUTLOOK_DRY_RUN").length > 0
  readonly property string teamsBinary: Sys.home() + "/.local/share/omateams/bin/omateams"

  // Written by the Omarchy bar widget from its plugin settings.
  property var settings: ({})
  readonly property bool themeEnabled: settings.followTheme !== false
  readonly property bool notificationsEnabled: settings.notifications !== "Off" && settings.notifications !== false
  readonly property bool hideOnClose: settings.closeAction !== "Quit"
  readonly property string fontFamily: settings.useShellFont === false ? "" : "monospace"
  readonly property real zoom: Math.max(0.5, Math.min(3, (Number(settings.zoom) || 100) / 100))
  readonly property bool teamsInOmateams: settings.teamsLinks !== "Browser"
  readonly property string downloadDir: settings.downloadDir && String(settings.downloadDir).length > 0
    ? String(settings.downloadDir).replace(/^~(?=\/|$)/, home) : home + "/Downloads"
  // MiB the Outlook page may reach before it is reloaded in the background; 0 never.
  readonly property int memoryLimit: settings.memoryLimit === undefined ? 1536 : Math.max(0, Number(settings.memoryLimit) || 0)

  property var themeColors: ({})
  readonly property var themePalette: Theme.palette(themeColors)
  property string themeCss: ""
  property int rounding: -1
  property int roundingRequest: -1
  property bool ready: false

  property int unread: 0
  property bool activity: false
  property var pendingNotifications: ({})
  property var pendingDownloads: ({})
  property var pendingHandoffs: ({})
  property bool quitting: false
  property int windowedVisibility: Window.Windowed
  // Outlook windows opened from this one: popped-out messages, new mails.
  property var popouts: []
  property int activeDownloads: 0

  // Out of sight: hidden, or on a workspace Hyprland is not showing.
  property bool exposed: true
  readonly property bool concealed: !win.visible || !exposed
  property real concealedSince: 0
  property int pageMemory: -1
  property int totalMemory: -1
  // What this account's page takes once it has settled after a load, and the
  // limit that follows from it; see checkMemory().
  property int pageBaseline: -1
  property real pageLoadedAt: 0
  readonly property int effectiveLimit: memoryLimit <= 0 ? 0 : Math.max(memoryLimit, Math.round(pageBaseline * 1.5))
  readonly property int baselineDelayMs: 10 * 60 * 1000
  property real lastRecycle: 0
  property bool recycling: false
  property int recyclePid: 0
  // A page must stay out of sight this long before it is reloaded, so a
  // window someone just hid for a moment is never pulled from under them.
  readonly property int recycleIdleMs: 10 * 60 * 1000
  readonly property int recycleSpacingMs: 60 * 60 * 1000

  readonly property string focusCommand:
    "hyprctl dispatch 'hl.dsp.focus({ window = \"class:omaoutlook\" })' >/dev/null 2>&1"
    + " || hyprctl dispatch focuswindow class:omaoutlook >/dev/null 2>&1"

  visible: !startHidden
  width: 1360
  height: 880
  minimumWidth: 480
  minimumHeight: 320
  title: view.title.length > 0 ? view.title : "Outlook"
  color: themeColors.background && /^#[0-9a-fA-F]{6}$/.test(themeColors.background) ? themeColors.background : "#101315"

  // Closing hides by default: the badge, the notifications and the calendar
  // reminders only work while the page keeps running.
  onClosing: function(close) {
    if (hideOnClose && !quitting) {
      close.accepted = false
      win.hide()
    }
  }
  onVisibleChanged: statusTimer.restart()
  onConcealedChanged: {
    concealedSince = concealed ? Date.now() : 0
    if (concealed) trimTimer.restart()
    else { trimTimer.stop(); revive() }
  }
  onActiveChanged: statusTimer.restart()
  onWidthChanged: geometryTimer.restart()
  onHeightChanged: geometryTimer.restart()
  onThemeEnabledChanged: if (ready) rebuildCss()
  onFontFamilyChanged: if (ready) rebuildCss()

  Component.onCompleted: {
    installScript("omaoutlook-webauth", WebAuth.pageScript(), true)
    installScript("omaoutlook-page", Page.pageScript(), false)
    Sys.watchExposure(win)
    if (startHidden) Sys.createHidden(win)
    loadSettings()
    restoreGeometry()
    loadTheme()
    refreshRounding()
    Sys.watch(colorsPath)
    Sys.watch(omarchyState)
    Sys.watch(settingsPath)
    Sys.watch(configDir)
    grantNotifications()
    ready = true
    view.url = startUrl.length > 0 && Links.isOutlook(startUrl) ? startUrl : (settings.url || defaultUrl)
    pageLoadedAt = Date.now()
    writeStatus()
    memoryRecheck.restart()
    // Started hidden: out of sight from the first second.
    if (concealed) { concealedSince = Date.now(); trimTimer.restart() }
    if (startCommand.length > 0) Qt.callLater(function() { win.handleCommand(0, win.startCommand) })
  }

  // ------------------------------------------------------------ settings
  function safeJson(text) {
    try { var v = JSON.parse(text); return v && typeof v === "object" ? v : null } catch (e) { return null }
  }

  function loadSettings() {
    var raw = Sys.readFile(settingsPath)
    if (raw.length === 0) {
      // Create the file so the directory exists and the watch can arm; the
      // bar widget replaces it with the real values on its first run.
      Sys.writeFile(settingsPath, "{}\n")
      Sys.watch(settingsPath)
      Sys.watch(configDir)
    }
    settings = safeJson(raw) || ({})
  }

  // ------------------------------------------------------------ theme
  function loadTheme() {
    themeColors = Theme.parseColors(Sys.readFile(colorsPath))
    // Outlook set to follow the system picks its dark or light mode from
    // prefers-color-scheme, and with it how message bodies are drawn.
    Sys.setColorScheme(themePalette.dark)
    rebuildCss()
  }

  function rebuildCss() {
    themeCss = themeEnabled ? Theme.buildCss(themeColors, { fontFamily: fontFamily, rounding: rounding }) : ""
    installThemeScript()
    applyThemeLive()
  }

  // The stylesheet rides in a user script at document creation so a fresh
  // page never flashes Microsoft's colors; open pages are restyled in place
  // through the hook the script leaves on window.
  function installThemeScript() {
    var old = profile.userScripts.find("omaoutlook-theme")
    for (var i = 0; i < old.length; i++) profile.userScripts.remove(old[i])
    if (themeCss.length === 0) return
    installScript("omaoutlook-theme", Theme.pageScript(themeCss), true)
  }

  function installScript(name, source, subframes) {
    var script = WebEngine.script()
    script.name = name
    script.sourceCode = source
    script.injectionPoint = WebEngineScript.DocumentCreation
    script.worldId = WebEngineScript.MainWorld
    script.runOnSubframes = subframes
    profile.userScripts.insert(script)
  }

  function themeScript() {
    return "if (window.__omaoutlookApply) window.__omaoutlookApply(" + JSON.stringify(themeCss) + ");"
      + " else { var s = document.getElementById('omaoutlook-theme'); if (s) s.remove(); }"
  }

  function applyThemeLive() {
    if (!ready) return
    var js = themeScript()
    view.runJavaScript(js)
    for (var i = 0; i < popouts.length; i++) popouts[i].view.runJavaScript(js)
  }

  // Corner radii follow Hyprland's rounding, which a theme may change too.
  function refreshRounding() {
    roundingRequest = Sys.runCapture("hyprctl", ["getoption", "decoration:rounding", "-j"])
  }

  // ------------------------------------------------------------ status
  function statusObject() {
    return {
      running: !quitting,
      pid: Sys.pid(),
      version: appVersion,
      visible: win.visible,
      active: win.active,
      unread: unread,
      activity: activity,
      popouts: popouts.length,
      title: String(view.title || ""),
      url: String(view.url || ""),
      signedIn: Links.isOutlook(String(view.url || "")),
      renderPid: Number(view.renderProcessPid) || 0,
      memory: pageMemory,
      memoryTotal: totalMemory,
      memoryBaseline: pageBaseline,
      memoryLimit: effectiveLimit,
      lastReload: lastRecycle,
      reloading: recycling,
      updated: Date.now()
    }
  }

  function writeStatus() {
    Sys.writeFile(statusPath, JSON.stringify(statusObject(), null, 2) + "\n")
  }

  // Page.js reports the unread count; a title that carries one wins too.
  function pageMessage(message) {
    var m = String(message)
    if (m.indexOf(Page.BADGE) === 0) {
      var n = parseInt(m.slice(Page.BADGE.length), 10)
      unread = isNaN(n) ? 0 : Math.max(0, n)
      statusTimer.restart()
      return
    }
    reportWebAuth(m)
  }

  function parseTitle() {
    var t = String(view.title || "")
    var m = t.match(/^\((\d+)\)/)
    if (m) unread = parseInt(m[1], 10)
    statusTimer.restart()
  }

  // ------------------------------------------------------------ window
  function showWindow() {
    win.show()
    win.raise()
    win.requestActivate()
    focusTimer.restart()
  }

  // Hyprland suspends a window whose workspace is not on screen. When it comes
  // back, Qt draws the scene again but Chromium sends no new frame until the
  // page changes, so the view stays black until the next click or keypress.
  // A one-pixel change on the next animation frame makes it paint.
  function repaintScript() {
    return "requestAnimationFrame(function () {"
      + " var d = document.getElementById('omaoutlook-repaint');"
      + " if (!d) { d = document.createElement('div'); d.id = 'omaoutlook-repaint';"
      + "   d.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;background:#000;pointer-events:none;z-index:2147483647';"
      + "   (document.body || document.documentElement).appendChild(d); }"
      + " d.style.opacity = d.style.opacity === '0.01' ? '0.02' : '0.01';"
      + "})"
  }

  // ------------------------------------------------------------ links
  // Every view (the main window, popouts, sign-in dialogs) routes the windows
  // its page opens through here. See Links.js for what goes where.
  function trace(what, url) {
    if (debug) console.info("[omaoutlook] " + what + " " + String(url).slice(0, 160))
  }

  function routeNewWindow(request, fromView) {
    var url = String(request.requestedUrl || "")
    var kind = Links.classify(url)
    var dialog = request.destination === WebEngineNewWindowRequest.InNewDialog
    trace("window(" + kind + (dialog ? ",dialog" : "") + (request.userInitiated ? ",user" : "") + ")", url)
    // While the sign-in runs (any page that is not Outlook yet), every popup
    // is part of it: an identity provider's own window, a security prompt.
    var signingIn = !Links.isOutlook(String(fromView.url || "")) && kind !== "mailto"
    if (kind === "signin" || (signingIn && kind === "external")) { openAuth(request); return }
    switch (kind) {
    case "mailto": compose(url); return
    case "outlook":
    case "popout": openPopout(request, ""); return
    case "teams": openTeams(url); return
    }
    // Outlook add-ins open their dialogs with window.open and size features
    // and talk to them through the opener; those stay in the app. A link the
    // user clicked opens as a tab and goes to the browser.
    if (dialog && !Links.isMicrosoft(url)) { openAuth(request); return }
    openExternal(url)
  }

  // A link clicked inside an Outlook page that would navigate the page itself
  // away from Outlook goes to the browser instead. Redirects and form posts
  // stay: the sign-in passes through Microsoft's and an organisation's own
  // identity provider by redirect, and so does a federated (ADFS, Okta) one.
  function routeNavigation(request, fromView) {
    if (!request.isMainFrame) return
    var url = String(request.url || "")
    var kind = Links.classify(url)
    if (kind === "mailto") { request.reject(); compose(url); return }
    if (kind === "external" && Links.schemeOf(url) !== "http" && Links.schemeOf(url) !== "https") {
      request.reject(); openExternal(url); return
    }
    if (request.navigationType !== WebEngineNavigationRequest.LinkClickedNavigation) return
    trace("link(" + kind + ")", url)
    if (!Links.isOutlook(String(fromView.url || ""))) return
    if (kind === "external") { request.reject(); openExternal(url) }
    else if (kind === "teams") { request.reject(); openTeams(url) }
  }

  function linkKind(url) { return Links.classify(url) }

  function openExternal(url) {
    if (String(url).length === 0) return
    trace("external", url)
    if (dryRun) return
    Qt.openUrlExternally(url)
  }

  // A Teams link goes to the Teams window when omateams is installed and new
  // enough to take one (`omateams open <url>`), otherwise to the browser,
  // which offers the Teams app or the web client the usual way.
  function openTeams(url) {
    trace("teams", url)
    if (!teamsInOmateams || !Sys.exists(teamsBinary)) { openExternal(url); return }
    var id = Sys.runCapture(teamsBinary, ["open", url])
    var pending = pendingHandoffs
    pending[id] = url
    pendingHandoffs = pending
  }

  function compose(mailto) {
    // Before the sign-in has reached Outlook, the configured endpoint says
    // which Outlook (work or personal) the new message belongs to.
    var current = String(view.url || "")
    var url = Links.composeUrl(mailto, Links.isOutlook(current) ? current : (settings.url || defaultUrl))
    openPopout(null, url)
  }

  function openPopout(request, url) {
    trace("popout", request ? request.requestedUrl : url)
    var popout = popoutWindow.createObject(null, {
      profile: profile,
      host: win,
      background: win.color,
      zoomFactor: win.zoom,
      width: Math.max(720, Math.round(win.width * 0.62)),
      height: Math.max(560, Math.round(win.height * 0.9))
    })
    if (!popout) { if (request) openExternal(request.requestedUrl); return }
    var list = popouts.slice()
    list.push(popout)
    popouts = list
    popout.closed.connect(function() {
      win.popouts = win.popouts.filter(function(p) { return p !== popout })
      statusTimer.restart()
    })
    if (request) request.openIn(popout.view)
    else popout.view.url = url
    popout.show()
    popout.requestActivate()
    statusTimer.restart()
  }

  function openAuth(request) {
    trace("auth", request.requestedUrl)
    var popup = authWindow.createObject(null, { profile: profile, background: win.color, host: win })
    if (!popup) { request.reject ? request.reject() : null; return }
    request.openIn(popup.view)
    popup.show()
  }

  // ------------------------------------------------------------ memory
  // Outlook keeps much of what a long session piles up: after days in the
  // background its page holds several times what a fresh one needs. A browser
  // tab gets reloaded or discarded now and then; this window may run hidden
  // for weeks, so it does that itself -- only while nobody is looking, no
  // popout is open and no message is being written.
  //
  // How big a fresh page is depends on the account, so the page is measured
  // once it has settled, and reloading starts only at half as much again on
  // top, or at memoryLimit if that is higher.
  function checkMemory() {
    if (recycling) return
    pageMemory = Sys.processMemory(view.renderProcessPid)
    totalMemory = Sys.treeMemory(Sys.pid())
    if (pageBaseline < 0 && pageMemory > 0 && Date.now() - pageLoadedAt >= baselineDelayMs)
      pageBaseline = pageMemory
    statusTimer.restart()
    if (effectiveLimit <= 0 || pageBaseline < 0 || pageMemory <= effectiveLimit) return
    if (!concealed || win.active || Date.now() - concealedSince < recycleIdleMs) return
    if (Date.now() - lastRecycle < recycleSpacingMs) return
    if (popouts.length > 0 || activeDownloads > 0 || view.recentlyAudible || view.loading) return
    view.runJavaScript("window.__omaoutlookBusy ? window.__omaoutlookBusy() : false", function(busy) {
      if (busy !== true && win.concealed && !win.active && win.popouts.length === 0) win.recycle()
    })
  }

  // V8 keeps the heap a page grew to -- loading the mail list, a search, a
  // big thread -- long after the objects in it are gone, and Chromium's own
  // memory reducer does not get it back from a page that runs hidden. A full
  // collection does: on a settled Outlook it returns about 40 % of the
  // renderer. Run in the page's own world (gc comes from --expose-gc, see
  // main.cpp), a minute after the window went out of sight and every ten
  // minutes after that, which costs a few hundred milliseconds nobody sees.
  function trimMemory() {
    if (recycling || !concealed) return
    // "last-resort" is V8's memory-reducing collection (several compacting
    // passes, then the free pages go back to the system): ~850 -> ~510 MiB
    // on a settled Outlook, where a plain gc() frees next to nothing.
    var js = "(function () { if (typeof gc === 'function' && /\\[native code\\]/.test(String(gc)))"
      + " gc({ type: 'major', execution: 'sync', flavor: 'last-resort' }); })()"
    view.runJavaScript(js)
    for (var i = 0; i < popouts.length; i++) popouts[i].view.runJavaScript(js)
    trace("trim", String(view.url))
  }

  // The page is discarded and brought back once its renderer process has
  // ended, so the new page starts in a fresh process and the old one's memory
  // goes back to the system. A plain reload keeps the process and with it
  // nearly all of that memory. Chromium refuses to discard a page that is
  // shown, so the view is taken off screen meanwhile.
  function recycle() {
    if (recycling) return
    lastRecycle = Date.now()
    recyclePid = view.renderProcessPid
    recycling = true
    view.visible = false
    view.lifecycleState = WebEngineView.LifecycleState.Discarded
    if (view.lifecycleState !== WebEngineView.LifecycleState.Discarded) {
      view.visible = true
      recycling = false
      view.reload()
      pageBaseline = -1
      pageLoadedAt = Date.now()
    } else {
      reviveTimer.restart()
    }
    statusTimer.restart()
  }

  function revive() {
    if (!recycling) return
    reviveTimer.stop()
    recycling = false
    view.lifecycleState = WebEngineView.LifecycleState.Active
    view.visible = true
    pageBaseline = -1
    pageLoadedAt = Date.now()
    memoryRecheck.restart()
  }

  function restoreGeometry() {
    var s = safeJson(Sys.readFile(windowStatePath))
    if (!s) return
    if (Number(s.width) >= minimumWidth) win.width = Number(s.width)
    if (Number(s.height) >= minimumHeight) win.height = Number(s.height)
  }

  function handleCommand(connection, line) {
    var text = String(line)
    var cmd = text.split(/\s+/)[0]
    var arg = text.slice(cmd.length).trim()
    function answer(t) { if (connection > 0) Sys.reply(connection, t) }
    switch (cmd) {
    case "show": showWindow(); answer("ok"); break
    case "hide": win.hide(); answer("ok"); break
    case "toggle":
      if (win.visible) win.hide(); else showWindow()
      answer("ok")
      break
    case "compose": compose("mailto:"); answer("ok"); break
    case "open":
      openLink(arg)
      answer("ok")
      break
    case "status": answer(JSON.stringify(statusObject())); break
    case "reload": recycle(); answer("ok"); break
    case "reload-theme": loadTheme(); refreshRounding(); answer("ok"); break
    case "quit": answer("ok"); quit(); break
    default: answer("unknown command: " + cmd)
    }
  }

  // A link handed in from outside: the desktop's mailto handler, another app.
  function openLink(url) {
    switch (Links.classify(url)) {
    case "mailto": compose(url); break
    case "outlook": showWindow(); view.url = url; break
    case "teams": openTeams(url); break
    default: openExternal(url)
    }
  }

  function quit() {
    quitting = true
    writeStatus()
    for (var i = 0; i < popouts.length; i++) popouts[i].close()
    Qt.quit()
  }

  // ------------------------------------------------------------ print
  // Outlook prints through window.print(), from the page or from a frame it
  // fills with the message. Chromium on its own would show nothing here; the
  // frame becomes a PDF that opens in the default viewer, which prints.
  function printPath() {
    return Sys.uniquePath(printDir, "Outlook " + Qt.formatDateTime(new Date(), "yyyy-MM-dd hh.mm.ss") + ".pdf")
  }

  // window.print() on the page itself (the frame variant below is for the
  // frames Outlook prints a message from).
  function printView(target) {
    trace("print page", target.url)
    Sys.makePath(printDir)
    target.printToPdf(printPath())
  }

  function printed(path, success) {
    if (success) openExternal("file://" + path)
    else Sys.run("notify-send", ["-a", "Outlook", "-i", "omaoutlook", "Printing failed", "Outlook could not render the page for printing."])
  }

  function printFrame(frame) {
    trace("print frame", frame ? frame.url : "")
    var path = printPath()
    frame.printToPdf(function(data) {
      win.printed(path, !!data && data.byteLength > 0 && Sys.writeBytes(path, data))
    })
  }

  // ------------------------------------------------------------ certificates
  // Certificate-based sign-in: a site asks for a client certificate and
  // Chromium lists the ones the NSS database (~/.pki/nssdb) holds.
  function selectCertificate(selection, parentWindow) {
    var certs = selection.certificates
    if (!certs || certs.length === 0) { selection.selectNone(); return }
    var dialog = certificateDialog.createObject(parentWindow, {
      selection: selection, pal: win.themePalette,
      radius: win.rounding >= 0 ? win.rounding : 8, transientParent: parentWindow
    })
    if (!dialog) { selection.selectNone(); return }
    dialog.show()
    dialog.requestActivate()
  }

  // ------------------------------------------------------------ notifications
  // The security key is the one kind of passkey this window can use: Chromium
  // on Linux has no authenticator of its own, and the phone-and-QR-code route
  // needs a Chromium UI that QtWebEngine does not carry.
  function reportWebAuth(message) {
    if (String(message).indexOf(WebAuth.MARKER) !== 0) return
    Sys.run("notify-send", ["-a", "Outlook", "-i", "omaoutlook",
      "Passkey sign-in did not work",
      "No security key answered. Passkeys kept on this device or on your phone cannot be used here — sign in with your password or the Authenticator app."])
  }

  function presentNotification(notification) {
    if (!notificationsEnabled) { notification.close(); return }
    var id = Sys.runCapture("notify-send", [
      "-a", "Outlook", "-i", "omaoutlook",
      "-h", "string:desktop-entry:omaoutlook",
      "-A", "default=Open",
      String(notification.title || "Outlook"),
      String(notification.message || "")
    ])
    var pending = pendingNotifications
    pending[id] = notification
    pendingNotifications = pending
    notification.closed.connect(function() {
      var p = win.pendingNotifications
      if (p[id] === notification) delete p[id]
    })
  }

  // Attachments land in the download folder under their own name ("name (1)"
  // for a second copy); the notification opens the file or its folder.
  function startDownload(download) {
    var path = Sys.uniquePath(downloadDir, String(download.downloadFileName || "download"))
    download.downloadDirectory = path.slice(0, path.lastIndexOf("/"))
    download.downloadFileName = path.slice(path.lastIndexOf("/") + 1)
    download.accept()
    activeDownloads++
    download.isFinishedChanged.connect(function() {
      if (!download.isFinished) return
      win.activeDownloads = Math.max(0, win.activeDownloads - 1)
      if (download.state !== WebEngineDownloadRequest.DownloadCompleted) return
      var file = download.downloadDirectory + "/" + download.downloadFileName
      var id = Sys.runCapture("notify-send", ["-a", "Outlook", "-i", "omaoutlook",
        "-A", "default=Open", "-A", "folder=Show in folder",
        "Download finished", String(download.downloadFileName)])
      var pending = win.pendingDownloads
      pending[id] = file
      win.pendingDownloads = pending
    })
  }

  // ------------------------------------------------------------ wiring
  Connections {
    target: Sys
    function onFileChanged(path) {
      var p = String(path)
      if (p === win.settingsPath || p === win.configDir) settingsTimer.restart()
      else themeTimer.restart()
    }
    function onProcessFinished(id, exitCode, output) {
      if (id === win.roundingRequest) {
        win.roundingRequest = -1
        var parsed = win.safeJson(output)
        var value = parsed && typeof parsed.int === "number" ? parsed.int : -1
        if (exitCode === 0 && value !== win.rounding) { win.rounding = value; win.rebuildCss() }
        return
      }
      var answer = String(output).trim()
      if (win.pendingHandoffs[id] !== undefined) {
        var handoffs = win.pendingHandoffs
        var url = handoffs[id]
        delete handoffs[id]
        win.pendingHandoffs = handoffs
        // An omateams without the open command answers with an error.
        if (exitCode !== 0) win.openExternal(url)
        return
      }
      if (win.pendingDownloads[id] !== undefined) {
        var downloads = win.pendingDownloads
        var file = downloads[id]
        delete downloads[id]
        win.pendingDownloads = downloads
        if (answer === "default") win.openExternal("file://" + file)
        else if (answer === "folder") win.openExternal("file://" + file.slice(0, file.lastIndexOf("/")))
        return
      }
      var notification = win.pendingNotifications[id]
      if (!notification) return
      var pending = win.pendingNotifications
      delete pending[id]
      win.pendingNotifications = pending
      if (answer === "default") {
        win.showWindow()
        notification.click()
      }
    }
    function onCommand(connection, line) { win.handleCommand(connection, line) }
    function onExposureChanged(window, exposed) {
      if (window === win) {
        win.exposed = exposed
        if (exposed) view.runJavaScript(win.repaintScript())
      } else if (exposed && window.view) {
        window.view.runJavaScript(win.repaintScript())
      }
    }
  }

  Connections {
    target: Qt.application
    function onAboutToQuit() { win.quitting = true; win.writeStatus() }
  }

  Timer { id: statusTimer; interval: 250; onTriggered: win.writeStatus() }
  Timer { id: heartbeat; interval: 60000; repeat: true; running: true; onTriggered: win.writeStatus() }
  Timer { id: focusTimer; interval: 150; onTriggered: Sys.run("sh", ["-c", win.focusCommand]) }
  Timer {
    id: geometryTimer
    interval: 800
    onTriggered: if (win.visibility === Window.Windowed)
      Sys.writeFile(win.windowStatePath, JSON.stringify({ width: win.width, height: win.height }) + "\n")
  }
  Timer {
    id: settingsTimer
    interval: 200
    onTriggered: { win.loadSettings(); Sys.watch(win.settingsPath) }
  }
  // A theme switch rewrites the whole theme directory; wait for it to settle.
  Timer {
    id: themeTimer
    interval: 400
    onTriggered: { win.loadTheme(); win.refreshRounding(); Sys.watch(win.colorsPath); Sys.watch(win.omarchyState) }
  }
  Timer { id: reloadTimer; interval: 1500; onTriggered: view.reload() }
  // Waits for the discarded page's renderer to exit, for half a minute at most.
  Timer {
    id: reviveTimer
    interval: 1000
    repeat: true
    property int ticks: 0
    onRunningChanged: if (running) ticks = 0
    onTriggered: if (++ticks >= 30 || Sys.processMemory(win.recyclePid) < 0) win.revive()
  }
  Timer {
    id: trimTimer
    interval: 60 * 1000
    repeat: true
    onTriggered: { win.trimMemory(); interval = 10 * 60 * 1000 }
    onRunningChanged: if (running) interval = 60 * 1000
  }
  Timer { id: memoryTimer; interval: 5 * 60 * 1000; repeat: true; running: true; onTriggered: win.checkMemory() }
  // Reads the size of the fresh page once it has settled after a reload.
  Timer { id: memoryRecheck; interval: 90 * 1000; onTriggered: win.checkMemory() }

  // Outlook claims most Ctrl combinations for itself (Ctrl+R reply, Ctrl+Q
  // mark as read, Ctrl+N new message), so the window keeps to the few it can
  // take without hiding one of them.
  Shortcut { sequences: ["Ctrl+W"]; onActivated: win.hide() }
  Shortcut { sequences: ["F5", "Ctrl+Shift+R"]; onActivated: view.reload() }
  Shortcut { sequences: ["Ctrl+Shift+F5"]; onActivated: { win.loadTheme(); win.refreshRounding() } }
  Shortcut { sequences: ["Ctrl+=", "Ctrl++"]; onActivated: view.zoomFactor = Math.min(3, view.zoomFactor + 0.1) }
  Shortcut { sequences: ["Ctrl+-"]; onActivated: view.zoomFactor = Math.max(0.5, view.zoomFactor - 0.1) }
  Shortcut { sequences: ["Ctrl+0"]; onActivated: view.zoomFactor = win.zoom }

  Component { id: authWindow; AuthWindow {} }
  Component { id: popoutWindow; PopoutWindow {} }
  Component { id: webAuthDialog; WebAuthDialog {} }
  Component { id: certificateDialog; CertificateDialog {} }

  // Chromium leaves the whole WebAuthn user experience to the application: the
  // PIN, the account to use, the "touch your key now" and the reason a key was
  // refused all arrive here as a request that waits for an answer. A window
  // that ignores it shows a sign-in that can never finish, so the dialog takes
  // the request over and answers it in every case, closing included.
  function showWebAuthUx(request, parentWindow) {
    var dialog = webAuthDialog.createObject(parentWindow, {
      request: request,
      pal: win.themePalette,
      radius: win.rounding >= 0 ? win.rounding : 8,
      transientParent: parentWindow
    })
    if (!dialog) { request.cancel(); return }
    dialog.show()
    dialog.requestActivate()
  }

  // The Outlook app may notify without asking. Granted up front for the
  // Outlook hosts, the page sees Notification.permission === "granted" and
  // its new-mail and reminder notifications work as soon as Outlook's own
  // switch (Settings > General > Notifications) is on.
  function grantNotifications() {
    var hosts = Links.OUTLOOK_HOSTS
    for (var i = 0; i < hosts.length; i++) {
      var permission = profile.queryPermission("https://" + hosts[i], WebEnginePermission.PermissionType.Notifications)
      if (permission.isValid && permission.state !== WebEnginePermission.State.Granted) permission.grant()
    }
  }

  function grantPermission(permission) {
    if (Links.isMicrosoft(String(permission.origin))) permission.grant()
    else permission.deny()
  }

  WebEngineProfile {
    id: profile
    storageName: "outlook"
    offTheRecord: false
    persistentCookiesPolicy: WebEngineProfile.ForcePersistentCookies
    httpCacheType: WebEngineProfile.DiskHttpCache
    httpCacheMaximumSize: 256 * 1024 * 1024

    // Outlook gates features on the browser it sees. The embedded Chromium is
    // a current one; only the QtWebEngine token stops Outlook recognising it.
    Component.onCompleted: httpUserAgent = httpUserAgent.replace(/\s*QtWebEngine\/[\d.]+/, "")

    onPresentNotification: function(notification) { win.presentNotification(notification) }
    onDownloadRequested: function(download) { win.startDownload(download) }
  }

  WebEngineView {
    id: view
    // Sized from the window rather than anchored to it: a window started
    // hidden is never laid out, and Chromium would give the page a 0x0
    // viewport, in which Outlook draws no folder pane and no unread count.
    x: 0
    y: 0
    width: win.width
    height: win.height
    profile: profile
    zoomFactor: win.zoom
    backgroundColor: win.color

    settings.javascriptCanOpenWindows: true
    settings.javascriptCanAccessClipboard: true
    settings.javascriptCanPaste: true
    settings.allowWindowActivationFromJavaScript: true
    settings.fullScreenSupportEnabled: true
    settings.playbackRequiresUserGesture: false
    settings.pdfViewerEnabled: true
    settings.dnsPrefetchEnabled: true
    settings.spatialNavigationEnabled: false

    onTitleChanged: win.parseTitle()
    onJavaScriptConsoleMessage: function(level, message) { win.pageMessage(message) }
    onUrlChanged: statusTimer.restart()

    onPermissionRequested: function(permission) { win.grantPermission(permission) }
    onWebAuthUxRequested: function(request) { win.showWebAuthUx(request, win) }
    onSelectClientCertificate: function(selection) { win.selectCertificate(selection, win) }
    onNewWindowRequested: function(request) { win.routeNewWindow(request, view) }
    onNavigationRequested: function(request) { win.routeNavigation(request, view) }
    onPrintRequestedByFrame: function(frame) { win.printFrame(frame) }
    onPrintRequested: win.printView(view)
    onPdfPrintingFinished: function(filePath, success) { win.printed(filePath, success) }
    onRegisterProtocolHandlerRequested: function(request) { request.reject() }

    onFullScreenRequested: function(request) {
      request.accept()
      if (request.toggleOn) {
        win.windowedVisibility = win.visibility
        win.visibility = Window.FullScreen
      } else {
        win.visibility = win.windowedVisibility === Window.FullScreen ? Window.Windowed : win.windowedVisibility
      }
    }

    onRenderProcessTerminated: function(terminationStatus, exitCode) {
      if (terminationStatus !== WebEngineView.NormalTerminationStatus) reloadTimer.restart()
    }
  }
}
