import QtQuick
import QtQuick.Window
import QtWebEngine

// An Outlook window of its own: a popped-out message, a new mail, a calendar
// item. Outlook either opens an empty window and draws into it from the main
// page, or loads one of its deeplinks; both share the main profile and, with
// one process per site, the main window's renderer. Closed, it is destroyed,
// and its page with it.
Window {
  id: root

  property alias view: popoutView
  property var profile: null
  property var host: null
  property color background: "#101315"
  property real zoomFactor: 1
  signal closed()

  minimumWidth: 420
  minimumHeight: 320
  title: popoutView.title.length > 0 ? popoutView.title : "Outlook"
  color: background

  Component.onCompleted: Sys.watchExposure(root)
  onClosing: { root.closed(); Qt.callLater(root.destroy) }

  Shortcut { sequences: ["Ctrl+W"]; onActivated: root.close() }
  Shortcut { sequences: ["Ctrl+=", "Ctrl++"]; onActivated: popoutView.zoomFactor = Math.min(3, popoutView.zoomFactor + 0.1) }
  Shortcut { sequences: ["Ctrl+-"]; onActivated: popoutView.zoomFactor = Math.max(0.5, popoutView.zoomFactor - 0.1) }
  Shortcut { sequences: ["Ctrl+0"]; onActivated: popoutView.zoomFactor = root.zoomFactor }

  WebEngineView {
    id: popoutView
    anchors.fill: parent
    profile: root.profile
    zoomFactor: root.zoomFactor
    backgroundColor: root.background

    settings.javascriptCanOpenWindows: true
    settings.javascriptCanAccessClipboard: true
    settings.javascriptCanPaste: true
    settings.allowWindowActivationFromJavaScript: true
    settings.playbackRequiresUserGesture: false
    settings.pdfViewerEnabled: true

    // Sending a popped-out mail closes its window from the page.
    onWindowCloseRequested: root.close()
    onJavaScriptConsoleMessage: function(level, message) { if (root.host) root.host.pageMessage(message) }
    onNewWindowRequested: function(request) { root.host.routeNewWindow(request, popoutView) }
    onNavigationRequested: function(request) { root.host.routeNavigation(request, popoutView) }
    onPermissionRequested: function(permission) { root.host.grantPermission(permission, root) }
    onWebAuthUxRequested: function(request) { root.host.showWebAuthUx(request, root) }
    onSelectClientCertificate: function(selection) { root.host.selectCertificate(selection, root) }
    onPrintRequestedByFrame: function(frame) { root.host.printFrame(frame) }
    onPrintRequested: root.host.printView(popoutView)
    onPdfPrintingFinished: function(filePath, success) { root.host.printed(filePath, success) }
  }
}
