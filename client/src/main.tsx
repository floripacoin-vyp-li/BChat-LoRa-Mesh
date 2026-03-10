import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { queryClient } from "./lib/queryClient";
import { initBridge } from "./lib/bridge";

(window as any).queryClient = queryClient;
initBridge();

createRoot(document.getElementById("root")!).render(<App />);

// Register service worker for PWA offline caching (all environments)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => console.log("SW registered:", reg.scope))
      .catch((err) => console.warn("SW registration failed:", err));
  });
}
