import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { DeviceLinkWindow } from "./auth/DeviceLinkWindow";
import {
  CollectorConsentWindow,
  CollectorControlsWindow,
} from "./collector/CollectorStatus";
import {
  COLLECTOR_CONTROLS_WINDOW_LABEL,
  CONSENT_WINDOW_LABEL,
  DEVICE_LINK_WINDOW_LABEL,
  currentWindowLabel,
} from "./collector/collectorWindows";

if (import.meta.env.DEV) {
  void import("./dev/DevOverlayDiagnostics.css");
}

function Root() {
  const label = currentWindowLabel();

  if (label === CONSENT_WINDOW_LABEL) {
    return <CollectorConsentWindow />;
  }

  if (label === COLLECTOR_CONTROLS_WINDOW_LABEL) {
    return <CollectorControlsWindow />;
  }

  if (label === DEVICE_LINK_WINDOW_LABEL) {
    return <DeviceLinkWindow />;
  }

  return <App />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
