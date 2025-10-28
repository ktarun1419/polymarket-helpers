// server.js
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const config = require("./config");

class PolymarketOrderbookLogger {
  constructor() {
    this.ws = null;
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    this.heartbeatInterval = null;
    this.lastPong = Date.now();
    this.subscribed = false;
    this.isRunning = true;
    
    this.initializeDirectories();
  }

  initializeDirectories() {
    if (!fs.existsSync(config.csvDirectory)) {
      fs.mkdirSync(config.csvDirectory, { recursive: true });
    }
  }

  getCSVPath(marketName, tokenType) {
    return path.join(config.csvDirectory, `${marketName}_${tokenType}.csv`);
  }

  initializeCSV(marketName, tokenType) {
    const csvPath = this.getCSVPath(marketName, tokenType);
    
    if (!fs.existsSync(csvPath)) {
      const headers = 'timestamp,asset_id,level,side,price,size\n';
      fs.writeFileSync(csvPath, headers);
      console.log(`📄 Created CSV: ${csvPath}`);
    }
  }

  async connect() {
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    this.isConnecting = true;
    console.log("🔄 Connecting to Polymarket WebSocket...");

    try {
      this.ws = new WebSocket(config.wsUrl);
      this.setupEventHandlers();

      return new Promise((resolve, reject) => {
        this.ws.once("open", () => {
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.lastPong = Date.now();
          console.log("✅ Connected to Polymarket WebSocket");

          this.startHeartbeat();
          this.subscribeToMarkets();
          resolve();
        });

        this.ws.once("error", (error) => {
          this.isConnecting = false;
          console.error("❌ Connection error:", error.message);
          reject(error);
        });
      });
    } catch (error) {
      this.isConnecting = false;
      throw error;
    }
  }

  setupEventHandlers() {
    // Handle incoming messages
    this.ws.on("message", (data) => {
      try {
        const events = JSON.parse(data.toString());
        if (Array.isArray(events)) {
          events.forEach((event) => this.handleMessage(event));
        }
      } catch (err) {
        console.error("❌ Message parsing error:", err.message);
      }
    });

    // Handle pong responses
    this.ws.on("pong", () => {
      this.lastPong = Date.now();
      console.log("💓 Pong received");
    });

    // Handle connection close
    this.ws.on("close", (code, reason) => {
      this.cleanup();
      console.log(`🔌 WebSocket closed (${code}): ${reason}`);
      this.scheduleReconnect();
    });

    // Handle errors
    this.ws.on("error", (error) => {
      console.error("❌ WebSocket error:", error.message);
    });
  }

  startHeartbeat() {
    this.stopHeartbeat();

    this.heartbeatInterval = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        console.log("⚠️ WebSocket not open, stopping heartbeat");
        this.stopHeartbeat();
        return;
      }

      const timeSinceLastPong = Date.now() - this.lastPong;
      if (timeSinceLastPong > config.heartbeatInterval * 2) {
        console.log("💔 No pong received, connection dead");
        this.ws.terminate();
        return;
      }

      try {
        this.ws.ping();
        console.log("📡 Ping sent");
      } catch (error) {
        console.error("❌ Failed to send ping:", error.message);
        this.ws.terminate();
      }
    }, config.heartbeatInterval);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  scheduleReconnect() {
    if (!this.isRunning) {
      console.log("🛑 Logger stopped, skipping reconnect");
      return;
    }

    if (this.reconnectAttempts >= config.maxReconnectAttempts) {
      console.error(`❌ Max reconnection attempts reached`);
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      config.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 
      60000
    );

    console.log(`🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${config.maxReconnectAttempts})`);

    setTimeout(() => {
      this.connect().catch((error) => {
        console.error("❌ Reconnection failed:", error.message);
        this.scheduleReconnect();
      });
    }, delay);
  }

  subscribeToMarkets() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log("⚠️ Cannot subscribe - WebSocket not open");
      return;
    }

    if (this.subscribed) {
      console.log("ℹ️ Already subscribed");
      return;
    }

    const tokenIds = Object.keys(config.markets);

    if (tokenIds.length === 0) {
      console.log("⚠️ No token IDs configured");
      return;
    }

    try {
      this.ws.send(
        JSON.stringify({
          type: "market",
          assets_ids: tokenIds,
        })
      );

      this.subscribed = true;
      console.log(`📡 Subscribed to ${tokenIds.length} markets`);
    } catch (error) {
      console.error("❌ Subscription failed:", error.message);
      this.subscribed = false;
    }
  }

  handleMessage(event) {
    console.log(event)
    if (event.event_type === "book") {
      this.processBookEvent(event);
    }
  }

  processBookEvent(event) {
    const { asset_id, bids, asks, timestamp } = event;

    const marketConfig = config.markets[asset_id];
    if (!marketConfig) {
      return;
    }

    this.logOrderbook(
      marketConfig.name, 
      'YES', 
      asset_id, 
      timestamp, 
      bids || [], 
      asks || []
    );

    // Calculate NO orderbook from YES data
    // NO bids = 1 - YES asks
    // NO asks = 1 - YES bids
    const noBids = (asks || []).map(ask => ({
      price: (1 - parseFloat(ask.price)).toFixed(4),
      size: ask.size
    })).sort((a, b) => parseFloat(b.price) - parseFloat(a.price));

    const noAsks = (bids || []).map(bid => ({
      price: (1 - parseFloat(bid.price)).toFixed(4),
      size: bid.size
    })).sort((a, b) => parseFloat(b.price) - parseFloat(a.price));

    this.logOrderbook(
      marketConfig.name, 
      'NO', 
      asset_id, 
      timestamp, 
      noBids, 
      noAsks
    );
  }

  logOrderbook(marketName, tokenType, assetId, timestamp, bids, asks) {
    this.initializeCSV(marketName, tokenType);

    const rows = [];

    // Log all bid levels
    bids.forEach((bid, index) => {
      rows.push([
        timestamp,
        assetId,
        index + 1,
        'BID',
        bid.price,
        bid.size
      ].join(','));
    });

    // Log all ask levels
    asks.forEach((ask, index) => {
      rows.push([
        timestamp,
        assetId,
        index + 1,
        'ASK',
        ask.price,
        ask.size
      ].join(','));
    });

    if (rows.length > 0) {
      const csvPath = this.getCSVPath(marketName, tokenType);
      const data = rows.join('\n') + '\n';
      fs.appendFileSync(csvPath, data);
      console.log(`[${marketName} ${tokenType}] ${bids.length} bids, ${asks.length} asks @ ${timestamp}`);
    }
  }

  cleanup() {
    this.stopHeartbeat();
    this.subscribed = false;
  }

  disconnect() {
    console.log("🛑 Disconnecting");
    this.isRunning = false;
    this.cleanup();

    if (this.ws) {
      this.ws.close(1000, "Normal shutdown");
      this.ws = null;
    }
  }
}

// Start the logger
const logger = new PolymarketOrderbookLogger();

logger.connect().catch((error) => {
  console.error("❌ Failed to start:", error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down gracefully...');
  logger.disconnect();
  process.exit(0);
});

console.log('📊 Polymarket Orderbook Logger Started');
console.log(`📁 CSV Directory: ${config.csvDirectory}`);
console.log(`🎯 Tracking ${Object.keys(config.markets).length} markets`);
