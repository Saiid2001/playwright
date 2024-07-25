import WebSocket from "ws";
import { spawn } from "child_process";
import { SignalingServerDisconnectedError } from "./errors.js";
import * as Constants from "./constants.js";
import { chromium, Browser, BrowserContext } from "playwright";
import { wait } from "./utils.js";

type FollowerParams = {
  wsEndpoint?: string;
  browserWsEndpoint?: string;
  storage?: string;
  url?: string;
};

export class Follower {
  private _channel: WebSocket;
  private _browser: Browser;
  private _browserContext: BrowserContext;
  private _recorder: any;
  private _params: FollowerParams;
  private _browserWsEndpoint: string;
  private _isRemoteBrowser: boolean;
  private _browserProcess: any = null;
  private _wsEndpoint: string;
  private _waitingForServerConnection = true;
  private _ready = false;

  constructor(params: FollowerParams) {
    this._params = params;
    this._browserWsEndpoint =
      params.browserWsEndpoint || "ws://127.0.0.1:9222/0000";

    this._isRemoteBrowser = !!params.browserWsEndpoint;

    this._wsEndpoint = params.wsEndpoint || "ws://127.0.0.1:8080";
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

    const globalThis = this;

    _channel.on("open", () => {
      globalThis.tryFollowerReady();

      _channel.on("close", () => {
        globalThis.processServerClose();
      });

      _channel.on("error", () => {
        throw new SignalingServerDisconnectedError();
      });

      _channel.on("message", (message) => {
        globalThis.processServerMessages(message.toString());
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
        // throw new SignalingServerDisconnectedError();
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
    this._browserContext = await this._browser.newContext({
      storageState: this._params.storage ? this._params.storage : undefined,
    });

    const page = await this._browserContext.newPage();

    this._recorder = await (this._browserContext as any)._enableRecorder({
      language: "javascript",
      mode: "recording",
    });

    // visit the page
    if (this._params.url) {
      await page.goto(this._params.url);
    }

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

    (this._browserContext as any)._performRecorderAction({ action: change });
  }

  async start() {
    process.on("SIGINT", () => {
      this._browserProcess?.kill();
    });

    process.on("SIGTERM", () => {
      this._browserProcess?.kill();
    });

    process.on("uncaughtException", (error) => {
      try {
        this._browserProcess?.kill();
      } catch (e) {
        console.error(e);
      }

      console.error(error);
      process.exit(1);
    });

    if (!this._isRemoteBrowser) {
      this.spawnBrowser();
    }

    this._channel = new WebSocket(this._wsEndpoint);
    this._register();

    await wait(3000);

    await this.connectBrowser();
    await this.tryFollowerReady();
    await this.waitForServerConnection();
  }

  async stop() {
    this._channel.close();

    if (this._browserProcess) {
      this._browserProcess.kill();
    }
  }

  static start(params: FollowerParams) {
    const follower = new Follower(params);
    follower.start();
    return follower;
  }

  static spawnProcess(params: FollowerParams) {
    
    const wsEndpoint = params.wsEndpoint || "ws://127.0.0.1:8080";
    const browserWsEndpoint = params.browserWsEndpoint || "ws://127.0.0.1:9222/0000";
    
    const follower = spawn("npm", [
      "--prefix",
      Constants.pkg_path,
      "run",
      "cli",
      "follower",
      `--`,
      params.wsEndpoint?`--ws-endpoint`:``,
      params.wsEndpoint? wsEndpoint : "",
      params.browserWsEndpoint?`--browser-ws-endpoint`:``,
      params.browserWsEndpoint?browserWsEndpoint:"",
      params.storage ? `--storage=${params.storage}` : "",
      params.url ? `--url=${params.url}` : "",
    ]);

    follower.stdout.on("data", (data) => {
      console.log(`[follower]: ${data}`);
    });

    follower.stderr.on("data", (data) => {
      console.log(`[follower] ERROR: ${data}`);
      // throw new Error(`[follower] ERROR: ${data}`);
    });

    follower.on("close", (code) => {
      console.log(`[follower] exited with code ${code}`);
      // throw new Error(`[follower] exited with code ${code}`);
    });

    return follower;
  }

  spawnBrowser() {
    const browser = spawn("npx", [
      "--prefix",
      Constants.pkg_path,
      "playwright",
      "launch-server",
      "--browser=chromium",
      "--config",
      Constants.pkg_path + "launchServer.json",
    ]);

    browser.stdout.on("data", (data) => {
      console.log(`[follower-browser]: ${data}`);
    });

    browser.stderr.on("data", (data) => {
      console.log(`[follower-browser] ERROR: ${data}`);
      // throw new Error(`[follower-browser] ERROR: ${data}`);
    });

    browser.on("close", (code, signal) => {
      console.log(`[follower-browser] exited with code ${code} ${signal}`);
    });

    this._browserProcess = browser;

    return browser;
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
