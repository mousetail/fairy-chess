import images from "../images/images.ts";

async function getPieceImageAsyncInner<T extends keyof typeof images>(
  category: T,
  value: keyof Awaited<(typeof images)[T]>,
): Promise<{ black: string; white: string }> {
  const image = await images[category];
  const { black, white } = image[value] as { black: string; white: string };
  return { black, white };
}

export type LazyImage =
  | {
      state: "pending";
      promise: () => Promise<{ black: string; white: string }>;
    }
  | {
      state: "resolved";
      black: string;
      white: string;
    };

export function getPieceImageAsync<T extends keyof typeof images>(
  category: T,
  value: keyof Awaited<(typeof images)[T]>,
): LazyImage {
  return {
    state: "pending",
    promise: () => getPieceImageAsyncInner(category, value),
  };
}
