// Entry point only — all logic lives in app.js so tests can build the app
// (with an injected scraper factory) without binding a port.
import { createApp } from "./app.js";

const PORT = parseInt(process.env.PORT || "3000", 10);

createApp().listen(PORT, () => {
  console.log(`Scraper sidecar listening on port ${PORT}`);
});
