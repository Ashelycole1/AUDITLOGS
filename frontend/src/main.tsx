import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Fonts are bundled locally: no third-party hosts (architecture.md 7).
import "@fontsource/host-grotesk/400.css";
import "@fontsource/host-grotesk/500.css";
import "@fontsource/host-grotesk/600.css";
// Bold and italic serve the sign-in hero only.
import "@fontsource/host-grotesk/700.css";
import "@fontsource/host-grotesk/600-italic.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./index.css";
import App from "./App";
import { StoreProvider } from "./store";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>,
);
