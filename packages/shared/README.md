# @openpi/shared

Desktop-to-daemon wire protocol and the types both sides share.

## Principles

- **One connection, fully multiplexed.** A single long-lived Unix-socket
  connection carries every request (correlated by `id`) and every event (no id).
  The old OpenPI ran two parallel schemes - a short-connection request/response
  path plus a separate long-lived `rpc_stream` socket that bypassed its own
  client wrapper. This caused connection handling to live in two places and
  drift apart. Here there is one.
- **Session commands stay opaque.** A `rpc` request's `command` is forwarded
  verbatim to `pi --mode rpc`, so anything upstream's RPC protocol supports is
  automatically supported here, with no new wire types as upstream grows.
- **Auth is the socket file's permissions** (`0600`). No token in the wire
  protocol; the portability concern is only matching the socket's owner.

## Layout

`ClientRequest` - everything the desktop can ask for.
`ServerMessage` - responses (`response`) and pushed session events (`event`).
`encodeMessage` / `decodeLines` - newline-delimited JSON framing.

Import from `@openpi/shared` only as types in the desktop app; the daemon is the
only package that instantiates the transport.
