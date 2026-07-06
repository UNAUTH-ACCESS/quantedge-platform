import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ErrorBoundary } from "./components/system/ErrorBoundary";
import App from "./App";
import "./index.css";

window.onerror = function(msg, src, line, col, err) {
  document.getElementById("root").innerHTML = '<div style="background:#0A0A0F;color:#FF4D6D;padding:20px;font-family:monospace;font-size:11px;white-space:pre-wrap;word-break:break-all">' + msg + "\n\n" + (src||"") + ":" + line + "\n\n" + ((err&&err.stack)||"") + "</div>";
};
window.addEventListener("unhandledrejection", function(e) {
  document.getElementById("root").innerHTML = '<div style="background:#0A0A0F;color:#FF4D6D;padding:20px;font-family:monospace;font-size:11px;white-space:pre-wrap;word-break:break-all">Unhandled rejection:\n\n' + ((e.reason&&e.reason.stack)||e.reason||"unknown") + "</div>";
});

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
);
