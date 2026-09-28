import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const boot = () => createRoot(document.getElementById("root")!).render(<App />);

// In a plain browser during development, fake the backend (see dev/mock.ts).
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
  void import("./dev/mock").then(boot);
} else {
  boot();
}
