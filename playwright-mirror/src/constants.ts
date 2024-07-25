import  WebSocket from "ws";

export const MAX_WAIT_FOR_SERVER_CONNECTION = 30000;

type Change = any;

export type RegistrationData = {
  type: "leader" | "follower";
};


export type BaseMessage = {
  type: string,
}

export type ErrorMessage = BaseMessage & {
  type: "error",
  data: {
    code: string,
  },
}

export type ManagementMessage = BaseMessage & {
  type: "management",
  data: {
    code: string,
    payload?: any,
  },
}

export type LeaderChangeMessage = BaseMessage & {
  type: "leaderChange",
  data: Change,
}

export type RegisterMessage = {
  type: "register",
  data: RegistrationData
}

export type Message = ErrorMessage | ManagementMessage | LeaderChangeMessage | RegisterMessage;

export const errors = {
  LEADER_ALREADY_CONNECTED: "LEADER_ALREADY_CONNECTED",
  LEADER_CANNOT_BE_FOLLOWER: "LEADER_CANNOT_BE_FOLLOWER",
  FOLLOWER_ALREADY_CONNECTED: "FOLLOWER_ALREADY_CONNECTED",
  FOLLOWER_CANNOT_BE_LEADER: "FOLLOWR_CANNOT_BE_LEADER",
  CONNECTION_ERROR: "CONNECTION_ERROR",
  NOT_CONNECTED: "NOT_CONNECTED",
};

export const management = {
  CONNECTION_SUCCESS: "CONNECTION_SUCCESS",
  PARTIES_CHANGED: "PARTIES_CHANGED",
}

export type WebSocketClient = {
  channel: WebSocket;
  id: string;
}

// get the directory of the current file

function isTypescript() {
  return import.meta.url.includes("src");
}

var _pkg_path: string;

if (!isTypescript()) {
  _pkg_path = new URL('../../', import.meta.url).pathname;
} else {
  _pkg_path = new URL('../', import.meta.url).pathname;
}

export const pkg_path = _pkg_path;

