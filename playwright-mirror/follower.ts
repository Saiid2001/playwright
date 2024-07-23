import WebSocket from "ws";
import { spawn } from "child_process";
import { SignalingServerDisconnectedError } from "./errors.js";
import * as Constants from "./constants.js";
import { chromium, Browser, BrowserContext } from "playwright";

type FollowerParams = {
  wsEndpoint: string;
  browserWsEndpoint: string;
};

export class Follower {
  private _channel: WebSocket;
  private _browser: Browser;
  private _browserContext: BrowserContext;
  private _recorder: any;
  private _params: FollowerParams;
  private _browserWsEndpoint: string;
  private _wsEndpoint: string;
  private _waitingForServerConnection = true;
  private _ready = false;

  constructor(params: FollowerParams) {
    this._params = params;
    this._browserWsEndpoint =
      params.browserWsEndpoint || "ws://localhost:9222/0000";
    this._wsEndpoint = params.wsEndpoint || "ws://localhost:8080";
  }

  /**
   * Check if the follower is ready to register and send the message to the signaling server
   */
  tryFollowerReady() {
    if (!this._channel || !this._browser) return;
    if (!this._browser.isConnected()) return;
    if (this._channel.readyState !== WebSocket.OPEN) return;
    if (this._ready) return;

    this._channel.send(
      JSON.stringify({
        type: "register",
        data: {
          type: "follower",
        },
      })
    );

    this._ready = true;
  }

  _register() {
    if (!this._channel) return;

    const _channel = this._channel;

    _channel.on("open", () => {
      this.tryFollowerReady();

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
    console.log("Waiting for signaling server connection");

    const t = Date.now();

    const pause = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));

    const wait = async () => {
      while (this._waitingForServerConnection) {
        await pause(100);

        if (Date.now() - t > Constants.MAX_WAIT_FOR_SERVER_CONNECTION) {
          throw new SignalingServerDisconnectedError();
        }
      }
      console.log("Signaling server connected");
    };

    return wait();
  }

  /**
   * Process messages from the signaling server
   * @param {string} message The message from the signaling server
   * @returns {void}
   * @throws {SignalingServerDisconnectedError} If the server sends an error message
   */
  processServerMessages(message: string) {
    const data: Constants.Message = JSON.parse(message);

    switch (data.type) {
      case "management":
        this.processServerManagementMessages(data.data);
        break;
      case "error":
        this.processServerError(data.data);
        break;
      case "leaderChange":
        this.onChange(data.data);
        break;
    }
  }

  /**
   * Process management messages from the signaling server
   * @param data The data from the message
   * @returns {void}
   */
  processServerManagementMessages(data: { code: string; payload?: any }) {
    switch (data.code) {
      case "CONNECTION_SUCCESS":
        this._waitingForServerConnection = false;
        break;
      case "PARTIES_CHANGED":
        throw new SignalingServerDisconnectedError();
        break;
    }
  }

  /**
   * Process error messages from the signaling server
   * @param data The data from the message
   * @returns {void}
   * @throws {SignalingServerDisconnectedError}
   * @todo: errors need to be handled based on the error code
   */
  processServerError(data: { code: string; payload?: any }) {
    // TODO: non-developed. still playground
    throw new SignalingServerDisconnectedError();
  }

  /**
   * Process a close message from the signaling server
   * @returns {void}
   * @throws {SignalingServerDisconnectedError}
   */
  processServerClose() {
    throw new SignalingServerDisconnectedError();
  }

  /**
   * Connect to the browser hosted on the `wsEndpoint`
   * @returns {Promise<void>}
   */
  async connectBrowser() {
    this._browser = await chromium.connect(this._browserWsEndpoint);
    this._browserContext = await this._browser.newContext();

    await this._browserContext.newPage();

    this._recorder = await this._browserContext._enableRecorder({
      language: "javascript",
      mode: "recording",
    });

    this.tryFollowerReady();
  }

  /**
   * Handle a change message from the signaling server by
   * performing the action on the remote browser context
   * @param {any} change The change message from the signaling server
   * @returns {void}
   */
  onChange(change: any) {
    console.log("Leader changed to", change);

    this._browserContext._performRecorderAction({ action: change });
  }

  async start() {
    this._channel = new WebSocket(this._wsEndpoint);
    this._register();
    
    await this.connectBrowser();
    await this.tryFollowerReady();
    await this.waitForServerConnection();
  }

  async stop() {
    await this._browser.close();
    this._channel.close();
  }

  spawnProcess(params: FollowerParams) {
    const follower = spawn("node", [
      "run",
      "cli",
      "follower",
      `--ws-endpoint ${params.wsEndpoint}`,
      `--browser-ws-endpoint ${params.browserWsEndpoint}`,
    ]);

    follower.stdout.on("data", (data) => {
      console.log(`[follower]: ${data}`);
    });

    follower.stderr.on("data", (data) => {
      console.error(`[follower] ERROR: ${data}`);
    });

    follower.on("close", (code) => {
      console.log(`[follower] exited with code ${code}`);
    });

    return follower;
  }
}

// Usage example
// Run the following command in the terminal to start the follower client:
// npm run follower [browser ws endpoint? (default: ws://localhost:9222/0000)]

// const browserWsEndpoint = process.argv[2]
//   ? process.argv[2]
//   : "ws://localhost:9222/0000";

// const follower = new Follower({
//   wsEndpoint: "ws://localhost:8080",
//   browserWsEndpoint,
// });

// await follower.connectBrowser();

// // removing it should be fine but try a last time
// follower.tryFollowerReady();

// await follower.waitForServerConnection();

export default Follower;
