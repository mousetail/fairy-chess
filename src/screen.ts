export interface Screen {
  activate(parent: HTMLElement): void;
  deactivate(): void;
}
