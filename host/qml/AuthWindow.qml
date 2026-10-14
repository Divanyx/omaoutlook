import QtQuick
import QtQuick.Window
import QtWebEngine

// A dialog for the sign-in popups Microsoft's login (or an organisation's
// identity provider) opens with window.open, and for the dialogs Outlook
// add-ins open: it shares the main profile so the resulting session lands in
// the same cookie jar, and it closes itself when the page calls
// window.close().
Window {
  id: root

  property alias view: authView
  property var profile: null
  property color background: "#101315"
  // The main window, which owns the theme, the routing and the dialogs.
  property var host: null

  width: 560
  height: 720
  minimumWidth: 360
  minimumHeight: 400
  flags: Qt.Dialog
  title: authView.title.length > 0 ? authView.title : "Sign in"
  color: background

  onClosing: Qt.callLater(root.destroy)

  WebEngineView {
    id: authView
    anchors.fill: parent
    profile: root.profile
    backgroundColor: root.background
    settings.javascriptCanOpenWindows: true
    settings.javascriptCanAccessClipboard: true

    onJavaScriptConsoleMessage: function(level, message) { if (root.host) root.host.reportWebAuth(message) }

    onWindowCloseRequested: root.close()
    // Redirect chains inside the login flow stay in this dialog; a mailto or
    // a plain link (privacy statement, help) goes where it belongs.
    onNewWindowRequested: function(request) {
      var kind = root.host ? root.host.linkKind(String(request.requestedUrl)) : "signin"
      if (kind === "mailto" || kind === "teams") root.host.routeNewWindow(request, authView)
      else request.openIn(authView)
    }
    onPermissionRequested: function(permission) { permission.deny() }
    // Passkeys and security keys are used right here, on the sign-in page.
    onWebAuthUxRequested: function(request) {
      if (root.host) root.host.showWebAuthUx(request, root)
      else request.cancel()
    }
    onSelectClientCertificate: function(selection) {
      if (root.host) root.host.selectCertificate(selection, root)
      else selection.selectNone()
    }
  }
}
