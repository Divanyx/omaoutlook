#include "Bridge.h"

#include <QtWebEngineQuick/qtwebenginequickglobal.h>

#include <QCommandLineParser>
#include <QDir>
#include <QGuiApplication>
#include <QLocalServer>
#include <QLocalSocket>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QStandardPaths>
#include <QTextStream>

#ifndef OMAOUTLOOK_VERSION
#define OMAOUTLOOK_VERSION "dev"
#endif

// The host exists for two reasons plain QML cannot cover: QtWebEngine must be
// initialised before the application object exists (Quickshell does neither
// that nor passes argv on to Chromium, which is why the WebEngine cannot run
// inside omarchy-shell), and the window needs its own Wayland app id so
// Hyprland rules and the bar widget can find it.

namespace {

QString socketPath()
{
    QString dir = QStandardPaths::writableLocation(QStandardPaths::RuntimeLocation);
    if (dir.isEmpty())
        dir = QDir::tempPath();
    return dir + QStringLiteral("/omaoutlook.sock");
}

// Forward a command to a running instance. Returns true when one answered.
bool sendToRunning(const QString &command, QString *reply)
{
    QLocalSocket socket;
    socket.connectToServer(socketPath());
    if (!socket.waitForConnected(300))
        return false;
    socket.write(command.toUtf8());
    socket.write("\n");
    socket.flush();
    if (socket.waitForReadyRead(3000))
        *reply = QString::fromUtf8(socket.readAll()).trimmed();
    socket.disconnectFromServer();
    return true;
}

} // namespace

