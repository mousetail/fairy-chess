import pieceTypes from "./pieces/piece_types/index.ts";
import type { PieceType } from "./pieces/piece_types/index.ts";
import { getImageFromPromise } from "./chess-screen/piece-images.ts";
import { PieceInfoBar } from "./piece-info-bar.ts";
import "./home-screen-pieces.css";

/** How many different pieces each column shows before the pattern repeats. */
const piecesPerColumn = 10;

/** How fast the columns scroll, in pixels per second. */
const scrollSpeed = 30;

/** The gap between the pointer and the move set panel, in pixels. */
const tooltipGap = 16;

/** The smallest gap kept between the move set panel and the window edge. */
const tooltipMargin = 8;

/** How many quick clicks on a column open the secret replacement menu. */
const secretClickCount = 3;

/** How long a click counts towards the secret gesture, in milliseconds. */
const secretClickWindowMs = 600;

/** What the marquee needs from the screen that shows it. */
export interface HomeScreenPiecesOptions {
  /**
   * Called when a column is clicked three times in quick succession, with the
   * column as the anchor. This is the secret way into the testing menu.
   */
  onSecretGesture?(anchor: HTMLElement): void;
}

/** One piece of a column, with the colour it is drawn in. */
interface MarqueePiece {
  piece: PieceType;
  color: "white" | "black";
}

/** One of the two scrolling columns. */
interface MarqueeColumn {
  element: HTMLDivElement;
  track: HTMLDivElement;
  /**
   * One copy of the column, in order. Every copy the track holds is built from
   * this, so the copies are identical and the loop has no visible seam.
   */
  copy: MarqueePiece[];
  /** How many copies of {@link copy} the track currently holds. */
  copies: number;
  /** Whether the column is paused, which a click or tap toggles. */
  paused: boolean;
}

/**
 * The columns of pieces that scroll down the left and up the right of the home
 * screen, on a screen wide enough to leave room for them beside the menu.
 *
 * Each column loops seamlessly: the track holds its pieces several times over
 * and the animation moves it by exactly one copy, so the tile that leaves one
 * end is the one that comes back at the other. Hovering a piece shows how it
 * moves, and a click or tap pauses that column so the move set can be read.
 */
export class HomeScreenPieces {
  private readonly options: HomeScreenPiecesOptions;
  private readonly tooltip: HTMLDivElement;
  private readonly info: PieceInfoBar;
  private readonly columns: MarqueeColumn[] = [];
  /** The piece each tile shows, so a hovered tile can be named. */
  private readonly pieceOfTile = new WeakMap<HTMLElement, PieceType>();
  /** The piece the move set panel is showing, to avoid redrawing it each frame. */
  private shownPiece: PieceType | null = null;
  /** The measured size of the move set panel, which does not change with its piece. */
  private tooltipSize: { width: number; height: number } | null = null;
  private pointerX = 0;
  private pointerY = 0;
  /** The column the pointer is over, or `null` when it is over neither. */
  private hovered: MarqueeColumn | null = null;
  /** The frame that keeps the move set in step with the pieces under the pointer. */
  private frame: number | null = null;

  constructor(options: HomeScreenPiecesOptions = {}) {
    this.options = options;
    this.info = new PieceInfoBar();
    this.tooltip = document.createElement("div");
    this.tooltip.classList.add("piece-marquee-tooltip");
    this.tooltip.hidden = true;
    this.tooltip.appendChild(this.info.element);
  }

  /** Adds the two columns to `parent`, the element the home screen fills. */
  mount(parent: HTMLElement): void {
    const left = this.createColumn("left");
    const right = this.createColumn("right");
    this.columns.push(left, right);
    parent.append(left.element, right.element);
    document.body.appendChild(this.tooltip);

    window.addEventListener("resize", this.onResize);
    document.addEventListener("pointerdown", this.onDocumentPointerDown);

    // The pieces are laid out by now, so each track can be measured and given
    // as many copies as it needs to cover the column at any point of its loop.
    requestAnimationFrame(() => {
      for (const column of this.columns) this.layoutColumn(column);
    });
  }

  /** Takes the columns and the move set panel off screen. */
  destroy(): void {
    this.stopTracking();
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("pointerdown", this.onDocumentPointerDown);
    for (const column of this.columns) column.element.remove();
    this.columns.length = 0;
    this.tooltip.remove();
  }

  private createColumn(side: "left" | "right"): MarqueeColumn {
    const element = document.createElement("div");
    element.classList.add("piece-marquee", `piece-marquee-${side}`);

    const track = document.createElement("div");
    track.classList.add("piece-marquee-track");
    element.appendChild(track);

    const copy = this.pickPieces(piecesPerColumn).map(
      (piece): MarqueePiece => ({
        piece,
        color: Math.random() < 0.5 ? "white" : "black",
      }),
    );
    for (const entry of copy) track.appendChild(this.createTile(entry));

    const column: MarqueeColumn = { element, track, copy, copies: 1, paused: false };

    element.addEventListener("pointerenter", (event) => {
      this.pointerX = event.clientX;
      this.pointerY = event.clientY;
      this.startTracking(column);
    });
    element.addEventListener("pointermove", (event) => {
      this.pointerX = event.clientX;
      this.pointerY = event.clientY;
    });
    element.addEventListener("pointerleave", () => this.stopTracking());
    let clicks = 0;
    let clickTimer: number | null = null;
    element.addEventListener("click", () => {
      column.paused = !column.paused;
      element.classList.toggle("paused", column.paused);
      if (column.paused) {
        // A tap has no hover to hold the move set up, so show the piece that was
        // tapped and leave it there for as long as the column stays paused.
        this.hovered = column;
        this.updateHover();
      } else if (this.hovered !== column) {
        this.hideTooltip();
      }

      // Three quick clicks open the secret menu that picks a replacement rule to
      // try first. The count starts again when the clicks are too far apart.
      clicks++;
      if (clickTimer !== null) window.clearTimeout(clickTimer);
      if (clicks >= secretClickCount) {
        clicks = 0;
        this.options.onSecretGesture?.(element);
        return;
      }
      clickTimer = window.setTimeout(() => {
        clicks = 0;
        clickTimer = null;
      }, secretClickWindowMs);
    });

    return column;
  }

