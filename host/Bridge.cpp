#include "Bridge.h"

#include <QCoreApplication>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QGuiApplication>
#include <QStyleHints>
#include <QLocalSocket>
#include <QProcess>
#include <QSaveFile>
#include <QStandardPaths>
#include <QTextStream>
#include <QWindow>

Bridge::Bridge(QLocalServer *server, QObject *parent)
    : QObject(parent), m_server(server)
{
    if (m_server)
        connect(m_server, &QLocalServer::newConnection, this, &Bridge::acceptConnection);

    // QFileSystemWatcher drops a path once the file behind it is replaced or
    // deleted. Theme switches do exactly that, so re-arm the watch on every
    // change and only then tell QML about it.
    auto rearm = [this](const QString &path) {
        if (!m_watcher.files().contains(path) && !m_watcher.directories().contains(path) && QFileInfo::exists(path))
            m_watcher.addPath(path);
        emit fileChanged(path);
    };
    connect(&m_watcher, &QFileSystemWatcher::fileChanged, this, rearm);
    connect(&m_watcher, &QFileSystemWatcher::directoryChanged, this, rearm);
}

QString Bridge::home() const
{
    return QDir::homePath();
}

QString Bridge::runtimeDir() const
{
    const QString dir = QStandardPaths::writableLocation(QStandardPaths::RuntimeLocation);
    return dir.isEmpty() ? QDir::tempPath() : dir;
}

QString Bridge::configDir() const
{
    return QStandardPaths::writableLocation(QStandardPaths::GenericConfigLocation);
}

QString Bridge::stateDir() const
{
    return QStandardPaths::writableLocation(QStandardPaths::GenericStateLocation);
}

QString Bridge::env(const QString &name) const
{
    return qEnvironmentVariable(name.toUtf8().constData());
}

int Bridge::pid() const
{
    return static_cast<int>(QCoreApplication::applicationPid());
}

bool Bridge::exists(const QString &path) const
{
    return QFileInfo::exists(path);
}

QString Bridge::readFile(const QString &path) const
{
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly | QIODevice::Text))
        return QString();
    return QString::fromUtf8(file.readAll());
}

bool Bridge::writeFile(const QString &path, const QString &text)
{
    QDir().mkpath(QFileInfo(path).absolutePath());
    // A watcher on the other side (the bar widget) sees a rename as a change
    // of the directory entry it already follows; QSaveFile gives it a complete
    // file every time instead of a half-written one.
    QSaveFile file(path);
    if (!file.open(QIODevice::WriteOnly | QIODevice::Text))
        return false;
    file.write(text.toUtf8());
    return file.commit();
}

bool Bridge::removeFile(const QString &path)
{
    return QFile::remove(path);
}

bool Bridge::makePath(const QString &path)
{
    return QDir().mkpath(path);
}

void Bridge::watch(const QString &path)
{
    if (path.isEmpty() || !QFileInfo::exists(path))
        return;
    if (!m_watcher.files().contains(path) && !m_watcher.directories().contains(path))
        m_watcher.addPath(path);
}

void Bridge::run(const QString &program, const QStringList &arguments)
{
    QProcess::startDetached(program, arguments);
}

int Bridge::runCapture(const QString &program, const QStringList &arguments)
{
    const int id = m_nextProcess++;
    auto *process = new QProcess(this);
    process->setProgram(program);
    process->setArguments(arguments);
    process->setProcessChannelMode(QProcess::SeparateChannels);
    connect(process, &QProcess::finished, this, [this, process, id](int exitCode, QProcess::ExitStatus) {
        emit processFinished(id, exitCode, QString::fromUtf8(process->readAllStandardOutput()));
        process->deleteLater();
    });
    connect(process, &QProcess::errorOccurred, this, [this, process, id](QProcess::ProcessError error) {
        if (error == QProcess::FailedToStart) {
            emit processFinished(id, -1, QString());
            process->deleteLater();
        }
    });
    process->start();
    return id;
}

void Bridge::reply(int connection, const QString &text)
{
    QPointer<QLocalSocket> socket = m_connections.take(connection);
    if (!socket)
        return;
    socket->write(text.toUtf8());
    socket->write("\n");
    socket->flush();
    socket->disconnectFromServer();
    connect(socket, &QLocalSocket::disconnected, socket, &QObject::deleteLater);
    if (socket->state() == QLocalSocket::UnconnectedState)
        socket->deleteLater();
}

// QML sees no expose events. Hyprland suspends the surfaces of a workspace
// that is not shown, Qt treats a suspended window as unexposed, and when the
// workspace comes back the page has to be told to draw again (see Main.qml).
void Bridge::watchExposure(QWindow *window)
{
    if (!window)
        return;
    window->setProperty("omaoutlookExposed", window->isExposed());
    window->installEventFilter(this);
}

// A window that was never shown has no platform window and no screen, and
// Chromium then lays the page out at 0x0. Creating it without showing it
// gives the page its real size from the start.
void Bridge::createHidden(QWindow *window)
{
    if (window && !window->handle())
        window->create();
}

