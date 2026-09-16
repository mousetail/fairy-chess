import ChessScreen, { type ChessScreenOptions } from "./chess-screen/index.ts";
import type { Player } from "./chess-game.ts";
import {
  discoverySummaryText,
  loadDiscoveries,
  summarize,
} from "./discoveries.ts";
import { DiscoveriesScreen } from "./discoveries-screen.ts";
import { MatchmakingScreen } from "./online/matchmaking-screen.ts";
import { chaosLevels } from "./replacement-rules.ts";
import type { Screen } from "./screen.ts";
import pieceTypes from "./pieces/piece_types/index.ts";
import kingPieces from "./pieces/piece_types/kings.ts";
import pawnPieces from "./pieces/piece_types/pawns.ts";

interface RadioGroup {
  element: HTMLDivElement;
  getValue(): string | null;
}

interface SliderGroup {
  element: HTMLLabelElement;
  getValue(): string;
}

/** The selections made on the home screen, used to restore them on a rematch. */
export interface HomeScreenSettings {
  mode: string;
  minTurnTime: string;
  difficulty: string;
  chaosLevel: string;
  /** The name to show an online opponent, or an empty string for none. */
  playerName: string;
}

export class HomeScreen implements Screen {
  private readonly initialSettings?: HomeScreenSettings;

  constructor(initialSettings?: HomeScreenSettings) {
    this.initialSettings = initialSettings;
  }

  activate(parent: HTMLElement) {
    parent.replaceChildren();

    const container = document.createElement("div");
    parent.appendChild(container);

    const header = document.createElement("h1");
    header.textContent = "Fairy Chess";
    container.appendChild(header);

    const description = document.createElement("p");
    description.textContent = `Chess, but pieces are randomized with different variants. Includes ${Object.keys(pieceTypes).length + 6}
      piece types including ${Object.keys(kingPieces).length + 1} king variants and ${Object.keys(pawnPieces).length + 1} pawn variants.`;
    container.appendChild(description);

    const discoverySummary = document.createElement("p");
    discoverySummary.classList.add("discovery-summary");
    discoverySummary.textContent = discoverySummaryText(
      summarize(loadDiscoveries()),
    );
    container.appendChild(discoverySummary);

    const discoveriesButton = document.createElement("button");
    discoveriesButton.classList.add("discoveries-button");
    discoveriesButton.textContent = "Discovered pieces";
    container.appendChild(discoveriesButton);

    const modeSubHeader = document.createElement("h2");
    modeSubHeader.textContent = "Mode Preference";
    container.appendChild(modeSubHeader);

    const modeOptions = ["Local", "Online", "vs AI"];
    const modeRadio = this.createRadio(
      "mode",
      modeOptions,
      this.indexOfOption(modeOptions, this.initialSettings?.mode),
    );
    modeRadio.element.classList.add("button-radio");
    container.appendChild(modeRadio.element);

    const aiOptions = document.createElement("div");
    aiOptions.classList.add("ai-options");
    aiOptions.hidden = true;

    const aiSubHeader = document.createElement("h2");
    aiSubHeader.textContent = "AI Opponent";
    aiOptions.appendChild(aiSubHeader);

    aiOptions.appendChild(
      this.createRadio("ai engine", ["Fairy Stockfish"]).element,
    );

    const minTurnTimeLabel = document.createElement("label");
    minTurnTimeLabel.classList.add("min-turn-time");
    minTurnTimeLabel.appendChild(
      document.createTextNode("Minimum turn time (seconds): "),
    );
    const minTurnTimeInput = document.createElement("input");
    minTurnTimeInput.type = "number";
    minTurnTimeInput.min = "0";
    minTurnTimeInput.step = "0.5";
    minTurnTimeInput.value = this.initialSettings?.minTurnTime ?? "1";
    minTurnTimeLabel.appendChild(minTurnTimeInput);
    aiOptions.appendChild(minTurnTimeLabel);

    const difficultyOptions = ["0", "1", "2", "3", "4", "5"];
    const difficultySlider = this.createSlider(
      "Difficulty",
      difficultyOptions,
      this.sliderIndex(
        this.initialSettings?.difficulty,
        difficultyOptions.length,
        1,
      ),
    );
    difficultySlider.element.classList.add("difficulty");
    aiOptions.appendChild(difficultySlider.element);

    container.appendChild(aiOptions);

    const onlineOptions = document.createElement("div");
    onlineOptions.classList.add("online-options");
    onlineOptions.hidden = true;

    const onlineSubHeader = document.createElement("h2");
    onlineSubHeader.textContent = "Online Opponent";
    onlineOptions.appendChild(onlineSubHeader);

    const nameLabel = document.createElement("label");
    nameLabel.classList.add("player-name-input");
    nameLabel.appendChild(document.createTextNode("Your name: "));
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    // The server caps a name at the same length; this only saves the round trip.
    nameInput.maxLength = 24;
    nameInput.placeholder = "Anonymous";
    nameInput.value = this.initialSettings?.playerName ?? "";
    nameLabel.appendChild(nameInput);
    onlineOptions.appendChild(nameLabel);

    const onlineHint = document.createElement("p");
    onlineHint.classList.add("option-hint");
    onlineHint.textContent =
      "Shown to your opponent. The chaos level below is what you will be " +
      "matched at, give or take one level.";
    onlineOptions.appendChild(onlineHint);

    container.appendChild(onlineOptions);

    const updateAiOptionsVisibility = () => {
      aiOptions.hidden = modeRadio.getValue() !== "vs AI";
      onlineOptions.hidden = modeRadio.getValue() !== "Online";
    };
    updateAiOptionsVisibility();
    modeRadio.element.addEventListener("change", updateAiOptionsVisibility);

    const chaosLevelSubHeader = document.createElement("h2");
    chaosLevelSubHeader.textContent = "Chaos Level Preference";
    container.appendChild(chaosLevelSubHeader);

    const chaosOptions = chaosLevels.map((level) => level.label);
    const chaosLevelSlider = this.createSlider(
      "Chaos Level",
      chaosOptions,
      this.sliderIndex(
        this.initialSettings?.chaosLevel,
        chaosOptions.length,
        2,
      ),
    );
    container.appendChild(chaosLevelSlider.element);

    const playButton = document.createElement("button");
    playButton.textContent = "Play";
    playButton.classList.add("play-button");
    container.appendChild(playButton);

    const currentSettings = (): HomeScreenSettings => ({
      mode: modeRadio.getValue() ?? modeOptions[0],
      minTurnTime: minTurnTimeInput.value,
      difficulty: difficultySlider.getValue(),
      chaosLevel: chaosLevelSlider.getValue(),
      playerName: nameInput.value,
    });

    discoveriesButton.addEventListener("click", () => {
      const settings = currentSettings();
      this.deactivate();
      new DiscoveriesScreen(
        () => new HomeScreen(settings).activate(parent),
      ).activate(parent);
    });

    playButton.addEventListener("click", () => {
      const settings = currentSettings();
      this.deactivate();

      if (settings.mode === "Online") {
        new MatchmakingScreen({
          complexity: this.chaosLevelIndex(settings.chaosLevel),
          name: settings.playerName,
          onLeave: () => new HomeScreen(settings).activate(parent),
        }).activate(parent);
        return;
      }

      const options = this.buildOptions(
        settings.mode,
        minTurnTimeInput,
        difficultySlider.getValue(),
        settings.chaosLevel,
      );
      options.onPlayAgain = () => new HomeScreen(settings).activate(parent);
      new ChessScreen(options).activate(parent);
    });
  }

