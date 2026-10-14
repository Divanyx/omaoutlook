QT += quick webenginequick network
CONFIG += c++17
TARGET = omaoutlook

isEmpty(OMAOUTLOOK_VERSION): OMAOUTLOOK_VERSION = dev
DEFINES += OMAOUTLOOK_VERSION=\\\"$${OMAOUTLOOK_VERSION}\\\"

SOURCES += main.cpp Bridge.cpp
HEADERS += Bridge.h
RESOURCES += qml.qrc
