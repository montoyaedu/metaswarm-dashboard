#!/usr/bin/env python3
"""Redact real Codex rollouts down to the records v5-3's reader parses.

PROVENANCE
  Source: the two real rollouts on this machine —
    ~/.codex/sessions/2026/05/11/rollout-2026-05-11T15-23-36-...jsonl  (SRC_A)
    ~/.codex/sessions/2026/05/11/rollout-2026-05-11T15-23-56-...jsonl  (SRC_B)
  SRC_A: session_meta + turn_context(model=gpt-5.5) + a token_count with
         info:null + a token_count with a real non-null info.
  SRC_B: session_meta + turn_context(model=gpt-5.5-codex), NO token_count.

ALLOW-LIST  The reader parses ONLY:
  - session_meta.payload.cwd  + the record `timestamp`
  - turn_context.payload.model
  - event_msg/token_count -> payload.info.total_token_usage
Every other record type (response_item, agent_message, user_message,
task_started, task_complete) carries Codex prompt/response text and is DROPPED
ENTIRELY by the redaction below. Within kept records, only the allow-listed
fields survive — git, base_instructions, ids, originator, rate_limits, sandbox
policy, writable_roots, model_context_window, last_token_usage are all
stripped. The real `cwd` is rewritten to a synthetic placeholder so no real
filesystem path is committed.

The "last turn_context / last non-null token_count wins" semantics need
multi-turn structure the single real runs do not have, so the costed fixture
COMPOSES real redacted records (a second turn_context and a second token_count
are copies of real records with the model id / token figures varied). Every
record is still a structurally-real Codex record — no field is invented.
"""
import json
import os

SRC_A = os.path.expanduser(
    "~/.codex/sessions/2026/05/11/"
    "rollout-2026-05-11T15-23-36-019e1735-18f7-7482-891c-6f02a324d6e4.jsonl"
)
SRC_B = os.path.expanduser(
    "~/.codex/sessions/2026/05/11/"
    "rollout-2026-05-11T15-23-56-019e1735-6760-7a83-b579-8f4b216b3b00.jsonl"
)
DST = (
    "/Users/montoyaedu/ethiclab/metaswarm-dashboard/packages/sessions/"
    "src/cost/__tests__/fixtures/codex-sessions/2026/05"
)

CWD_ATTRIBUTED = "/work/sample-repo"
CWD_UNATTRIBUTED = "/somewhere/else/unconfigured"


def redact_record(rec):
    """Keep only allow-listed records; strip to allow-listed fields."""
    t = rec.get("type")
    payload = rec.get("payload") if isinstance(rec.get("payload"), dict) else {}
    ts = rec.get("timestamp")
    ptype = payload.get("type")

    if t == "session_meta":
        return {"timestamp": ts, "type": "session_meta",
                "payload": {"cwd": CWD_ATTRIBUTED}}
    if t == "turn_context":
        return {"timestamp": ts, "type": "turn_context",
                "payload": {"model": payload.get("model")}}
    if t == "event_msg" and ptype == "token_count":
        info = payload.get("info")
        if info is None:
            return {"timestamp": ts, "type": "event_msg",
                    "payload": {"type": "token_count", "info": None}}
        return {"timestamp": ts, "type": "event_msg",
                "payload": {"type": "token_count", "info": {
                    "total_token_usage": info.get("total_token_usage")}}}
    return None


def redact_file(src):
    out = []
    with open(src) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            rec = redact_record(json.loads(line))
            if rec is not None:
                out.append(rec)
    return out


def set_cwd(records, cwd):
    for r in records:
        if r["type"] == "session_meta":
            r["payload"]["cwd"] = cwd
    return records


def write(path, records):
    with open(path, "w") as fh:
        for r in records:
            fh.write(json.dumps(r, separators=(",", ":")) + "\n")
    print(f"wrote {path} ({len(records)} records)")


a = redact_file(SRC_A)   # meta, turn_context(gpt-5.5), tc(info:null), tc(info)
b = redact_file(SRC_B)   # meta, turn_context(gpt-5.5-codex)

# --- Fixture 1: a full, costed, multi-turn rollout (attributed) -----------
# Composed from SRC_A's real records. We append a SECOND turn_context (a real
# turn_context record, model varied to the priced `gpt-5.5`) and a SECOND
# non-null token_count (a real token_count record with varied figures) so the
# reader's "last turn_context wins" / "last non-null token_count wins" rules
# are genuinely exercised. The FINAL turn_context model is `gpt-5.5` (priced);
# the FINAL non-null token_count carries the figures the test asserts on.
turn_ctx = next(r for r in a if r["type"] == "turn_context")
tc_nonnull = next(
    r for r in a
    if r["type"] == "event_msg" and r["payload"]["info"] is not None
)
tc_null = next(
    r for r in a
    if r["type"] == "event_msg" and r["payload"]["info"] is None
)
meta = next(r for r in a if r["type"] == "session_meta")

# An EARLIER turn_context whose model must be ignored (last wins).
turn_early = {
    "timestamp": "2026-05-11T13:23:43.000Z",
    "type": "turn_context",
    "payload": {"model": "gpt-5.5-codex"},
}
# An EARLIER non-null token_count whose figures must be ignored (last wins).
tc_early = {
    "timestamp": "2026-05-11T13:23:44.000Z",
    "type": "event_msg",
    "payload": {"type": "token_count", "info": {
        "total_token_usage": {
            "input_tokens": 100, "cached_input_tokens": 10,
            "output_tokens": 1, "reasoning_output_tokens": 0,
            "total_tokens": 111}}},
}
# The FINAL turn_context model = gpt-5.5 (priced). FINAL non-null token_count
# carries known figures the test asserts on.
turn_final = {
    "timestamp": "2026-05-11T13:23:45.000Z",
    "type": "turn_context",
    "payload": {"model": "gpt-5.5"},
}
tc_final = {
    "timestamp": "2026-05-11T13:23:46.278Z",
    "type": "event_msg",
    "payload": {"type": "token_count", "info": {
        "total_token_usage": {
            "input_tokens": 20000, "cached_input_tokens": 15000,
            "output_tokens": 800, "reasoning_output_tokens": 200,
            "total_tokens": 36000}}},
}
costed = [
    dict(meta),
    turn_early,
    tc_null,        # info:null is skipped
    tc_early,       # earlier non-null -> superseded
    turn_final,
    tc_final,       # last non-null -> THIS one is used
]
write(os.path.join(DST, "11", "rollout-costed-multiturn.jsonl"),
      set_cwd([dict(r) for r in costed], CWD_ATTRIBUTED))

# --- Fixture 2: the mandated info-null-ONLY rollout -> costUsd: null ------
# SRC_B (meta + turn_context, no token_count) plus a single info:null
# token_count. It HAS a token_count record but ZERO non-null-info ones.
info_null_only = [dict(r) for r in b] + [dict(tc_null)]
write(os.path.join(DST, "11", "rollout-info-null-only.jsonl"),
      set_cwd(info_null_only, CWD_ATTRIBUTED))

# --- Fixture 3: abnormal-but-costed, UNATTRIBUTED cwd ---------------------
# SRC_A's real records, but ending right after a non-null token_count with no
# clean terminator (task_complete is already dropped by redaction). cwd is set
# under no configured project -> projectName: null.
abnormal = [
    dict(meta),
    dict(turn_ctx),       # model gpt-5.5
    dict(tc_null),
    dict(tc_nonnull),     # the run's usage; no terminating record follows
]
write(os.path.join(DST, "12", "rollout-abnormal-costed-unattributed.jsonl"),
      set_cwd(abnormal, CWD_UNATTRIBUTED))
