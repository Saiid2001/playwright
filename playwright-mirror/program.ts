import { program } from "commander";
import SignalingServer from "./server.js";
import Follower from "./follower.js";


program
  .version("1.0.0")
  .description("Playwright Mirror CLI")


// Start server command
// npx playwright-mirror server --port 8080 --host localhost --strict --expected-followers 1
program
    .command("server")
    .description("Start the signaling server")
    .option("-p, --port <port>", "Port to start the signaling server on")
    .option("-h, --host <host>", "Host to start the signaling server on")
    .option("-s, --strict", "Strict mode")
    .option("-e, --expected-followers <expectedFollowers>", "Expected number of followers")
    .action((options) => {
        const signalingServer = new SignalingServer({
            port: options.port,
            host: options.host,
            strict: options.strict,
            expectedFollowers: options.expectedFollowers
        });

        signalingServer.start();
    }
);

// Start follower command
// npx playwright-mirror follower --ws-endpoint ws://localhost:8080 --browser-ws-endpoint ws://localhost:9222/0000

program
    .command("follower")
    .description("Start the follower client")
    .option("-w, --ws-endpoint <wsEndpoint>", "WebSocket endpoint to connect to")
    .option("-b, --browser-ws-endpoint <browserWsEndpoint>", "Browser WebSocket endpoint to connect to")
    .action((options) => {
        // Start the follower client
        const follower = new Follower({
            wsEndpoint: options.wsEndpoint,
            browserWsEndpoint: options.browserWsEndpoint
        });

        follower.start();
    }
);

program.parse(process.argv);