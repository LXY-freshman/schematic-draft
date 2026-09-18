# Schematic Draft — attribution and licensing

Schematic Draft is an offline desktop build of **Analog Canvas**, an
open-source schematic editor.

- Upstream project: Analog Canvas — https://github.com/cascode-ai/analog-canvas
- Upstream author: cascode-ai
- License: GNU Affero General Public License, version 3 (see `LICENSE.md`)

This build is a modified version of that program. The modifications turn the
hosted web application into a desktop application that runs entirely on one
computer:

- the editor is served from bundled files over a private `app://` scheme
  instead of a web server;
- Projects are stored as plain files under `Documents\Schematic Draft\Projects`
  instead of a cloud account;
- every outbound network request is refused before a connection is made;
- the hosted-only surfaces (accounts, Gallery, publishing, usage analytics,
  the agent relay and the hosted simulator) are removed from the interface.

## Your rights under the AGPL

The AGPL gives you the right to obtain, study, modify and redistribute the
complete corresponding source code of this program, including the
modifications listed above. The source tree that produced this build ships
alongside it; if you received a binary without it, the upstream project above
plus this notice describe where the changes live (`apps/desktop/**` and the
`VITE_ICM_DESKTOP` branches under `apps/editor/src/**`).

If you redistribute this program, modified or not, you must pass the same
rights on and keep this notice and `LICENSE.md` intact.

## Bundled third-party software

- Electron and the Chromium runtime it embeds, under their respective licenses
  (`LICENSE` and `LICENSES.chromium.html` in the installation directory).
- The libraries listed in the upstream project's `package.json` files, bundled
  into the editor assets under their own licenses.

The application icon is an original work made for this build and is licensed
under the AGPL-3.0 along with the rest of the program.
