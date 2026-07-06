# QuantEdge Platform (Public)

Multi-chain algorithmic trading platform — Solana, Ethereum, and Tron —
handling delegated wallet execution, portfolio risk management, and
automated settlement.

## About this repository

This is a **sanitized public copy** of the active QuantEdge codebase, shared
to showcase the engineering and architecture. Several files contain
proprietary trading logic (signal generation, regime classification, risk
sizing) — those files have real function signatures and structure but the
actual thresholds, weights, and formulas have been redacted and replaced
with placeholder values. Every redacted file is marked with a
`⚠️ PUBLIC REPO NOTICE` comment at the top describing exactly what was
removed and why.

Everything else — infrastructure, wallet/delegate integration, API design,
database schema, deployment configuration — is real and unmodified.

## Stack

- **Backend**: Node.js, Express, Prisma, PostgreSQL
- **Frontend**: React, Vite
- **Blockchain**: Solana (SPL), Ethereum (EVM), Tron (TRC20) via a delegate-authority
  execution model
- **Infra**: Docker Compose, nginx, PM2
