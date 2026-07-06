// Design tokens — single source of truth
// All colors, spacing, and typography referenced from here

export const colors = {
  bg:       "#0A0A0F",
  surface:  "#111118",
  surface2: "#16161F",
  border:   "#1E1E2E",
  border2:  "#252538",
  text:     "#E8F4F8",
  muted:    "#5A6478",
  green:    "#00D4AA",
  red:      "#FF4D6D",
  violet:   "#7B61FF",
  orange:   "#FF8C00",
};

export const regime = {
  QUIET_BULLISH: { color: colors.green,  pulse: "#00D4AA33", label: "Quiet Bullish" },
  QUIET_BEARISH: { color: colors.red,    pulse: "#FF4D6D33", label: "Quiet Bearish" },
  STRESS:        { color: colors.orange, pulse: "#FF8C0033", label: "Stress"        },
  TRANSITIONING: { color: colors.violet, pulse: "#7B61FF33", label: "Transitioning" },
};

export const statusMap = {
  // Proposals
  PENDING:   { label: "Awaiting Signature", color: colors.violet },
  SIGNED:    { label: "Signing",            color: colors.violet },
  SUBMITTED: { label: "Broadcasting",       color: colors.orange },
  CONFIRMED: { label: "Confirmed",          color: colors.green  },
  FAILED:    { label: "Failed",             color: colors.red    },
  CANCELLED: { label: "Cancelled",          color: colors.muted  },
  // Signals
  ACTIVE:    { label: "Active",             color: colors.green  },
  EXPIRED:   { label: "Expired",            color: colors.muted  },
  // Positions
  OPEN:      { label: "Open",              color: colors.green  },
  CLOSED:    { label: "Closed",            color: colors.muted  },
  LIQUIDATED:{ label: "Liquidated",        color: colors.red    },
  // Evaluations
  APPROVED:  { label: "Approved",          color: colors.green  },
  BLOCKED:   { label: "Blocked",           color: colors.red    },
  SKIPPED:   { label: "Skipped",           color: colors.muted  },
};

export const blockReasonMap = {
  DRAWDOWN_BREACH:      "Portfolio drawdown limit reached",
  POSITION_LIMIT:       "Position size limit reached",
  STRESS_CAP:           "Stress regime exposure cap reached",
  BELOW_THRESHOLD:      "Signal strength below threshold",
  MANUAL:               "Manually dismissed",
  INSUFFICIENT_BALANCE: "Insufficient portfolio balance",
};
