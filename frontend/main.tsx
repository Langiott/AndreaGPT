import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import App from "./pages/Chat_page";
import "./styles/styles.css";

function AndreaGPT() {
  useEffect(() => {
    document.dispatchEvent(new Event("andreagpt:ready"));
  }, []);

  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AndreaGPT />
  </StrictMode>,
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/app-worker.js", { updateViaCache: "none" }).catch(error => {
    console.warn("Schermata di connessione non disponibile:", error);
  });
}
