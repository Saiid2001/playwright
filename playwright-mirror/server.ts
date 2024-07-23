// node.js ws server

import WebSocket, { WebSocketServer } from "ws";
import { spawn } from "child_process";
import {
  errors,
  management,
  Message,
  RegistrationData,
  WebSocketClient,
} from "./constants.js";

type SignalingServerParams = {
  expectedFollowers?: number;
  strict?: boolean;
  host?: string;
  port?: number;
};

class SignalingServer {
  private STRICT;
  private expectedFollowers;

  private leader: WebSocketClient | null = null;
  private followers: WebSocketClient[] = [];
  private _waitingForExpectedFollowers;
  private _restarting = false;

  private _wss: WebSocketServer | null = null;
  private _host: string;
  private _port: number;

  constructor(params: SignalingServerParams) {
    this.expectedFollowers = params.expectedFollowers || 1;
    this.STRICT = params.strict || true;
    this._host = params.host || "localhost";
    this._port = params.port || 8080;
  }

  closeAllConnections() {
    if (this.leader) this.leader.channel.close();
    for (var follower of this.followers) {
      if (follower) follower.channel.close();
    }
  }

  restart() {
    this.closeAllConnections();

    this.leader = null;
    this.followers = [];
    this._waitingForExpectedFollowers = true;
  }

  areExpectedPartiesConnected() {
    if (this.leader === null) {
      return false;
    }

    if (this.followers.length < this.expectedFollowers) {
      return false;
    }

    this._waitingForExpectedFollowers = false;

    return true;
  }

  sendSetupCompleteMessages() {
    console.log("Setup complete");
    this.leader?.channel.send(
      JSON.stringify({
        type: "management",
        data: {
          code: management.CONNECTION_SUCCESS,
        },
      })
    );
  }

  sendSetupCompromizedMessages() {
    console.log("Setup compromised");
    for (var party of [this.leader, ...this.followers]) {
      if (!party) continue;

      party.channel.send(
        JSON.stringify({
          type: "management",
          data: {
            code: management.PARTIES_CHANGED,
          },
        })
      );
    }

    if (this.STRICT) this.restart();
  }

  processLeaderChange(change: any) {
    console.log("Leader change: ", change);

    for (var follower of this.followers) {
      if (!follower) continue;

      follower.channel.send(
        JSON.stringify({
          type: "leaderChange",
          data: change,
        })
      );
    }
  }

  processLeaderMessage(message: any) {
    const data: { type: string; data: any } = JSON.parse(message.toString());

    switch (data.type) {
      case "change":
        this.processLeaderChange(data.data);
        break;

      default:
        console.error("Unknown message type: ", data.type);
        break;
    }
  }

  registerLeader(client: WebSocketClient) {
    if (this.leader) {
      client.channel.send(
        JSON.stringify({
          type: "error",
          data: {
            code: errors.LEADER_ALREADY_CONNECTED,
          },
        })
      );
      client.channel.close();
      return;
    }

    if (this.followers.includes(client)) {
      client.channel.send(
        JSON.stringify({
          type: "error",
          data: {
            code: errors.FOLLOWER_CANNOT_BE_LEADER,
          },
        })
      );
      return;
    }

    // set the leader
    this.leader = client;
    console.log(`${new Date()}: Leader connected with id: ${client["id"]}`);

    // send connection success message
    if (this.areExpectedPartiesConnected()) this.sendSetupCompleteMessages();

    // register leader messages
    client.channel.on("message", this.processLeaderMessage);

    client.channel.on("close", () => {
      this.leader = null;
      this.sendSetupCompromizedMessages();
    });
  }

  registerFollower(client: WebSocketClient) {
    if (this.leader?.channel === client.channel) {
      client.channel.send(
        JSON.stringify({
          type: "error",
          data: {
            code: errors.LEADER_CANNOT_BE_FOLLOWER,
          },
        })
      );
      return;
    }

    if (this.followers.includes(client)) {
      client.channel.send(
        JSON.stringify({
          type: "error",
          data: {
            code: errors.FOLLOWER_ALREADY_CONNECTED,
          },
        })
      );
      return;
    }

    if (!this._waitingForExpectedFollowers) this.sendSetupCompromizedMessages();

    this.followers.push(client);
    console.log(
      `${new Date()}: Follower connected with id: ${client.id} | followers: ${
        this.followers.length
      }`
    );

    // send connection success message
    client.channel.send(
      JSON.stringify({
        type: "management",
        data: {
          code: management.CONNECTION_SUCCESS,
        },
      })
    );

    client.channel.on("close", () => {
      this.followers = this.followers.filter(
        (follower) => follower.channel !== client.channel
      );
      this.sendSetupCompromizedMessages();
    });

    // check if all expected parties are connected
    if (this.areExpectedPartiesConnected()) this.sendSetupCompleteMessages();

    // register follower messages
  }

  onRegistrationMessage(data: RegistrationData, ws: WebSocket) {
    const id = Math.random().toString(36).substring(2, 9);

    switch (data.type) {
      case "leader":
        this.registerLeader({ channel: ws, id });
        break;
      case "follower":
        this.registerFollower({ channel: ws, id });
        break;
    }
  }

  isRunning() {
    return this._wss?.options.port ? true : false;
  }

  isLeaderConnected() {
    return this.leader !== null;
  }

  isFollowerConnected() {
    return this.followers.length > 0;
  }

  getLeader() {
    return this.leader;
  }

  getFollowers() {
    return this.followers;
  }

  start() {
    const wss = new WebSocketServer({ port: this._port, host: this._host });
    this._wss = wss;

    wss.on("listening", () => {
      console.log(
        `Signaling server started on ws://${this._host}:${this._port}`
      );
    });

    wss.on("connection", (ws) => {
      // get the browser type from the connection

      ws.on("message", (message) => {
        const data: Message = JSON.parse(message.toString());

        switch (data.type) {
          case "register":
            this.onRegistrationMessage(data.data, ws);
            break;
        }
      });
    });
  }

  static spawnProcess(params: SignalingServerParams) {
    const server = spawn("npm", [
      "run",
      "cli",
      "playwright-mirror",
      "server",
      `--port ${params.port}`,
      `--host ${params.host}`,
      params.strict ? `--strict` : "",
      `--expected-followers ${params.expectedFollowers}`,
    ]);

    server.stdout.on("data", (data) => {
      console.log(`[signaling-server]: ${data}`);
    });

    server.stderr.on("data", (data) => {
      console.error(`[signaling-server]: ${data}`);
    });

    server.on("close", (code) => {
      console.log(`[signaling-server] exited with code ${code}`);
    });

    return server;
  }

  stop() {
    this._wss?.close();
  }
}

export default SignalingServer;
