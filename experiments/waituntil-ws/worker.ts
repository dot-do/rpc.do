/**
 * POC: Testing if ctx.waitUntil can keep WebSocket connections alive after fetch handler returns
 *
 * Key question: Can we return a response immediately and continue processing WebSocket messages
 * that arrive AFTER the response was sent?
 */

// Re-export the Durable Object class so wrangler can find it
export { TestDO } from './test-do';

export interface Env {
  TEST_DO: DurableObjectNamespace;
}

// Module-level state to track WebSocket connection and timing
interface ConnectionState {
  ws: WebSocket | null;
  responseTime: number | null;
  messagesAfterResponse: Array<{ message: string; receivedAt: number; delayFromResponse: number }>;
  connectionId: string;
}

const state: ConnectionState = {
  ws: null,
  responseTime: null,
  messagesAfterResponse: [],
  connectionId: '',
};

/**
 * Creates a promise that processes WebSocket messages
 * This promise is passed to ctx.waitUntil() to keep processing after response
 */
function createWebSocketProcessor(ws: WebSocket, connectionId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let messageCount = 0;
    const expectedMessages = 10; // DO sends 10 messages, 1 per second

    ws.addEventListener('message', (event) => {
      messageCount++;
      const now = Date.now();
      const delayFromResponse = state.responseTime ? now - state.responseTime : 0;

      const messageData = {
        message: typeof event.data === 'string' ? event.data : 'binary data',
        receivedAt: now,
        delayFromResponse,
      };

      state.messagesAfterResponse.push(messageData);

      // Critical log: Shows messages arriving AFTER response was sent
      console.log(`[${connectionId}] WS MESSAGE RECEIVED:`);
      console.log(`  - Message #${messageCount}: ${messageData.message}`);
      console.log(`  - Time since response: ${delayFromResponse}ms`);
      console.log(`  - Response already sent: ${state.responseTime !== null}`);

      if (delayFromResponse > 0) {
        console.log(`  *** PROOF: This message arrived ${delayFromResponse}ms AFTER response was sent! ***`);
      }
    });

    ws.addEventListener('close', (event) => {
      console.log(`[${connectionId}] WebSocket closed after ${messageCount} messages`);
      console.log(`[${connectionId}] Messages received after response: ${state.messagesAfterResponse.length}`);
      resolve();
    });

    ws.addEventListener('error', (event) => {
      console.error(`[${connectionId}] WebSocket error:`, event);
      reject(new Error('WebSocket error'));
    });

    // Timeout after 15 seconds (DO sends for 10 seconds)
    setTimeout(() => {
      console.log(`[${connectionId}] Processor timeout - received ${messageCount} messages`);
      resolve();
    }, 15000);
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Status endpoint to check what messages we received
    if (url.pathname === '/status') {
      return new Response(JSON.stringify({
        connectionId: state.connectionId,
        responseTime: state.responseTime,
        messagesReceived: state.messagesAfterResponse.length,
        messages: state.messagesAfterResponse,
        wsState: state.ws?.readyState,
      }, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Reset endpoint to clear state
    if (url.pathname === '/reset') {
      if (state.ws) {
        state.ws.close();
      }
      state.ws = null;
      state.responseTime = null;
      state.messagesAfterResponse = [];
      state.connectionId = '';
      return new Response('State reset');
    }

    // Main test endpoint
    if (url.pathname === '/test') {
      const connectionId = `conn-${Date.now()}`;
      state.connectionId = connectionId;
      state.messagesAfterResponse = [];

      console.log(`[${connectionId}] Starting WebSocket test`);

      // Get a Durable Object stub
      const doId = env.TEST_DO.idFromName('test-ws-session');
      const doStub = env.TEST_DO.get(doId);

      // Create WebSocket connection to the Durable Object
      const wsUrl = new URL(request.url);
      wsUrl.pathname = '/websocket';
      wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';

      // Make a request to the DO to get a WebSocket
      const upgradeRequest = new Request(wsUrl.toString(), {
        headers: {
          'Upgrade': 'websocket',
        },
      });

      const wsResponse = await doStub.fetch(upgradeRequest);

      if (wsResponse.status !== 101) {
        return new Response(`Failed to establish WebSocket: ${wsResponse.status}`, { status: 500 });
      }

      // Get the WebSocket from the response
      const ws = wsResponse.webSocket;
      if (!ws) {
        return new Response('No WebSocket in response', { status: 500 });
      }

      state.ws = ws;
      ws.accept();

      console.log(`[${connectionId}] WebSocket connected, setting up waitUntil`);

      // Create the processor promise BEFORE returning response
      const processorPromise = createWebSocketProcessor(ws, connectionId);

      // Tell the DO to start sending messages
      ws.send(JSON.stringify({ action: 'start', connectionId }));

      // THIS IS THE KEY: Use ctx.waitUntil to keep the WebSocket processor alive
      ctx.waitUntil(processorPromise);

      // Record when we're about to send the response
      state.responseTime = Date.now();

      console.log(`[${connectionId}] Returning response at ${state.responseTime}`);
      console.log(`[${connectionId}] WebSocket processing continues via waitUntil...`);

      // Return response IMMEDIATELY - WebSocket should continue processing
      return new Response(JSON.stringify({
        status: 'Response sent - WebSocket still processing in background',
        connectionId,
        responseTime: state.responseTime,
        checkStatusAt: '/status',
        expectedBehavior: 'Messages should continue arriving for ~10 seconds after this response',
      }, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(`
      WebSocket waitUntil Test

      Endpoints:
      - GET /test   - Start a new WebSocket test
      - GET /status - Check received messages
      - GET /reset  - Reset state

      Test Flow:
      1. Call /test - returns immediately
      2. Wait 10+ seconds
      3. Call /status - should show messages received AFTER response
    `, {
      headers: { 'Content-Type': 'text/plain' },
    });
  },
};
