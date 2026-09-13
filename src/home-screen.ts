import ChessScreen, { type ChessScreenOptions } from "./chess-screen/index";
import type { Player } from "./chess-game";
import type { Screen } from "./screen";

interface RadioGroup {
  element: HTMLDivElement;
  getValue(): string | null;
}

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

    const modeRadio = this.createRadio('mode', [
      'Local',
      'Online',
      'vs AI'
    ]);
    container.appendChild(modeRadio.element);

    const aiOptions = document.createElement("div");
    aiOptions.classList.add("ai-options");
    aiOptions.hidden = true;

    const aiSubHeader = document.createElement("h2");
    aiSubHeader.textContent = "AI Opponent";
    aiOptions.appendChild(aiSubHeader);

    aiOptions.appendChild(
      this.createRadio('ai engine', ['Fairy Stockfish']).element
    );

    const minTurnTimeLabel = document.createElement("label");
    minTurnTimeLabel.classList.add("min-turn-time");
    minTurnTimeLabel.appendChild(
      document.createTextNode("Minimum turn time (seconds): ")
    );
    const minTurnTimeInput = document.createElement("input");
    minTurnTimeInput.type = "number";
    minTurnTimeInput.min = "0";
    minTurnTimeInput.step = "0.5";
    minTurnTimeInput.value = "1";
    minTurnTimeLabel.appendChild(minTurnTimeInput);
    aiOptions.appendChild(minTurnTimeLabel);

    const difficultyLabel = document.createElement("label");
    difficultyLabel.classList.add("difficulty");
    difficultyLabel.appendChild(document.createTextNode("Difficulty (0-5): "));
    const difficultySelect = document.createElement("select");
    for (let level = 0; level <= 5; level++) {
      const option = document.createElement("option");
      option.value = String(level);
      option.textContent = String(level);
      difficultySelect.appendChild(option);
    }
    difficultySelect.value = "5";
    difficultyLabel.appendChild(difficultySelect);
    aiOptions.appendChild(difficultyLabel);

    container.appendChild(aiOptions);

    modeRadio.element.addEventListener("change", () => {
      aiOptions.hidden = modeRadio.getValue() !== 'vs AI';
    });

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
      ).element
    )

    const playButton = document.createElement("button");
    playButton.textContent = "Play";
    playButton.classList.add('play-button')
    container.appendChild(playButton);

    playButton.addEventListener("click", () => {
      const options = this.buildOptions(
        modeRadio.getValue(),
        minTurnTimeInput,
        difficultySelect,
      );
      this.deactivate();
      new ChessScreen(options).activate(parent);
    });
  }

  private buildOptions(
    mode: string | null,
    minTurnTimeInput: HTMLInputElement,
    difficultySelect: HTMLSelectElement,
  ): ChessScreenOptions {
    if (mode !== 'vs AI') return {};

    const seconds = Number.parseFloat(minTurnTimeInput.value);
    const minTurnTimeMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;

    const parsedDifficulty = Number.parseInt(difficultySelect.value, 10);
    const difficulty = Number.isFinite(parsedDifficulty)
      ? Math.min(5, Math.max(0, parsedDifficulty))
      : 5;

    const opponent: Player = {
      type: "ai",
      engine: "fairy-stockfish",
      difficulty,
      minTurnTimeMs,
    };
    return { black: opponent };
  }

  createRadio(name: string, options: string[]): RadioGroup {
    const radioGroup = document.createElement("div");
    radioGroup.classList.add("radio-group");
    for (const [index, option] of options.entries()) {
      const id = `${name.replace(/\s+/g, '-')}-${index}`;
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = name;
      radio.value = option;
      radio.id = id;
      radio.checked = index === 0;
      const label = document.createElement("label");
      label.htmlFor = id;
      label.appendChild(radio);
      label.appendChild(document.createTextNode(option))
      radioGroup.appendChild(label);
    }

    return {
      element: radioGroup,
      getValue: () => {
        const checked = radioGroup.querySelector<HTMLInputElement>(
          'input[type="radio"]:checked',
        );
        return checked ? checked.value : null;
      },
    };
  }

  deactivate() {

  }
}
