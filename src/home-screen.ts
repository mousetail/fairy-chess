import type { ChessScreenOptions } from "./chess-screen/index.ts";
import type { Player } from "./chess-game.ts";
import {
  discoverySummaryText,
  loadDiscoveries,
  summarize,
} from "./discoveries.ts";
import { HomeScreenPieces } from "./home-screen-pieces.ts";
import { ReplacementOverrideMenu } from "./replacement-override-menu.ts";
import {
  type MatchmakingSession,
  type MatchmakingStatus,
} from "./online/session.ts";
import {
  clampTimeControl,
  timeControlLabel,
  timeControls,
} from "./online/time-controls.ts";
import { chaosLevels } from "./replacement-rules.ts";
import type { Screen } from "./screen.ts";
import type { HomeScreenSettings } from "./settings.ts";
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

/** What the home screen needs from the app that shows it. */
export interface HomeScreenOptions {
  /** The selections to show, which the app keeps so a visit away loses none. */
  settings: HomeScreenSettings;
  /** Reports the selections whenever they change, to be kept and stored. */
  onSettingsChange(settings: HomeScreenSettings): void;
  /** Shows the discoveries screen, whose Back leads here again. */
  onDiscoveries(): void;
  /** Shows the game history screen, whose Back leads here again. */
  onHistory(): void;
  /** Starts a game played on this machine, from the selections made. */
  onLocalGame(options: ChessScreenOptions): void;
}

async function getRandomName() {
  const professions = (
    await import("./data/professions.txt?raw")
  ).default.split("\n");
  const adjectives = (await import("./data/adjectives.txt?raw")).default.split(
    "\n",
  );
  const profession =
    professions[
      Math.floor(Math.random() * professions.length)
    ].toLocaleLowerCase();
  if (profession.length < 24) {
    const adjective =
      adjectives[
        Math.floor(Math.random() * adjectives.length)
      ].toLocaleLowerCase();
    if (!profession.startsWith(adjective)) {
      return `${adjective} ${profession}`;
    } else {
      return profession;
    }
  } else {
    return profession;
  }
}

export class HomeScreen implements Screen {
  private readonly matchmaking: MatchmakingSession;
  private readonly options: HomeScreenOptions;
  /** Stops following the search, once the screen is showing. */
  private unwatch: (() => void) | null = null;
  /** The timer that counts the wait up on the Play button, while one runs. */
  private queueTimer: number | null = null;
  /** The scrolling piece columns beside the menu, while the screen is showing. */
  private pieces: HomeScreenPieces | null = null;
  /** The replacement rule to try first, by name, or an empty string for none. */
  private replacementOverride = "";
  /** The secret menu that picks the replacement override, while the screen shows. */
  private overrideMenu: ReplacementOverrideMenu | null = null;

  constructor(matchmaking: MatchmakingSession, options: HomeScreenOptions) {
    this.matchmaking = matchmaking;
    this.options = options;
  }