int main(int argc, char *argv[])
{
    // Screen sharing on Wayland goes through PipeWire; Chromium only asks the
    // portal for it when the feature is switched on.
    //
    // The rest keeps a window that may run hidden for weeks small. Chromium
    // holds a spare renderer process ready for the next site (~40 MB that
    // nothing here ever uses) and keeps pages it navigated away from alive in
    // the back/forward cache; a mail client needs neither. One process per
    // site makes Outlook's popouts and the sign-in page share a renderer with
    // the main window instead of starting their own.
    QByteArray flags = qgetenv("QTWEBENGINE_CHROMIUM_FLAGS");
    if (!flags.contains("--enable-features"))
        flags += " --enable-features=WebRTCPipeWireCapturer";
    if (!flags.contains("--disable-features"))
        flags += " --disable-features=SpareRendererForSitePerProcess,BackForwardCache,MediaRouter,OptimizationHints";
    if (!flags.contains("--process-per-site"))
        flags += " --process-per-site";
    // A memory-reducing garbage collection gives back 40 % of what a settled Outlook
    // page holds (V8 keeps the heap it grew to while the mail list loaded);
    // the host runs one when the window has gone out of sight. See Main.qml.
    if (!flags.contains("--expose-gc")) {
        if (flags.contains("--js-flags="))
            flags.replace("--js-flags=", "--js-flags=--expose-gc,");
        else
            flags += " --js-flags=--expose-gc";
    }
    // Seamless single sign-on for tenants that offer it to a Kerberos ticket
    // (kinit); without a ticket Chromium falls back to the normal sign-in.
    if (!flags.contains("--auth-server-allowlist"))
        flags += " --auth-server-allowlist=autologon.microsoftazuread-sso.com";
    qputenv("QTWEBENGINE_CHROMIUM_FLAGS", flags.trimmed());

    for (int i = 1; i < argc; ++i) {
        if (qstrcmp(argv[i], "--debug-port") == 0 && i + 1 < argc)
            qputenv("QTWEBENGINE_REMOTE_DEBUGGING", argv[i + 1]);
    }

    QtWebEngineQuick::initialize();
    QGuiApplication app(argc, argv);
    app.setApplicationName(QStringLiteral("omaoutlook"));
    app.setOrganizationName(QStringLiteral("omaoutlook"));
    app.setApplicationVersion(QStringLiteral(OMAOUTLOOK_VERSION));
    app.setDesktopFileName(QStringLiteral("omaoutlook"));

    QCommandLineParser parser;
    parser.setApplicationDescription(QStringLiteral(
        "Microsoft Outlook in an Omarchy-themed window.\n\n"
        "Commands (sent to the running instance, or start one):\n"
        "  start | show | hide | toggle | compose | open <url> | reload | quit | status | reload-theme\n\n"
        "open takes a mailto: link (starts a new message) or an Outlook link;\n"
        "anything else goes to the default browser."));
    parser.addHelpOption();
    parser.addVersionOption();
    parser.addPositionalArgument(QStringLiteral("command"), QStringLiteral("start, show, hide, toggle, compose, open, reload, quit, status or reload-theme"), QStringLiteral("[command] [url]"));
    QCommandLineOption hiddenOption(QStringLiteral("hidden"), QStringLiteral("Start without showing the window."));
    QCommandLineOption urlOption(QStringLiteral("url"), QStringLiteral("Outlook URL to open."), QStringLiteral("url"));
    QCommandLineOption debugOption(QStringLiteral("debug-port"), QStringLiteral("Expose the Chromium remote debugging port."), QStringLiteral("port"));
    parser.addOption(hiddenOption);
    parser.addOption(urlOption);
    parser.addOption(debugOption);
    parser.process(app);

    // Bare `omaoutlook` opens the window; `omaoutlook --hidden` (the autostart
    // path) only makes sure an instance exists and never brings it forward.
    // A bare link (the desktop entry's mailto handler passes one) means open.
    QStringList positional = parser.positionalArguments();
    if (!positional.isEmpty() && positional.first().contains(QLatin1Char(':')))
        positional.prepend(QStringLiteral("open"));
    const QString command = positional.isEmpty()
        ? (parser.isSet(hiddenOption) ? QStringLiteral("start") : QStringLiteral("show"))
        : positional.first();
    const QStringList known = { QStringLiteral("start"), QStringLiteral("show"), QStringLiteral("hide"), QStringLiteral("toggle"),
                                QStringLiteral("compose"), QStringLiteral("open"),
                                QStringLiteral("reload"), QStringLiteral("quit"), QStringLiteral("status"), QStringLiteral("reload-theme") };
    QTextStream out(stdout), err(stderr);
    if (!known.contains(command)) {
        err << "omaoutlook: unknown command '" << command << "'\n";
        return 2;
    }
    const QString target = positional.value(1);
    if (command == QLatin1String("open") && target.isEmpty()) {
        err << "omaoutlook: open needs a link\n";
        return 2;
    }
    // The socket protocol is one line per command; the link is percent-safe
    // already, but a newline in a hand-typed argument must not split it.
    const QString line = command == QLatin1String("open")
        ? QStringLiteral("open ") + QString(target).remove(QLatin1Char('\n')).remove(QLatin1Char('\r'))
        : command;

    QString reply;
    if (command == QLatin1String("start") && sendToRunning(QStringLiteral("status"), &reply))
        return 0;
    if (sendToRunning(line, &reply)) {
        if (!reply.isEmpty())
            out << reply << "\n";
        // An instance from an older build does not know every command.
        return reply.startsWith(QLatin1String("unknown command")) ? 1 : 0;
    }
    if (command == QLatin1String("hide") || command == QLatin1String("quit") || command == QLatin1String("reload")
        || command == QLatin1String("status") || command == QLatin1String("reload-theme")) {
        if (command == QLatin1String("status"))
            out << "{\"running\": false}\n";
        else
            err << "omaoutlook: not running\n";
        return command == QLatin1String("status") ? 0 : 1;
    }

    // No instance answered: this process becomes it. A stale socket from a
    // crashed instance would otherwise block listen().
    QLocalServer::removeServer(socketPath());
    QLocalServer server;
    if (!server.listen(socketPath())) {
        err << "omaoutlook: cannot listen on " << socketPath() << ": " << server.errorString() << "\n";
        return 1;
    }
    Bridge bridge(&server);

    QQmlApplicationEngine engine;
    engine.rootContext()->setContextProperty(QStringLiteral("Sys"), &bridge);
    engine.rootContext()->setContextProperty(QStringLiteral("appVersion"), QStringLiteral(OMAOUTLOOK_VERSION));
    engine.setInitialProperties({
        { QStringLiteral("startHidden"), parser.isSet(hiddenOption) },
        { QStringLiteral("startUrl"), parser.value(urlOption) },
        // compose and open on a fresh instance run once the window is up.
        { QStringLiteral("startCommand"), (command == QLatin1String("compose") || command == QLatin1String("open")) ? line : QString() },
    });

    // OMAOUTLOOK_QML_DIR points the host at QML on disk for development; the
    // release binary carries its QML as resources.
    const QString qmlDir = qEnvironmentVariable("OMAOUTLOOK_QML_DIR");
    const QUrl mainUrl = qmlDir.isEmpty()
        ? QUrl(QStringLiteral("qrc:/qml/Main.qml"))
        : QUrl::fromLocalFile(QDir(qmlDir).filePath(QStringLiteral("Main.qml")));
    QObject::connect(&engine, &QQmlApplicationEngine::objectCreationFailed, &app, [] { QCoreApplication::exit(1); }, Qt::QueuedConnection);
    engine.load(mainUrl);
    if (engine.rootObjects().isEmpty())
        return 1;
    return app.exec();
}