  /** The chaos level `value` names, clamped to the levels that exist. */
  private chaosLevelIndex(value: string): number {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return 0;
    return Math.min(chaosLevels.length - 1, Math.max(0, parsed));
  }

  /** Returns the index of `value` in `options`, falling back to `fallback`. */
  private indexOfOption(
    options: string[],
    value: string | undefined,
    fallback: number = 0,
  ): number {
    if (value === undefined) return fallback;
    const index = options.indexOf(value);
    return index === -1 ? fallback : index;
  }

  /** Parses a slider index, clamping it to `0..count - 1`. */
  private sliderIndex(
    value: string | undefined,
    count: number,
    fallback: number,
  ): number {
    if (value === undefined) return fallback;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(count - 1, Math.max(0, parsed));
  }

  private buildOptions(
    mode: string | null,
    minTurnTimeInput: HTMLInputElement,
    difficultyValue: string,
    chaosLevelValue: string,
  ): ChessScreenOptions {
    const chaosLevel = this.chaosLevelIndex(chaosLevelValue);

    if (mode !== "vs AI") return { chaosLevel };

    const seconds = Number.parseFloat(minTurnTimeInput.value);
    const minTurnTimeMs =
      Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;

    const parsedDifficulty = Number.parseInt(difficultyValue, 10);
    const difficulty = Number.isFinite(parsedDifficulty)
      ? Math.min(5, Math.max(0, parsedDifficulty))
      : 3;

    const opponent: Player = {
      type: "ai",
      engine: "fairy-stockfish",
      difficulty,
      minTurnTimeMs,
    };
    return { black: opponent, chaosLevel };
  }

  createSlider(
    name: string,
    options: string[],
    defaultIndex: number,
  ): SliderGroup {
    const label = document.createElement("label");
    label.classList.add("slider");
    label.appendChild(document.createTextNode(`${name}: `));

    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = String(options.length - 1);
    input.step = "1";
    input.value = String(defaultIndex);

    const valueDisplay = document.createElement("span");
    valueDisplay.classList.add("slider-value");
    valueDisplay.textContent = options[defaultIndex];
    const maxLabelLength = Math.max(...options.map((option) => option.length));
    valueDisplay.style.minWidth = `${maxLabelLength}ch`;

    input.addEventListener("input", () => {
      valueDisplay.textContent = options[Number(input.value)];
    });

    label.appendChild(input);
    label.appendChild(valueDisplay);

    return {
      element: label,
      getValue: () => input.value,
    };
  }

  createRadio(name: string, options: string[], defaultIndex = 0): RadioGroup {
    const radioGroup = document.createElement("div");
    radioGroup.classList.add("radio-group");
    for (const [index, option] of options.entries()) {
      const id = `${name.replace(/\s+/g, "-")}-${index}`;
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = name;
      radio.value = option;
      radio.id = id;
      radio.checked = index === defaultIndex;
      const label = document.createElement("label");
      label.htmlFor = id;
      label.appendChild(radio);
      label.appendChild(document.createTextNode(option));
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

  deactivate() {}
}
