#!/bin/bash
# Runs scripts/xbrowser-check.mjs firefox with a real (xvfb) window and an AT-SPI session so Firefox exposes its
# platform accessibility tree, then asserts on it. Free local tooling only (see xbrowser-check.mjs):
# apt: xvfb dbus-x11 at-spi2-core python3-pyatspi; Firefox from conda-forge. Usage: XB_BUILD=<web export> scripts/xbrowser-atspi.sh
set -e
exec dbus-run-session -- xvfb-run -a -s "-screen 0 1600x1000x24" bash -c '
  /usr/libexec/at-spi-bus-launcher --launch-immediately >/dev/null 2>&1 &
  sleep 2
  gdbus call --session --dest org.a11y.Bus --object-path /org/a11y/bus --method org.freedesktop.DBus.Properties.Set org.a11y.Status IsEnabled "<true>" >/dev/null 2>&1 || true
  gdbus call --session --dest org.a11y.Bus --object-path /org/a11y/bus --method org.freedesktop.DBus.Properties.Set org.a11y.Status ScreenReaderEnabled "<true>" >/dev/null 2>&1 || true
  export GNOME_ACCESSIBILITY=1 XB_ATSPI=1
  node scripts/xbrowser-check.mjs firefox
'
