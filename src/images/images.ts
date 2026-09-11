export type PieceImage = { black: string; white: string };

export default {
  get berserker() {
    return import("./berserker").then((i) => i.default);
  },
  get calendar() {
    return import("./calendar").then((i) => i.default);
  },
  get celtic() {
    return import("./celtic").then((i) => i.default);
  },
  get centaur() {
    return import("./centour").then((i) => i.default);
  },
  get classic() {
    return import("./classic").then((i) => i.default);
  },
  get classic2() {
    return import("./classic2").then((i) => i.default);
  },
  get courier() {
    return import("./courier").then((i) => i.default);
  },
  get fantasy() {
    return import("./fantasy").then((i) => i.default);
  },
  get geometry() {
    return import("./geometry").then((i) => i.default);
  },
  get helios() {
    return import("./helios").then((i) => i.default);
  },
  get medieval() {
    return import("./medieval").then((i) => i.default);
  },
  get nature() {
    return import("./nature").then((i) => i.default);
  },
  get restrictors() {
    return import("./restrictors").then((i) => i.default);
  },
  get woodland() {
    return import("./woodland").then((i) => i.default);
  },
  get zora() {
    return import("./zora").then((i) => i.default);
  },
} satisfies Record<string, Promise<Record<string, PieceImage>>>;
