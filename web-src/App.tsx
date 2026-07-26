import { AppBootstrap } from "./startup/AppBootstrap";

export function App() {
  return <AppBootstrap loadUiModule={() => import("./components/starting")} />;
}
