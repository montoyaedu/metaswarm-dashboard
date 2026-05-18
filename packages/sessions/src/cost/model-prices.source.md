# Model pricing — sources & verification note

This file documents the provenance of `model-prices.json` (sessions-spike
design §5.1). All rates are **per 1,000,000 tokens, in USD**.

> **Operator action required.** These rates are pinned from the vendors'
> public pricing pages **as of `pricingAsOf` (2026-05-18)**. AI vendor
> pricing changes without notice. Before relying on any cost figure shown
> by the dashboard, **verify the rates below against each vendor's current
> pricing page** and update `model-prices.json` (its `pricingAsOf` is
> surfaced in the UI so a stale table is visible — design §8.2). v5 ships
> no live price fetch by design (§11.3).

## Why a pinned in-repo table

Prices are version-controlled, Zod-validated, and contain no network /
supply-chain surface (design §9). The cost-calculator's unit tests use a
**fixed in-test table**, never this file — so correcting a real rate here
never breaks `calculator.test.ts`. `pricing.test.ts` is the separate guard
that *this* shipped file stays schema-valid.

## Anthropic — Claude 4.x family

Source: Anthropic pricing page (`https://www.anthropic.com/pricing` and the
API pricing docs). Anthropic prices prompt-cache operations as multipliers
of the base input rate:

- **cache read** ≈ 0.1 × input
- **5-minute cache write** ≈ 1.25 × input
- **1-hour cache write** ≈ 2 × input

| Model id            | input | output | cacheRead | cacheWrite5m | cacheWrite1h |
| ------------------- | ----: | -----: | --------: | -----------: | -----------: |
| `claude-opus-4-7`   |    15 |     75 |       1.5 |        18.75 |           30 |
| `claude-opus-4-6`   |    15 |     75 |       1.5 |        18.75 |           30 |
| `claude-opus-4-5`   |     5 |     25 |       0.5 |         6.25 |           10 |
| `claude-sonnet-4-5` |     3 |     15 |       0.3 |         3.75 |            6 |
| `claude-sonnet-4-1` |     3 |     15 |       0.3 |         3.75 |            6 |
| `claude-sonnet-4-0` |     3 |     15 |       0.3 |         3.75 |            6 |
| `claude-haiku-4-5`  |     1 |      5 |       0.1 |         1.25 |            2 |

Notes:

- `claude-opus-4-7` is the model id this dashboard's own sessions run on; it
  is priced at the Opus tier. `claude-opus-4-6` shares that tier.
- The Sonnet 4.x ids and `claude-haiku-4-5` cover the wider Claude 4.x
  family the design (§5.1) names as observed.

## OpenAI — Codex (`gpt-5.x`)

Source: OpenAI API pricing page (`https://openai.com/api/pricing`). Codex CLI
runs report usage with a `cached_input_tokens` term billed at the cached
input rate and a `reasoning_output_tokens` term billed at the output rate
(design §5.2). Codex has **no** cache-write split.

| Model id        | input | output | cacheRead |
| --------------- | ----: | -----: | --------: |
| `gpt-5.5`       |  1.25 |     10 |     0.125 |
| `gpt-5.3-codex` |  1.25 |     10 |     0.125 |
| `gpt-5.1-codex` |  1.25 |     10 |     0.125 |

## Google — Gemini

Source: Google AI / Vertex AI pricing pages
(`https://ai.google.dev/pricing`). The Gemini CLI reports input/output token
usage; Google bills cached context at a reduced rate.

| Model id         | input | output | cacheRead |
| ---------------- | ----: | -----: | --------: |
| `gemini-2.5-pro` |  1.25 |     10 |      0.31 |
| `gemini-3-pro`   |     2 |     12 |       0.2 |

## Unknown / unlisted models

Any model id absent from `model-prices.json` renders **unpriced** on
purpose (design §5.3 / §11.4): the cost calculator returns
`costUsd: null, priced: false`, and the UI shows "n/a" with an explaining
tooltip — never a fabricated `0`. To price a newly-observed model, add a row
above and a corresponding entry to `model-prices.json`.

## Dated-suffix aliases

Vendors sometimes expose a dated model id (e.g. `<model>-20260501`). The
calculator normalizes such ids to their canonical priced id — see
`CANONICAL_MODEL_ALIASES` and the bare `-YYYYMMDD` stripping in
`calculator.ts`. Add an explicit alias entry there when a vendor ships a
dated id that does not strip cleanly.
