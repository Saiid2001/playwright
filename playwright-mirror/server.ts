// node.js ws server

import WebSocket, { WebSocketServer } from "ws";
import { errors, management, WebSocketClient } from "./constants.js";

const STRICT = true;
// get the number of expected followers from the command parameters
const expectedFollowers = process.argv[2] ? parseInt(process.argv[2]) : 1;

var leader: WebSocketClient | null = null;
var followers: WebSocketClient[] = [];
var _waitingForExpectedFollowers = true;
var _restarting = false;

function closeAllConnections() {
  if (leader) leader.channel.close();
  for (var follower of followers) {
    if (follower) follower.channel.close();
  }
}

function restart() {
  closeAllConnections();

  leader = null;
  followers = [];
  _waitingForExpectedFollowers = true;
}

function areExpectedPartiesConnected() {
  if (leader === null) {
    return false;
  }

  if (followers.length < expectedFollowers) {
    return false;
  }

  _waitingForExpectedFollowers = false;

  return true;
}

function sendSetupCompleteMessages() {
  console.log("Setup complete");
  leader?.channel.send(
    JSON.stringify({
      type: "management",
      data: {
        code: management.CONNECTION_SUCCESS,
      },
    })
  );
}

function sendSetupCompromizedMessages() {
  console.log("Setup compromised");
  for (var party of [leader, ...followers]) {
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

  if (STRICT) restart();
}

function processLeaderChange(change: any) {
  console.log("Leader change: ", change);

  for (var follower of followers) {
    if (!follower) continue;

    follower.channel.send(
      JSON.stringify({
        type: "leaderChange",
        data: change,
      })
    );
  }
}

function processLeaderMessage(message: any) {
  const data: { type: string; data: any } = JSON.parse(message.toString());

  switch (data.type) {
    case "change":
      processLeaderChange(data.data);
      break;

    default:
      console.error("Unknown message type: ", data.type);
      break;
  }
}

function registerLeader(client: WebSocketClient) {
  if (leader) {
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

  if (followers.includes(client)) {
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
  leader = client;
  console.log(`${new Date()}: Leader connected with id: ${client["id"]}`);

  // send connection success message
  if (areExpectedPartiesConnected()) sendSetupCompleteMessages();

  // register leader messages
  client.channel.on("message", processLeaderMessage);

  client.channel.on("close", () => {
    leader = null;
    sendSetupCompromizedMessages();
  });
}

function registerFollower(client: WebSocketClient) {
  if (leader?.channel === client.channel) {
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

  if (followers.includes(client)) {
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

  if (!_waitingForExpectedFollowers) sendSetupCompromizedMessages();

  followers.push(client);
  console.log(
    `${new Date()}: Follower connected with id: ${client.id} | followers: ${
      followers.length
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
    followers = followers.filter(
      (follower) => follower.channel !== client.channel
    );
    sendSetupCompromizedMessages();
  });

  // check if all expected parties are connected
  if (areExpectedPartiesConnected()) sendSetupCompleteMessages();

  // register follower messages
}

type RegistrationData = {
  type: "leader" | "follower";
};

function onRegistrationMessage(data: RegistrationData, ws: WebSocket) {
  const id = Math.random().toString(36).substring(2, 9);

  switch (data.type) {
    case "leader":
      registerLeader({ channel: ws, id });
      break;
    case "follower":
      registerFollower({ channel: ws, id });
      break;
  }
}

type Message =
  | { type: "register"; data: RegistrationData }
  | { type: "message"; data: any };

const wss = new WebSocketServer({ port: 8080 });

wss.on("listening", () => {
  console.log("Server is listening: ws://localhost:8080");
});

wss.on("connection", (ws) => {
  // get the browser type from the connection

  ws.on("message", (message) => {
    const data: Message = JSON.parse(message.toString());

    switch (data.type) {
      case "register":
        onRegistrationMessage(data.data, ws);
        break;
    }
  });
});
