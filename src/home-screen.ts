import ChessScreen from "./chess-screen/index";
import type { Screen } from "./screen";

export class HomeScreen implements Screen {
  activate(parent: HTMLElement) {
    const container = document.createElement("div");
    parent.appendChild(container);

    const header = document.createElement("h1");
    header.textContent = "Fairy Chess";
    container.appendChild(header);

    const modeSubHeader = document.createElement("h2");
    modeSubHeader.textContent = "Mode Preference";
    container.appendChild(modeSubHeader);

    container.appendChild(
      this.createRadio('mode', [
        'Local',
        'Online',
        'vs AI'
      ])
    )

    const chaosLevelSubHeader = document.createElement("h2");
    chaosLevelSubHeader.textContent = "Chaos Level Preference";
    container.appendChild(chaosLevelSubHeader);

    container.appendChild(
      this.createRadio(
        'chaos level',
        ['normal chess',
          'one fairy piece',
          'several fairy pieces',
          'full random symetric',
          'full random asymetric']
      )
    )

    const playButton = document.createElement("button");
    playButton.textContent = "Play";
    playButton.classList.add('play-button')
    container.appendChild(playButton);

    playButton.addEventListener("click", () => {
      this.deactivate();
      new ChessScreen().activate(parent);
    });
  }

  createRadio(name: string, options: string[]) {
    const radioGroup = document.createElement("div");
    for (const option of options) {
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = name;
      radio.value = option;
      const label = document.createElement("label");
      label.appendChild(radio);
      label.appendChild(document.createTextNode(option))
      radioGroup.appendChild(label);
    }
    return radioGroup;
  }

  deactivate() {

  }
}
