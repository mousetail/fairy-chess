import { HomeScreen } from "./home-screen.ts";

const app = document.getElementById("app")!;

const screen = new HomeScreen();
screen.activate(app);
