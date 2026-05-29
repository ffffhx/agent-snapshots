import { createRoot } from "react-dom/client";
import { HomePage } from "./HomePage";
import "./styles.css";

const root = document.getElementById("root");

if (root) {
  createRoot(root).render(<HomePage />);
}
