import client from "./client";

export const auth = {
  login:   (email, password, deviceId) => client.post("/auth/login", { email, password, deviceId }),
  refresh: () => client.post("/auth/refresh"),
  logout:  () => client.post("/auth/logout"),
  register: (email, password, name, workspaceName) =>
    client.post("/auth/register", { email, password, name, workspaceName }),
  verifyEmail: (token) => client.post("/auth/verify-email", { token }),
  resendVerification: () => client.post("/auth/resend-verification"),
  verify2FALogin: (pendingToken, code, deviceId) => client.post("/auth/2fa/verify-login", { pendingToken, code, deviceId }),
  setup2FA: () => client.post("/auth/2fa/setup"),
  enable2FA: (code) => client.post("/auth/2fa/enable", { code }),
  disable2FA: (code) => client.post("/auth/2fa/disable", { code }),
  me: () => client.get("/auth/me"),
};

export const signals = {
  list:          (params) => client.get("/signals", { params }),
  get:           (id)     => client.get(`/signals/${id}`),
  evaluations:   (id)     => client.get(`/signals/${id}/evaluations`),
  regimeCurrent: ()       => client.get("/signals/regime/current"),
};

export const proposals = {
  list:   (params) => client.get("/proposals", { params }),
  get:    (id)     => client.get(`/proposals/${id}`),
  sign:   (id)     => client.post(`/proposals/${id}/sign`),
  cancel: (id)     => client.post(`/proposals/${id}/cancel`),
};

export const portfolios = {
  list:       ()       => client.get("/portfolios"),
  get:        (id)     => client.get(`/portfolios/${id}`),
  snapshots:  (id, p)  => client.get(`/portfolios/${id}/snapshots`, { params: p }),
  positions:  (id, p)  => client.get(`/portfolios/${id}/positions`, { params: p }),
  riskConfig: (id)     => client.get(`/portfolios/${id}/risk-config`),
  updateRisk: (id, d)  => client.patch(`/portfolios/${id}/risk-config`, d),
};

export const positions = {
  list:  (params) => client.get("/positions", { params }),
  get:   (id)     => client.get(`/positions/${id}`),
  close: (proposalId) => client.post(`/proposals/${proposalId}/close-position`),
};

export const wallets = {
  // ── Existing ───────────────────────────────────────────────────────────────
  list:   ()      => client.get("/wallets"),
  create: (data)  => client.post("/wallets", data),
  remove: (id)    => client.delete(`/wallets/${id}`),

  // ── Delegate linking ───────────────────────────────────────────────────────
  // Step 1: get approve() tx payload for one or more chains
  linkPayload:    (walletIds, capUSDT = 10000) =>
    client.post("/wallets/link-payload", { walletIds, capUSDT }),

  // Step 2: confirm link after user signs approve() tx
  linkConfirm:    (walletId, txHash) =>
    client.post(`/wallets/${walletId}/link-confirm`, { txHash }),

  // Unlink step 1: get revoke() tx payload
  unlinkPayload:  (walletId) =>
    client.post(`/wallets/${walletId}/unlink-payload`),

  // Unlink step 2: confirm revoke
  unlinkConfirm:  (walletId) =>
    client.post(`/wallets/${walletId}/unlink-confirm`),

  // Live on-chain balance + allowance for all linked wallets
  delegateStatus: () =>
    client.get("/wallets/delegate-status"),

  // Internal: execute trade across chains (called by signal engine)
  executeTrade:   (chains, toAddress, amountUSDT, amounts) =>
    client.post("/wallets/execute-trade", { chains, toAddress, amountUSDT, amounts }),
};

export const reports = {
  get:     (portfolioId, period = "monthly") => client.get(`/reports/${portfolioId}`, { params: { period } }),
  summary: (portfolioId) => client.get(`/reports/${portfolioId}/summary`),
};

export const onboarding = {
  get:        ()        => client.get("/onboarding"),
  saveStage:  (n, data) => client.post(`/onboarding/stage/${n}`, data),
  reset:      ()        => client.post("/onboarding/reset"),
};

export const marketing = {
  subscribe:   (email, name, source) => client.post("/marketing/subscribe", { email, name, source }),
  unsubscribe: (token) => client.post("/marketing/unsubscribe", { token }),
};

export const audit = {
  events:        (params) => client.get("/audit", { params }),
  notifications: (params) => client.get("/audit/notifications", { params }),
  markRead:      (id)     => client.patch(`/audit/notifications/${id}/read`),
};

export const kyc = {
  // User-facing
  status: () => client.get("/kyc/status"),
  submit: (formData) => client.post("/kyc/submit", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  }),

  // Admin-only (backend enforces requirePlatformAdmin regardless of what the
  // client sends — this is UI convenience, not the security boundary)
  adminPending: () => client.get("/kyc/admin/pending"),
  adminGet:     (id) => client.get(`/kyc/admin/${id}`),
  adminReview:  (id, decision, notes) => client.post(`/kyc/admin/${id}/review`, { decision, notes }),
};
