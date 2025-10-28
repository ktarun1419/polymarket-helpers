// config.js
module.exports = {
  // Map YES token IDs to their market names
  markets: {
    "105493243911415328186853135427180882742964878728761632341401884622809951441015": {
      name: "netherlands-parliamentary-election-PVV",
      yesTokenId: "105493243911415328186853135427180882742964878728761632341401884622809951441015",
    },
    // Add more markets here
  },
  wsUrl: "wss://ws-subscriptions-clob.polymarket.com/ws/market",
  csvDirectory: "./orderbook_logs",
  heartbeatInterval: 25000, // 25 seconds
  reconnectDelay: 5000,
  maxReconnectAttempts: 10,
};