  activate(parent: HTMLElement) {
    parent.replaceChildren();

    const container = document.createElement("div");
    container.classList.add('home-screen-container')
    parent.appendChild(container);

    // The columns sit in the blank space either side of the menu, so they are
    // added to the screen's parent rather than to the menu itself. Three quick
    // clicks on one open the secret replacement-rule menu.
    this.replacementOverride = this.options.settings.replacementOverride ?? "";
    this.pieces = new HomeScreenPieces({
      onSecretGesture: (anchor) => this.openOverrideMenu(anchor),
    });
    this.pieces.mount(parent);

    const headerDiv = document.createElement('div');

    const header = document.createElement("h1");
    header.textContent = "Fairy Chess";
    headerDiv.appendChild(header);
    container.appendChild(headerDiv);

    const bodyDiv = document.createElement('div');
    bodyDiv.classList.add('home-screen-body')
    container.appendChild(bodyDiv);
    const description = document.createElement("p");
    description.classList.add("text-max-width");
    description.textContent = `Chess, but pieces are randomized with different variants. Includes ${Object.keys(pieceTypes).length + 6}
      piece types including ${Object.keys(kingPieces).length + 1} king variants and ${Object.keys(pawnPieces).length + 1} pawn variants.`;
    headerDiv.appendChild(description);

    const modeSubHeader = document.createElement("h2");
    modeSubHeader.textContent = "Mode Preference";
    bodyDiv.appendChild(modeSubHeader);

    const modeOptions = ["Local", "Online", "vs AI"];
    const modeRadio = this.createRadio(
      "mode",
      modeOptions,
      this.indexOfOption(modeOptions, this.options.settings.mode),
    );
    modeRadio.element.classList.add("button-radio");
    bodyDiv.appendChild(modeRadio.element);

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
    minTurnTimeInput.value = this.options.settings.minTurnTime;
    minTurnTimeLabel.appendChild(minTurnTimeInput);
    aiOptions.appendChild(minTurnTimeLabel);

    const difficultyOptions = ["0", "1", "2", "3", "4", "5"];
    const difficultySlider = this.createSlider(
      "Difficulty",
      difficultyOptions,
      this.sliderIndex(
        this.options.settings.difficulty,
        difficultyOptions.length,
        1,
      ),
    );
    difficultySlider.element.classList.add("difficulty");
    aiOptions.appendChild(difficultySlider.element);

    bodyDiv.appendChild(aiOptions);

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
    getRandomName().then((name) => {
      if (nameInput.value === "") {
        nameInput.value = name;
      }
    });
    nameInput.type = "text";
    // The server caps a name at the same length; this only saves the round trip.
    nameInput.maxLength = 36;
    nameInput.value = this.options.settings.playerName;
    nameLabel.appendChild(nameInput);
    onlineOptions.appendChild(nameLabel);

    const timeControlOptions = timeControls.map(timeControlLabel);
    const timeControlSlider = this.createSlider(
      "Time control",
      timeControlOptions,
      this.sliderIndex(
        this.options.settings.timeControl,
        timeControlOptions.length,
        1,
      ),
    );
    timeControlSlider.element.classList.add("time-control");
    onlineOptions.appendChild(timeControlSlider.element);

    bodyDiv.appendChild(onlineOptions);

    const updateOptionVisibility = () => {
      const mode = modeRadio.getValue();
      aiOptions.hidden = mode !== "vs AI";
      onlineOptions.hidden = mode !== "Online";
      // Leaving the online mode gives up a search that is still running, so the
      // Play button is free for a game played here.
      if (mode !== "Online") this.matchmaking.cancel();
    };
    updateOptionVisibility();
    modeRadio.element.addEventListener("change", updateOptionVisibility);

    const chaosLevelSubHeader = document.createElement("h2");
    chaosLevelSubHeader.textContent = "Chaos Level Preference";
    bodyDiv.appendChild(chaosLevelSubHeader);

    const chaosOptions = chaosLevels.map((level) => level.label);
    const chaosLevelSlider = this.createSlider(
      "Chaos Level",
      chaosOptions,
      this.sliderIndex(
        this.options.settings.chaosLevel,
        chaosOptions.length,
        2,
      ),
    );
    bodyDiv.appendChild(chaosLevelSlider.element);

    const playButton = document.createElement("button");
    playButton.textContent = "Play";
    playButton.classList.add("button", "play-button");
    bodyDiv.appendChild(playButton);

    const statusText = document.createElement("p");
    statusText.classList.add("online-status-text");
    statusText.hidden = true;
    container.appendChild(statusText);

    const discoverySummary = document.createElement("p");
    discoverySummary.classList.add("text-max-width");
    discoverySummary.textContent = discoverySummaryText(
      summarize(loadDiscoveries()),
    );
    bodyDiv.appendChild(discoverySummary);

    const actions = document.createElement("div");
    actions.classList.add("actions");
    bodyDiv.appendChild(actions);

    const discoveriesButton = document.createElement("button");
    discoveriesButton.classList.add("button", "discoveries-button");
    discoveriesButton.textContent = "Discovered pieces";
    actions.appendChild(discoveriesButton);

    const historyButton = document.createElement("button");
    historyButton.classList.add("button", "history-button");
    historyButton.textContent = "Game history";
    actions.appendChild(historyButton);

    const currentSettings = (): HomeScreenSettings => {
      const settings: HomeScreenSettings = {
        mode: modeRadio.getValue() ?? modeOptions[0],
        minTurnTime: minTurnTimeInput.value,
        difficulty: difficultySlider.getValue(),
        chaosLevel: chaosLevelSlider.getValue(),
        timeControl: timeControlSlider.getValue(),
        playerName: nameInput.value,
      };
      if (this.replacementOverride !== "") {
        settings.replacementOverride = this.replacementOverride;
      }
      return settings;
    };
    const report = () => this.options.onSettingsChange(currentSettings());
    container.addEventListener("change", report);

    // The secret menu is kept off screen until a column is clicked three times.
    this.overrideMenu = new ReplacementOverrideMenu((value) => {
      this.replacementOverride = value;
      report();
    });
    this.overrideMenu.setValue(this.replacementOverride);
    this.overrideMenu.mount();

    const showQueueTime = () => {
      const began = this.matchmaking.searchStartedAt;
      if (began === null) return;
      playButton.textContent = `In Queue (${elapsedTime(Date.now() - began)})`;
    };

    this.unwatch = this.matchmaking.watch((status) => {
      if (isSearching(status)) {
        // The wait is counted from when the search began rather than from when
        // this screen went up, so a visit to the discoveries screen and back
        // shows all of it. The timer keeps the count moving in between words
        // from the server.
        if (this.queueTimer === null) {
          this.queueTimer = window.setInterval(showQueueTime, 1000);
        }
        showQueueTime();
      } else {
        this.stopQueueTimer();
        playButton.textContent = "Play";
      }

      statusText.hidden = status.state !== "error";
      statusText.textContent = status.state === "error" ? status.message : "";
    });

    discoveriesButton.addEventListener("click", () => {
      report();
      this.options.onDiscoveries();
    });

    historyButton.addEventListener("click", () => {
      report();
      this.options.onHistory();
    });

    playButton.addEventListener("click", () => {
      const settings = currentSettings();
      report();

      if (settings.mode === "Online") {
        // The search runs alongside this screen, so the button toggles it: the
        // first press starts the wait and a later one gives it up.
        if (isSearching(this.matchmaking.status)) {
          this.matchmaking.cancel();
          return;
        }

        this.matchmaking.queue(
          this.chaosLevelIndex(settings.chaosLevel),
          clampTimeControl(Number.parseInt(settings.timeControl, 10)),
          settings.playerName,
          settings.replacementOverride,
        );
        return;
      }

      this.options.onLocalGame(
        this.buildOptions(
          settings.mode,
          minTurnTimeInput,
          difficultySlider.getValue(),
          settings.chaosLevel,
        ),
      );
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
    const replacementOverride = this.replacementOverride === ""
      ? undefined
      : this.replacementOverride;

    if (mode !== "vs AI") return { chaosLevel, replacementOverride };

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
    return { black: opponent, chaosLevel, replacementOverride };
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

  /** Stops the count of the wait shown on the Play button, if it is running. */
  private stopQueueTimer(): void {
    if (this.queueTimer === null) return;
    window.clearInterval(this.queueTimer);
    this.queueTimer = null;
  }

  /** Opens the secret menu that picks the replacement rule to try first. */
  private openOverrideMenu(anchor: HTMLElement): void {
    this.overrideMenu?.setValue(this.replacementOverride);
    this.overrideMenu?.open(anchor);
  }

  deactivate() {
    this.stopQueueTimer();
    this.unwatch?.();
    this.unwatch = null;
    this.pieces?.destroy();
    this.pieces = null;
    this.overrideMenu?.destroy();
    this.overrideMenu = null;
  }
}

/** Whether `status` is a search for an opponent that is still going on. */
function isSearching(status: MatchmakingStatus): boolean {
  return status.state === "connecting" || status.state === "queued";
}

/** How long a wait has gone on for, as minutes and seconds: `4:31`. */
function elapsedTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
