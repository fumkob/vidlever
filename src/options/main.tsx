// Preact entry for the options page (overview.md §10.1).
// Mounts the settings app; the page is served at chrome-extension://<id>/options.html.

import { render } from "preact";
import { App } from "./App.tsx";

const root = document.getElementById("app");
if (root) render(<App />, root);
