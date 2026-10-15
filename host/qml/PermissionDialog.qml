import QtQuick
import QtQuick.Window
import QtWebEngine

// A site asks for the microphone, the camera, the screen or the location.
// Chromium waits for the answer; closing the dialog answers too, with no.
Window {
  id: root

  property var permission: null
  property string what: ""
  property var pal: ({})
  property int radius: 8
  property bool answered: false

  readonly property color bg: pal.bg || "#101315"
  readonly property color card: pal.card || "#181c1e"
  readonly property color fg: pal.fg || "#cacccc"
  readonly property color fgDim: pal.fg3 || "#8b8f90"
  readonly property color accent: pal.accent || "#3b82f6"
  readonly property color onAccent: pal.onBrand || "#ffffff"
  readonly property string hostName: permission ? String(permission.origin).replace(/^[a-z]+:\/\//, "").replace(/\/.*$/, "") : ""

  width: 420
  height: body.implicitHeight + 40
  minimumWidth: 320
  flags: Qt.Dialog
  modality: Qt.WindowModal
  color: bg
  title: qsTr("Permission")

  onClosing: {
    if (!answered && permission) { answered = true; permission.deny() }
    Qt.callLater(root.destroy)
  }

  function answer(allow) {
    if (answered || !permission) return
    answered = true
    if (allow) permission.grant()
    else permission.deny()
    root.close()
  }

  Column {
    id: body
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.top: parent.top
    anchors.margins: 20
    spacing: 12

    Text {
      width: parent.width
      text: qsTr("Allow %1 to %2?").arg(root.hostName).arg(root.what)
      color: root.fg
      font.pixelSize: 15
      font.bold: true
      wrapMode: Text.WordWrap
    }
    Text {
      width: parent.width
      text: qsTr("Outlook remembers the answer for this site.")
      color: root.fgDim
      font.pixelSize: 13
      wrapMode: Text.WordWrap
    }

    Row {
      anchors.right: parent.right
      spacing: 8
      Rectangle {
        width: denyText.implicitWidth + 28
        height: 34
        radius: root.radius
        color: denyArea.containsMouse ? Qt.lighter(root.card, 1.3) : root.card
        Text { id: denyText; anchors.centerIn: parent; text: qsTr("Don't allow"); color: root.fg; font.pixelSize: 13 }
        MouseArea { id: denyArea; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: root.answer(false) }
      }
      Rectangle {
        width: allowText.implicitWidth + 28
        height: 34
        radius: root.radius
        color: allowArea.containsMouse ? Qt.lighter(root.accent, 1.15) : root.accent
        Text { id: allowText; anchors.centerIn: parent; text: qsTr("Allow"); color: root.onAccent; font.pixelSize: 13 }
        MouseArea { id: allowArea; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: root.answer(true) }
      }
    }
  }

  Shortcut { sequences: ["Escape"]; onActivated: root.close() }
}
