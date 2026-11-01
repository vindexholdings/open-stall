#!/usr/bin/python3.12
"""Dump the PLATFORM accessibility tree (AT-SPI) that Firefox exposes for the page, as JSON on stdout.
This is the tree a screen reader such as Orca consumes: role, accessible name, states and ARIA-derived attributes.
It is NOT a screen-reader run. Needs a desktop AT-SPI session (see scripts/xbrowser-check.mjs, XB_ATSPI=1)."""
import json
import sys

import pyatspi

STATES = {
    'checked': pyatspi.STATE_CHECKED, 'selected': pyatspi.STATE_SELECTED, 'expanded': pyatspi.STATE_EXPANDED,
    'focused': pyatspi.STATE_FOCUSED, 'focusable': pyatspi.STATE_FOCUSABLE, 'enabled': pyatspi.STATE_ENABLED,
    'invalid': pyatspi.STATE_INVALID_ENTRY, 'showing': pyatspi.STATE_SHOWING,
}


def walk(node, depth, out, limit):
    if len(out) >= limit:
        return
    try:
        role = node.getRoleName()
        name = node.name
        st = node.getState()
        attrs = dict(a.split(':', 1) for a in node.getAttributes() if ':' in a)
        out.append({
            'depth': depth, 'role': role, 'name': name, 'states': [k for k, v in STATES.items() if st.contains(v)],
            'attrs': {k: attrs[k] for k in ('level', 'xml-roles', 'current', 'tag', 'id') if k in attrs},
        })
        for i in range(node.childCount):
            walk(node.getChildAtIndex(i), depth + 1, out, limit)
    except Exception:  # a node can vanish while walking
        return


def main():
    want = sys.argv[1] if len(sys.argv) > 1 else 'Firefox'
    desktop = pyatspi.Registry.getDesktop(0)
    nodes = []
    for i in range(desktop.childCount):
        app = desktop.getChildAtIndex(i)
        if app is not None and want.lower() in (app.name or '').lower():
            walk(app, 0, nodes, 6000)
    json.dump(nodes, sys.stdout)


main()
