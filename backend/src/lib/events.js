const { EventEmitter } = require("events");

// Single event bus for the API process.
// Worker process writes to Postgres — API polls or uses its own emitter
// for socket.io notifications triggered by request handlers.
const events = new EventEmitter();
events.setMaxListeners(50);

// Event name constants
const EVENTS = {
  SIGNAL_NEW:           "signal:new",
  SIGNAL_EVALUATION:    "signal:evaluation",
  PROPOSAL_CREATED:     "proposal:created",
  PROPOSAL_STATUS:      "proposal:status",
  POSITION_UPDATED:     "position:updated",
  REGIME_TRANSITION:    "regime:transition",
  RISK_EVENT:           "risk:event",
  NOTIFICATION_NEW:     "notification:new",
};

module.exports = { events, EVENTS };