bool Bridge::eventFilter(QObject *watched, QEvent *event)
{
    if (event->type() == QEvent::Expose) {
        if (auto *window = qobject_cast<QWindow *>(watched)) {
            const bool was = window->property("omaoutlookExposed").toBool();
            const bool now = window->isExposed();
            window->setProperty("omaoutlookExposed", now);
            if (now != was)
                emit exposureChanged(window, now);
        }
    }
    return QObject::eventFilter(watched, event);
}

// Resident plus swapped-out memory of one process, in MiB, or -1 when it
// cannot be read. Swap counts too: on a machine short of memory the kernel
// pushes an idle page out, and RSS alone would hide how big it has grown.
int Bridge::processMemory(int pid) const
{
    if (pid <= 0)
        return -1;
    QFile file(QStringLiteral("/proc/%1/status").arg(pid));
    if (!file.open(QIODevice::ReadOnly | QIODevice::Text))
        return -1;
    qint64 kib = 0;
    bool found = false;
    const QList<QByteArray> lines = file.readAll().split('\n');
    for (const QByteArray &line : lines) {
        if (line.startsWith("VmRSS:") || line.startsWith("VmSwap:")) {
            kib += line.mid(line.indexOf(':') + 1).trimmed().split(' ').value(0).toLongLong();
            found = true;
        }
    }
    return found ? static_cast<int>(kib / 1024) : -1;
}

// Memory of a process and every process below it, in MiB: the host, its
// zygotes and all renderers. What the window costs as a whole. Proportional
// set size, so the pages the Chromium processes share are counted once.
int Bridge::treeMemory(int pid) const
{
    if (pid <= 0)
        return -1;
    QHash<int, QList<int>> children;
    const QStringList entries = QDir(QStringLiteral("/proc")).entryList(QDir::Dirs | QDir::NoDotAndDotDot);
    for (const QString &entry : entries) {
        bool ok = false;
        const int child = entry.toInt(&ok);
        if (!ok)
            continue;
        QFile stat(QStringLiteral("/proc/%1/stat").arg(child));
        if (!stat.open(QIODevice::ReadOnly))
            continue;
        // The command name may hold spaces and parentheses; the parent pid is
        // the second field after the last closing parenthesis.
        const QByteArray text = stat.readAll();
        const QList<QByteArray> fields = text.mid(text.lastIndexOf(')') + 2).split(' ');
        if (fields.size() > 1)
            children[fields.at(1).toInt()].append(child);
    }
    qint64 kib = 0;
    QList<int> queue { pid };
    while (!queue.isEmpty()) {
        const int current = queue.takeFirst();
        QFile rollup(QStringLiteral("/proc/%1/smaps_rollup").arg(current));
        if (rollup.open(QIODevice::ReadOnly | QIODevice::Text)) {
            const QList<QByteArray> lines = rollup.readAll().split('\n');
            for (const QByteArray &line : lines) {
                if (line.startsWith("Pss:") || line.startsWith("SwapPss:"))
                    kib += line.mid(line.indexOf(':') + 1).trimmed().split(' ').value(0).toLongLong();
            }
        }
        queue += children.value(current);
    }
    return static_cast<int>(kib / 1024);
}

// Outlook follows prefers-color-scheme when its dark mode is set to follow
// the system; Chromium takes that from Qt's style hints.
void Bridge::setColorScheme(bool dark)
{
    QGuiApplication::styleHints()->setColorScheme(dark ? Qt::ColorScheme::Dark : Qt::ColorScheme::Light);
}

bool Bridge::writeBytes(const QString &path, const QByteArray &data)
{
    QDir().mkpath(QFileInfo(path).absolutePath());
    QSaveFile file(path);
    if (!file.open(QIODevice::WriteOnly))
        return false;
    file.write(data);
    return file.commit();
}

// "report.pdf" in a directory that has one becomes "report (1).pdf", the way
// a browser names a second download of the same file.
QString Bridge::uniquePath(const QString &directory, const QString &name) const
{
    QString clean = QFileInfo(name).fileName();
    if (clean.isEmpty() || clean == QLatin1String(".") || clean == QLatin1String(".."))
        clean = QStringLiteral("download");
    const QDir dir(directory);
    QString candidate = dir.filePath(clean);
    const QFileInfo info(clean);
    const QString base = info.completeBaseName();
    const QString suffix = info.suffix().isEmpty() ? QString() : QStringLiteral(".") + info.suffix();
    for (int i = 1; QFileInfo::exists(candidate) && i < 1000; ++i)
        candidate = dir.filePath(QStringLiteral("%1 (%2)%3").arg(base).arg(i).arg(suffix));
    return candidate;
}

void Bridge::acceptConnection()
{
    while (QLocalSocket *socket = m_server->nextPendingConnection()) {
        const int id = m_nextConnection++;
        m_connections.insert(id, socket);
        connect(socket, &QLocalSocket::readyRead, this, [this, socket, id] { readCommand(socket, id); });
        connect(socket, &QLocalSocket::disconnected, this, [this, socket, id] {
            m_connections.remove(id);
            socket->deleteLater();
        });
        if (socket->bytesAvailable() > 0)
            readCommand(socket, id);
    }
}

void Bridge::readCommand(QLocalSocket *socket, int id)
{
    if (!socket->canReadLine())
        return;
    const QString line = QString::fromUtf8(socket->readLine()).trimmed();
    if (!line.isEmpty())
        emit command(id, line);
}
