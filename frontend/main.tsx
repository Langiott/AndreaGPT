import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./pages/Chat_page";
import "./styles/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
