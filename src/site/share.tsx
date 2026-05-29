import { createRoot } from "react-dom/client";
import { SharePage } from "./SharePage";
import "./styles.css";

const root = document.getElementById("root");

if (root) {
  createRoot(root).render(<SharePage />);
}
