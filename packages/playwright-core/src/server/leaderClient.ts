import type * as channels from "@protocol/channels";
import { ActionInContext } from "./recorder/codeGenerator";
import WebSocket from "ws";

class SignalingServerDisconnectedError extends Error {
  constructor() {
    super("Signaling server disconnected");
  }
}

export class LeaderClient {
  private _channel?: WebSocket;
  private _waitingForServerConnection = true;

  /**
   * Delay for sending navigation signal after a fill signal
   * This is to ensure that any fill actions are completed before the navigation signal is sent
   */
  readonly SIGNAL_NAVIGATION_DELAY = 500;

  /**
   * Maximum time to wait for the signaling server connection
   */
  readonly MAX_WAIT_FOR_SERVER_CONNECTION = 30000;

  constructor(params: channels.BrowserContextRecorderSupplementEnableParams) {
    if (params.leaderWSEndpoint) {
      this._channel = new WebSocket(params.leaderWSEndpoint);
    }

    this._register();
  }

  _register() {
    if (!this._channel) return;

    const _channel = this._channel;

    // Register as a leader
    _channel.on("open", () => {
      _channel.send(
        JSON.stringify({
          type: "register",
          data: {
            type: "leader",
          },
        })
      );

      _channel.on("close", () => {
        this.processServerClose();
      });

      _channel.on("message", (message) => {
        this.processServerMessages(message.toString());
      });
    });
  }

  /**
   * Wait for the signaling server to connect
   * If the server does not connect within the MAX_WAIT_FOR_SERVER_CONNECTION time, throw an error
   * @throws {SignalingServerDisconnectedError}
   * @returns {Promise<void>}
   */
  waitForServerConnection() {
    if (!this._channel) {
      this._waitingForServerConnection = false;
      return;
    }

    console.log("Waiting for signaling server connection");

    const t = Date.now();

    const pause = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));

    const wait = async () => {
      while (this._waitingForServerConnection) {
        await pause(100);

        if (Date.now() - t > this.MAX_WAIT_FOR_SERVER_CONNECTION) {
          throw new SignalingServerDisconnectedError();
        }
      }
      console.log("Signaling server connected");
    };

    return wait();
  }

  processServerMessages(message: string) {
    const data: { type: string; data: any } = JSON.parse(message);

    switch (data.type) {
      case "management":
        this.processServerManagementMessages(data.data);
        break;
      case "error":
        this.processServerError(data.data);
        break;
    }
  }

  processServerManagementMessages(data: { code: string; payload?: any }) {
    switch (data.code) {
      case "CONNECTION_SUCCESS":
        this._waitingForServerConnection = false;
        break;
      case "PARTIES_CHANGED":
        // throw new SignalingServerDisconnectedError();
        break;
    }
  }

  processServerError(data: { code: string; payload?: any }) {
    // TODO: non-developed. still playground
    throw new SignalingServerDisconnectedError();
  }

  processServerClose() {
    throw new SignalingServerDisconnectedError();
  }

  private _sentUncommittedChange = false;
  private _lastChangeSent: ActionInContext | null = null;

  /**
   * Send a change to the signaling server
   * @param {ActionInContext} change The change to send
   * @returns {void}
   */
  sendChange(change: ActionInContext | null) {
    if (!this._channel) return;
    if (!change) return;

    // First, send the included navigation signal if any
    this.sendIncludedNavigation(change);

    // Check if this change has already been sent but new versions with signals are sent
    let _shouldSend = true;

    if (this._sameChange(change) && this._sentUncommittedChange) {
      _shouldSend = false;
    }

    if (change.committed) {
      this._sentUncommittedChange = false;
    }

    if (!_shouldSend) return;

    this._channel.send(
      JSON.stringify({
        type: "change",
        data: change,
      })
    );

    // Store the last change sent
    this._lastChangeSent = change;
    this._sentUncommittedChange = !change.committed;
  }

  _sameChange(change: ActionInContext) {
    if (!this._lastChangeSent) return false;

    if (change.action.name !== this._lastChangeSent?.action.name) return false;

    if (
      change.action.name === "fill" &&
      this._lastChangeSent.action.name === "fill"
    ) {
      return (
        change.action.selector === this._lastChangeSent.action.selector &&
        change.action.text === this._lastChangeSent.action.text
      );
    }

    if (
      change.action.name === "click" &&
      this._lastChangeSent.action.name === "click"
    ) {
      return change.action.selector === this._lastChangeSent.action.selector;
    }

    if (
      change.action.name === "navigate" &&
      this._lastChangeSent.action.name === "navigate"
    ) {
      return change.action.url === this._lastChangeSent.action.url;
    }
  }

  sendCommitment(action: ActionInContext) {
    this._sentUncommittedChange = false;
  }

  sendIncludedNavigation(action: ActionInContext) {
    // if a navigate signal is appended to the fill signal, we should send one

    if (!this._lastChangeSent) return;

    if (action.action.name !== "fill") return;

    let signals = action.action.signals;

    if (signals.length === 0) return;

    let url = signals.find((signal) => signal.name === "navigation")?.url;
    if (url) {
      setTimeout(
        () =>
          this.sendChange({
            frame: action.frame,
            action: {
              name: "navigate",
              url: url,
              signals: [],
            },
          }),
        this.SIGNAL_NAVIGATION_DELAY
      );
    }

    return null;
  }

  isThere() {
    return !!this._channel;
  }
}
