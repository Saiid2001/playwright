import { spawn } from "child_process";
import * as Constants from "./constants.js";

type LeaderParams = {
  wsEndpoint?: string;
  // browserWsEndpoint?: string;
};

export class Leader {
  
  private _params: LeaderParams;
  // private _browserWsEndpoint: string;
  // private _isRemoteBrowser: boolean;
  private _browserProcess: any = null;
  private _wsEndpoint: string;
  // private _waitingForServerConnection = true;
  // private _ready = false;

  constructor(params: LeaderParams) {
    this._params = params;
    // this._browserWsEndpoint =
      // params.browserWsEndpoint || "ws://localhost:9222/0000";

    // this._isRemoteBrowser = !!params.browserWsEndpoint;

    this._wsEndpoint = params.wsEndpoint || "ws://localhost:8080";
  }



  async stop() {
    if (this._browserProcess) {
      this._browserProcess.kill();
    }
  }


  static spawnProcess(params: LeaderParams) {

    const wsEndpoint = params.wsEndpoint || "ws://localhost:8080";

    const leader = spawn("npx", [
      "playwright",
      "mirror-leader",
      `--leader-ws-endpoint`,
      wsEndpoint
      // `--browser-ws-endpoint ${params.browserWsEndpoint}`, 
    ]);
    
    leader.stdout.on("data", (data) => {
      console.log(`[leader]: ${data}`);
    });

    leader.stderr.on("data", (data) => {
      console.log(`[leader] ERROR: ${data}`);
    });

    leader.on("close", (code) => {
      console.log(`[leader] exited with code ${code}`);
    });

    return leader;
  }

  
}

export default Leader;
