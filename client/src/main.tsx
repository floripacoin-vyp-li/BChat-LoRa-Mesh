import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { queryClient } from "./lib/queryClient";

(window as any).queryClient = queryClient;

createRoot(document.getElementById("root")!).render(<App />);
