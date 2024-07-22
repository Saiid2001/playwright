import  WebSocket from "ws";

export const MAX_WAIT_FOR_SERVER_CONNECTION = 30000;

type Change = any;

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

export type Message = ErrorMessage | ManagementMessage | LeaderChangeMessage;

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

