import { replacementRules } from "./replacement-rules.ts";

/** The gap kept between the menu and the window edge, in pixels. */
const margin = 8;

/** The gap between the menu and the column it was opened from, in pixels. */
const gap = 8;

/**
 * The secret menu that picks a replacement rule to try first, for testing.
 *
 * It is opened by clicking a piece in one of the home screen's columns three
 * times. Choosing a rule stores it as a preference; a game still skips it when
 * it does not fit, so this only nudges the random setup towards one rule.
 */
export class ReplacementOverrideMenu {
  private readonly element: HTMLDivElement;
  private readonly select: HTMLSelectElement;
  private readonly onChange: (value: string) => void;

  constructor(onChange: (value: string) => void) {
    this.onChange = onChange;

    this.element = document.createElement("div");
    this.element.classList.add("replacement-override-menu");
    this.element.hidden = true;

    const heading = document.createElement("div");
    heading.classList.add("replacement-override-heading");
    heading.textContent = "Replacement rule override";
    this.element.appendChild(heading);

    this.select = document.createElement("select");
    this.select.classList.add("replacement-override-select");
    this.select.appendChild(this.createOption("", "None (random)"));
    for (const rule of replacementRules) {
      this.select.appendChild(this.createOption(rule.name, rule.name));
    }
    this.select.addEventListener("change", () => this.onChange(this.select.value));
    this.element.appendChild(this.select);

    const hint = document.createElement("div");
    hint.classList.add("replacement-override-hint");
    hint.textContent =
      "Tried first when a game is laid out. Skipped when it does not fit the level.";
    this.element.appendChild(hint);
  }

  /** Puts the menu on the page, hidden until it is opened. */
  mount(): void {
    document.body.appendChild(this.element);
  }

  /** Takes the menu off the page. */
  destroy(): void {
    this.close();
    this.element.remove();
  }

  /** Shows the rule currently chosen, without reporting it as a change. */
  setValue(value: string): void {
    this.select.value = value;
  }

  /** Opens the menu beside `anchor`, the column it was opened from. */
  open(anchor: HTMLElement): void {
    this.element.hidden = false;
    const rect = anchor.getBoundingClientRect();
    const width = this.element.offsetWidth;
    const height = this.element.offsetHeight;
    // The menu opens towards the middle of the screen, away from the column.
    const onLeft = anchor.classList.contains("piece-marquee-left");
    const left = clamp(
      onLeft ? rect.right + gap : rect.left - width - gap,
      margin,
      window.innerWidth - width - margin,
    );
    const top = clamp(
      rect.top + rect.height / 2 - height / 2,
      margin,
      window.innerHeight - height - margin,
    );
    this.element.style.left = `${left}px`;
    this.element.style.top = `${top}px`;

    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("pointerdown", this.onPointerDown);
    this.select.focus();
  }

  /** Hides the menu, if it is showing. */
  close(): void {
    if (this.element.hidden) return;
    this.element.hidden = true;
    document.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("pointerdown", this.onPointerDown);
  }

  private createOption(value: string, label: string): HTMLOptionElement {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") this.close();
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    const target = event.target;
    if (target instanceof Node && this.element.contains(target)) return;
    this.close();
  };
}

/** Keeps `value` between `min` and `max`. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
