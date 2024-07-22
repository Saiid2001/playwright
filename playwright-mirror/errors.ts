
export class SignalingServerDisconnectedError extends Error {
    constructor() {
      super("Signaling server disconnected");
    }
  }