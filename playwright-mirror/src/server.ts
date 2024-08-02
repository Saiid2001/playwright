// node.js ws server

import WebSocket, { WebSocketServer } from "ws";
import { spawn } from "child_process";
import {
  errors,
  management,
  Message,
  pkg_path,
  RegistrationData,
  WebSocketClient,
} from "./constants.js";
import EventEmitter from "events";

export type SignalingServerParams = {
  expectedFollowers?: number;
  strict?: boolean;
  host?: string;
  port?: number;
  onAction?: (action: any) => void;
  blockedActions?: string[];
};

export enum SignalingServerEvents {
  LEADER_ACTION = "leaderChange",
  SESSION_STARTED = "sessionStarted",
  SESSION_COMPROMISED = "sessionCompromised",
  LEADER_CONNECTED = "leaderConnected",
  FOLLOWER_CONNECTED = "followerConnected",
  FOLLOWER_DISCONNECTED = "followerDisconnected",
  LEADER_DISCONNECTED = "leaderDisconnected",
}

export type SignalingServerEvent = {
  id: number;
  type: SignalingServerEvents;
  data: any;
  created_at: Date;
};


class SignalingServer extends EventEmitter {
  private STRICT;
  private expectedFollowers;

  private _eventCounter = 0;

  private leader: WebSocketClient | null = null;
  private followers: WebSocketClient[] = [];
  private _waitingForExpectedFollowers = true;
  private _restarting = false;
  private _blockedActions: string[] = [];

  private _wss: WebSocketServer | null = null;
  private _host: string;
  private _port: number;

  constructor(params: SignalingServerParams) {
    super();
    this.expectedFollowers = params.expectedFollowers || 1;
    this.STRICT = params.strict || true;
    this._host = params.host || "127.0.0.1";
    this._port = params.port || 8080;
    this._blockedActions = params.blockedActions || [];
  }

  closeAllConnections() {

    this.sendServerCloseMessages();
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

  emitEvent(event: SignalingServerEvents, data: any, createdAt?: Date) {
    this.emit(event, {id: this._eventCounter, type: event, data, created_at: createdAt || new Date() });
    this._eventCounter++;
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
    this.leader?.channel.send(
      JSON.stringify({
        type: "management",
        data: {
          code: management.CONNECTION_SUCCESS,
        },
      })
    );

    this.emitEvent(SignalingServerEvents.SESSION_STARTED, {
      leader:(this.leader as any).id,
      followers: this.followers.map((follower) => follower.id),
    });
  }

  sendServerCloseMessages() {
    for (var party of [this.leader, ...this.followers]) {
      if (!party) continue;

      party.channel.send(
        JSON.stringify({
          type: "management",
          data: {
            code: management.CLOSE,
          },
        })
      );
    }
  }

  sendSetupCompromizedMessages() {
    
    console.error("Mirroring session compromised");
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

    this.emitEvent(SignalingServerEvents.SESSION_COMPROMISED, {
      isLeader: this.leader !== null,
      isFollower: this.followers.length > 0,
    })

    if (this.STRICT) this.restart();
  }

  processLeaderChange(change: any) {

    if (this._blockedActions.includes(change.action.name)) {
      console.log("Blocked action: ", change.action.name);
      return;
    }
   
    this.emitEvent(SignalingServerEvents.LEADER_ACTION, change);

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
    this.emitEvent(SignalingServerEvents.LEADER_CONNECTED, { id: client["id"] });

    // send connection success message
    if (this.areExpectedPartiesConnected()) this.sendSetupCompleteMessages();

    var globalThis = this;

    // register leader messages
    client.channel.on("message", (message) => {
      globalThis.processLeaderMessage(message);
    });

    client.channel.on("close", () => {
      globalThis.leader = null;
      globalThis.emitEvent(SignalingServerEvents.LEADER_DISCONNECTED, { id: client.id });
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
    this.emitEvent(SignalingServerEvents.FOLLOWER_CONNECTED, { id: client.id });

    // send connection success message
    client.channel.send(
      JSON.stringify({
        type: "management",
        data: {
          code: management.CONNECTION_SUCCESS,
        },
      })
    );

    var globalThis = this;

    client.channel.on("close", () => {
      globalThis.followers = globalThis.followers.filter(
        (follower) => follower.channel !== client.channel
      );
      globalThis.emitEvent(SignalingServerEvents.FOLLOWER_DISCONNECTED, { id: client.id });
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

    process.on("SIGINT", () => {
      this.closeAllConnections();
      wss.close();
      process.exit(0);
    });

    process.on("SIGTERM", () => {
      this.closeAllConnections();
      wss.close();
      process.exit(0);
    });

  }

  static start(params: SignalingServerParams) {
    const server = new SignalingServer(params);
    server.start();
    return server;
  }

  static spawnProcess(params: SignalingServerParams) {
    var port = params.port || 8080;
    var host = params.host || "localhost";
    var strict = params.strict || true;
    var expectedFollowers = params.expectedFollowers || 1;

    const server = spawn("npm", [
      "--prefix",
      pkg_path,
      "run",
      "cli",
      "server",
      `--port=${port}`,
      `--host=${host}`,
      `--strict=${strict}`,
      `--expected-followers=${expectedFollowers}`,
    ]);

    server.stdout.on("data", (data) => {
      console.log(`[signaling-server]: ${data}`);
    });

    server.stderr.on("data", (data) => {
      throw new Error(`[signaling-server] ERROR: ${data}`);
    });

    server.on("close", (code) => {
      console.log(`[signaling-server] exited with code ${code}`);
    });

    return server;
  }

  stop() {
    this.closeAllConnections();
    this._wss?.close();
  }
}

export default SignalingServer;
