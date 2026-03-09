import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { queryClient } from "./lib/queryClient";

(window as any).queryClient = queryClient;

createRoot(document.getElementById("root")!).render(<App />);

// Register service worker for PWA support (production only)
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => console.log("SW registered:", reg.scope))
      .catch((err) => console.warn("SW registration failed:", err));
  });
}
