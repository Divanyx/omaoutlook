import QtQuick
import Quickshell
import qs.Commons
import qs.Ui

// One glyph, one number, three clicks. The service owns the state; the widget is
// what hands the plugin settings over and what the click lands on.
BarWidget {
  id: root

  moduleName: "omaoutlook"

  readonly property var outlook: bar && bar.shell && typeof bar.shell.serviceFor === "function"
    ? bar.shell.serviceFor("omaoutlook") : null
  readonly property color foreground: bar ? bar.barForeground : Color.foreground
  readonly property bool drawsIcon: setting("showBarIcon", true) !== false
  readonly property bool showCount: setting("showCount", true) !== false
  readonly property int unread: outlook ? outlook.unread : 0
  readonly property bool activity: !!outlook && outlook.activity
  readonly property bool running: !!outlook && outlook.running
  readonly property bool countVisible: drawsIcon && showCount && unread > 0 && !vertical

  // The shell hands settings to the bar widget, not to the service, so the
  // widget forwards them; the service writes them where the window reads them.
  function pushSettings() {
    if (outlook && typeof outlook.applySettings === "function") outlook.applySettings(settings)
  }
  onSettingsChanged: pushSettings()
  onOutlookChanged: pushSettings()
  Component.onCompleted: pushSettings()

  visible: drawsIcon
  implicitWidth: drawsIcon ? row.implicitWidth : 0
  implicitHeight: drawsIcon ? row.implicitHeight : 0

  Row {
    id: row
    anchors.centerIn: parent
    spacing: 0

    BarIconButton {
      id: button
      bar: root.bar
      // nf-md-microsoft_outlook from the Nerd Font the bar already uses, so
      // the icon sits on the same optical grid as every other widget.
      text: "\udb83\udd22"
      dimmed: !root.running
      tooltipText: root.outlook ? root.outlook.tooltip : "Outlook"

      // Unread marker at the glyph's top-right corner, ringed in the bar color
      // so it stays legible over the glyph's stroke.
      Rectangle {
        visible: root.unread > 0 || root.activity
        width: Style.space(5)
        height: width
        radius: width / 2
        color: Color.accent
        border.color: Color.bar.background
        border.width: 1
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.verticalCenter: parent.verticalCenter
        anchors.horizontalCenterOffset: Style.bar.iconCanvas * 0.42
        anchors.verticalCenterOffset: -Style.bar.iconCanvas * 0.42
      }

      onPressed: function(buttonCode) {
        if (!root.outlook) return
        if (buttonCode === Qt.LeftButton) root.outlook.toggle()
        else if (buttonCode === Qt.RightButton) root.outlook.show()
        // Middle click writes a new message, like the app's taskbar menu.
        else if (buttonCode === Qt.MiddleButton) root.outlook.compose()
      }
    }

    Text {
      visible: root.countVisible
      anchors.verticalCenter: parent.verticalCenter
      text: root.unread > 99 ? "99+" : String(root.unread)
      color: root.foreground
      font.family: root.bar ? root.bar.fontFamily : Style.font.family
      font.pixelSize: Style.font.body
      rightPadding: Style.space(6)
    }
  }
}
