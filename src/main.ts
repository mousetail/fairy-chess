import { HomeScreen } from "./home-screen";

const app = document.getElementById("app")!;

const screen = new HomeScreen();
screen.activate(app);
