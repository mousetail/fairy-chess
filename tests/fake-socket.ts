type Listener = (event: { data?: unknown }) => void;

/** A stand-in for `WebSocket`, driven by the test instead of by a server. */
export class FakeSocket {
  readonly sent: string[] = [];
  closed = false;
  private readonly listeners = new Map<string, Listener[]>();

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.emit("close", {});
  }

  /** Fires everything registered for `type`, as the browser would. */
  emit(type: string, event: { data?: unknown }): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event);
    }
  }

  /** Connects the socket, as the browser does once it is up. */
  open(): void {
    this.emit("open", {});
  }

  /** Delivers a message from the server. */
  receive(message: unknown): void {
    this.emit("message", {
      data: typeof message === "string" ? message : JSON.stringify(message),
    });
  }
}