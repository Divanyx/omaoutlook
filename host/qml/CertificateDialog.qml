import QtQuick
import QtQuick.Window
import QtWebEngine

// Certificate-based sign-in. A site that asks for a client certificate gets
// one only after it is picked here; Chromium waits for the answer, so closing
// the dialog answers too, with none.
Window {
  id: root

  property var selection: null
  property var pal: ({})
  property int radius: 8
  property bool answered: false

  readonly property color bg: pal.bg || "#101315"
  readonly property color card: pal.card || "#181c1e"
  readonly property color fg: pal.fg || "#cacccc"
  readonly property color fgDim: pal.fg3 || "#8b8f90"
  readonly property color accent: pal.accent || "#3b82f6"
  readonly property color onAccent: pal.onBrand || "#ffffff"
  readonly property string hostName: selection ? String(selection.host).replace(/^[a-z]+:\/\//, "").replace(/\/.*$/, "") : ""

  width: 480
  height: Math.min(560, body.implicitHeight + 40)
  minimumWidth: 360
  minimumHeight: 200
  flags: Qt.Dialog
  modality: Qt.WindowModal
  color: bg
  title: qsTr("Choose a certificate")

  onClosing: {
    if (!answered && selection) { answered = true; selection.selectNone() }
    Qt.callLater(root.destroy)
  }

  function choose(index) {
    if (answered || !selection) return
    answered = true
    selection.select(index)
    root.close()
  }

  function shortDate(d) { return d ? Qt.formatDate(d, "dd-MM-yyyy") : "" }

  Column {
    id: body
    anchors.fill: parent
    anchors.margins: 20
    spacing: 12

    Text {
      width: parent.width
      text: qsTr("Sign in with a certificate")
      color: root.fg
      font.pixelSize: 16
      font.bold: true
    }
    Text {
      width: parent.width
      text: qsTr("%1 asks for a certificate to identify you.").arg(root.hostName)
      color: root.fgDim
      font.pixelSize: 13
      wrapMode: Text.WordWrap
    }

    Repeater {
      model: root.selection ? root.selection.certificates : []
      delegate: Rectangle {
        id: cert
        required property var modelData
        required property int index
        readonly property bool expired: modelData.expiryDate && modelData.expiryDate < new Date()
        width: body.width
        height: certText.implicitHeight + 18
        radius: root.radius
        color: certArea.containsMouse ? root.accent : root.card
        opacity: expired ? 0.55 : 1
        Column {
          id: certText
          anchors.verticalCenter: parent.verticalCenter
          anchors.left: parent.left
          anchors.right: parent.right
          anchors.margins: 12
          spacing: 2
          Text {
            width: parent.width
            elide: Text.ElideRight
            text: cert.modelData.subject
            color: certArea.containsMouse ? root.onAccent : root.fg
            font.pixelSize: 13
          }
          Text {
            width: parent.width
            elide: Text.ElideRight
            text: qsTr("Issued by %1 · valid until %2").arg(cert.modelData.issuer).arg(root.shortDate(cert.modelData.expiryDate))
              + (cert.expired ? qsTr(" (expired)") : "")
            color: certArea.containsMouse ? root.onAccent : root.fgDim
            font.pixelSize: 11
          }
        }
        MouseArea {
          id: certArea
          anchors.fill: parent
          hoverEnabled: true
          cursorShape: Qt.PointingHandCursor
          onClicked: root.choose(cert.index)
        }
      }
    }

    Rectangle {
      anchors.right: parent.right
      width: cancelText.implicitWidth + 28
      height: 34
      radius: root.radius
      color: cancelArea.containsMouse ? Qt.lighter(root.card, 1.3) : root.card
      Text { id: cancelText; anchors.centerIn: parent; text: qsTr("Don't use a certificate"); color: root.fg; font.pixelSize: 13 }
      MouseArea { id: cancelArea; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: root.close() }
    }
  }

  Shortcut { sequences: ["Escape"]; onActivated: root.close() }
}
