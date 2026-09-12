import type { PieceImage } from "../images/images";
import type { LazyImage } from "../pieces/utils";

/** Creates an <img> for a (possibly still loading) piece image. */
export function getImageFromPromise(
  v: LazyImage,
  color: "black" | "white",
): HTMLImageElement {
  if (v.state === "pending") {
    const img = document.createElement("img");
    v.promise().then((image: PieceImage) => {
      img.src = image[color];

      Object.assign(v, { state: "resolved" }, image);
    });

    return img;
  }
  const img = document.createElement("img");
  img.src = v[color];
  return img;
}