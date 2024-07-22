1. Start the signaling server to coordinate between the leader and the follower
    ```bash
    # inside playwright-mirror/
    npm run start
    ```
    This command will start the signaling server on port 8080. 

    To add multiple followers, you can add the number of expected followers to the command:
    ```bash
    # inside playwright-mirror
    npm run start [number of followers]
    ```

3. start the follower browser-server with the following command:
    ```bash
    npx playwright launch-server --browser=chromium --config=playwright-mirror/launchServer.json 
    ```
    The follower browser server will open and expose the browser to the signaling server. 

2. open the leader browser with the following command:
    ```bash
    npx playwright mirror-leader --leader-ws-endpoint=ws://localhost:8080
    ```
    This browser will wait until all followers are connected to the signaling server.

4. Start follower clients with the following command:
    ```bash
    # inside playwright-mirror
    npm run follower
    ```