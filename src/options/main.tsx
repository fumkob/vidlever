// Preact entry for the options page (overview.md §10.1).
// Mounts the settings app; the page is served at chrome-extension://<id>/options.html.

import { render } from "preact";
import { t } from "../shared/i18n.ts";
import { App } from "./App.tsx";

// index.html ships an English <title> as the static default; localize it here so
// the tab follows the active locale like the rest of the UI.
document.title = t("optPageTitle");

const root = document.getElementById("app");
if (root) render(<App />, root);
