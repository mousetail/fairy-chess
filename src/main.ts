import ChessScreen from "./chess-screen";
import images from "./images";

const app = document.getElementById("app")!;

const screen = new ChessScreen();
screen.activate(app);

console.log(images.classic.bishop.black);