  private createTile(entry: MarqueePiece): HTMLDivElement {
    const tile = document.createElement("div");
    tile.classList.add("piece-marquee-tile");
    tile.appendChild(getImageFromPromise(entry.piece.image, entry.color));
    this.pieceOfTile.set(tile, entry.piece);
    return tile;
  }

  /** Picks `count` different pieces at random. */
  private pickPieces(count: number): PieceType[] {
    const all = Object.values(pieceTypes);
    const chosen: PieceType[] = [];
    const used = new Set<PieceType>();
    while (chosen.length < count && used.size < all.length) {
      const piece = all[Math.floor(Math.random() * all.length)];
      if (used.has(piece)) continue;
      used.add(piece);
      chosen.push(piece);
    }
    return chosen;
  }

  /**
   * Gives the column's track enough copies of its pieces to cover the column
   * throughout the loop, then times the animation so one copy passes at
   * {@link scrollSpeed}.
   */
  private layoutColumn(column: MarqueeColumn): void {
    // One copy is the track divided by the copies it holds; every copy is the
    // same height, so this holds however many have been added.
    const copyHeight = column.track.offsetHeight / column.copies;
    if (copyHeight <= 0) return;

    // While the track slides by one copy, its far end must still reach the
    // bottom of the column, so one copy has to be at least as tall as it is.
    const needed = Math.max(2, Math.ceil(column.element.clientHeight / copyHeight) + 1);
    while (column.copies < needed) {
      // A fresh tile rather than a clone, so a still-loading image is wired up
      // for this copy too; the piece and its colour are the ones the first copy
      // chose, which is what keeps the loop seamless.
      for (const entry of column.copy) {
        column.track.appendChild(this.createTile(entry));
      }
      column.copies++;
    }

    column.track.style.setProperty("--marquee-shift", `${-copyHeight}px`);
    column.track.style.animationDuration = `${copyHeight / scrollSpeed}s`;
  }

  private startTracking(column: MarqueeColumn): void {
    this.hovered = column;
    if (this.frame !== null) return;
    const tick = () => {
      this.frame = requestAnimationFrame(tick);
      this.updateHover();
    };
    this.frame = requestAnimationFrame(tick);
  }

  private stopTracking(): void {
    const column = this.hovered;
    this.hovered = null;
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    // A paused column keeps its move set up, so it can be read after the pointer
    // has moved away; a running one drops it as soon as the pointer leaves.
    if (!column?.paused) this.hideTooltip();
  }

  /**
   * Shows the move set of the piece under the pointer. This runs every frame
   * while the pointer is over a column, because the pieces move under a still
   * pointer as much as the pointer moves over them.
   */
  private updateHover(): void {
    const column = this.hovered;
    if (!column) return;
    const under = document.elementFromPoint(this.pointerX, this.pointerY);
    const tile = under?.closest<HTMLElement>(".piece-marquee-tile") ?? null;
    const piece =
      tile && column.element.contains(tile)
        ? this.pieceOfTile.get(tile)
        : undefined;
    if (!piece) {
      this.hideTooltip();
      return;
    }
    this.showTooltip(piece, column);
  }

  private showTooltip(piece: PieceType, column: MarqueeColumn): void {
    if (this.shownPiece !== piece) {
      this.shownPiece = piece;
      this.info.show(piece);
    }
    this.tooltip.hidden = false;

    if (this.tooltipSize === null) {
      this.tooltipSize = {
        width: this.tooltip.offsetWidth,
        height: this.tooltip.offsetHeight,
      };
    }
    const { width, height } = this.tooltipSize;

    // The panel opens towards the middle of the screen, away from the column.
    const onLeft = column.element.classList.contains("piece-marquee-left");
    const preferredLeft = onLeft
      ? this.pointerX + tooltipGap
      : this.pointerX - width - tooltipGap;
    const left = clamp(
      preferredLeft,
      tooltipMargin,
      window.innerWidth - width - tooltipMargin,
    );
    const top = clamp(
      this.pointerY - height / 2,
      tooltipMargin,
      window.innerHeight - height - tooltipMargin,
    );
    this.tooltip.style.left = `${left}px`;
    this.tooltip.style.top = `${top}px`;
  }

  private hideTooltip(): void {
    if (this.tooltip.hidden) return;
    this.tooltip.hidden = true;
    this.shownPiece = null;
  }

  private readonly onResize = (): void => {
    // The panel is sized in rem, so a change of font size changes it too.
    this.tooltipSize = null;
    for (const column of this.columns) this.layoutColumn(column);
  };

  /** A press anywhere but the columns takes the move set away and lets them run on. */
  private readonly onDocumentPointerDown = (event: PointerEvent): void => {
    const target = event.target;
    if (target instanceof Element && target.closest(".piece-marquee")) return;
    for (const column of this.columns) {
      column.paused = false;
      column.element.classList.remove("paused");
    }
    this.hideTooltip();
  };
}

/** Keeps `value` between `min` and `max`. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
