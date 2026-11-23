# Swarvo Pixel: firmware brief (read this first)

You are writing the firmware for the Swarvo Pixel (ESP32-S3, Arduino). The server is **already built and deployed**. This brief says exactly what it does, and what is **different from the original "Server Developer Guide"** you may have been given. Where the two disagree, **this brief wins**: it describes the code that is running.

Server code, for reference: `api/product/pixel_ws.py` (the protocol), `api/services/pipecat/pixel_transport.py` (audio in and out), `api/product/pixels.py` (ids and codes). A fake device you can run to compare behaviour: `scripts/pixel_fake_device.py`.

## 0. What changed compared with the original guide

| Topic | Original guide | What the server really does |
|---|---|---|
| WebSocket address | `wss://app.swarvoai.com/ws/device` | **`wss://app.swarvoai.com/api/v1/ws/device`** (port 443). Use this one. The short `/ws/device` is not routed by the proxy yet. |
| `token` in `hello` | a secret token per device | The **activation code** printed on the device's card, e.g. `S7SH-W5QY-Y8XF-SJXW`. There is no separate secret. The same code signs the owner in on the website. Case and dashes do not matter. |
| Reply to `hello` | none | none. A **wrong id or code closes the connection** (close code 1008, reason `bad_credentials`). A switched-off device is closed the same way. |
| Starting a conversation | `touch_start` | same, and **only** `touch_start` starts one. Powering on and `hello` start nothing, cost nothing and create no call. |
| Ending a conversation | `touch_end` on device timeout | `touch_end` ends the conversation **at any time** (also when the visitor ends it). The server then sends `end_session`. |
| Errors | not defined | New server message `{"type":"error","code":"...","message":"..."}` after a `touch_start` that could not start (see section 4). It is always followed by `{"type":"end_session"}`. |
| Mic during the greeting | not defined | The server **ignores the microphone until the agent's greeting has finished** (or about 8 s). Streaming during the greeting is harmless but wasted. |
| Billing | not defined | Conversations are charged per minute from the owner's balance. No balance means `error no_balance`. |

Everything else (audio format, chunk sizes, states, `interrupt`, ping) is as in the original guide and is repeated below so you do not need the old document.

## 1. Constants to put in the firmware

```cpp
const char* SERVER_HOST = "app.swarvoai.com";
const char* SERVER_PATH = "/api/v1/ws/device";    // wss, port 443
const char* DEVICE_ID   = "SWARVO-0001";          // printed on the device, unique per device
const char* ACTIVATION  = "XXXX-XXXX-XXXX-XXXX";  // activation code, unique per device, keep in flash (NVS), never in the repo
const char* FW_VERSION  = "0.4";
```

Each physical device has its own id and code. Make them easy to provision (for example a serial command that writes them to NVS), not compiled into a shared binary.

## 2. Connection rules

1. On power-on and Wi-Fi up, open the WebSocket (TLS). As the **first message, within 10 s**, send:
   ```json
   {"type":"hello","device_id":"SWARVO-0001","token":"XXXX-XXXX-XXXX-XXXX","fw":"0.4"}
   ```
2. That is all that happens at power-on. **Do not send `touch_start` until the pad is touched.**
3. Keep the connection open permanently. Send a WebSocket ping about every 15 s (the server answers with pong; the library does it if you enable heartbeat).
4. If the connection drops, reconnect after about 2 s and send `hello` again. Treat any conversation in progress as ended: set state to idle and clear the speaker queue.
5. One connection per device: a second connection with the same id closes the older one. Do not open two.
6. If the server closes with 1008 right after `hello`: the id or code is wrong (or the device was switched off). Do not hammer: wait at least 30 s before retrying, and show a "check activation" indicator. The server rate-limits repeated bad hellos.

## 3. Messages

### Device to server

| Message | Format | When |
|---|---|---|
| `{"type":"touch_start"}` | text | The pad was touched while idle. Starts a new conversation. |
| `{"type":"interrupt"}` | text | The pad was touched while the device is **thinking or speaking**. The server stops speaking at once and replies `state listening`. Also drop your own queued speech audio. |
| `{"type":"touch_end"}` | text | The conversation should end: the visitor ended it, or 45 s passed with no activity. The server ends the call and sends `end_session`. |
| microphone audio | binary | **Only while the state is `listening`.** Raw PCM, **16 kHz, 16-bit signed, mono, little-endian**, 640 bytes (20 ms) per message. An odd-sized message is dropped. |

Do not send audio in any other state. The server ignores it and never buffers it.

### Server to device

| Message | Format | What to do |
|---|---|---|
| `{"type":"state","value":"listening"}` | text | Show the listening face and start streaming the microphone. |
| `{"type":"state","value":"thinking"}` | text | **Stop sending audio.** Show the thinking animation. (The server found the end of the visitor's sentence.) |
| `{"type":"state","value":"speaking"}` | text | Show the talking face. Also set it yourself when speech audio arrives. |
| `{"type":"state","value":"idle"}` | text | Conversation over. Back to the logo. |
| `{"type":"end_session"}` | text | Same as idle, **and clear any speech audio still queued**. |
| `{"type":"error","code":"...","message":"..."}` | text | A touch could not start. Show the matching indicator (section 4). `end_session` follows. |
| speech audio | binary | Raw PCM, **16 kHz, 16-bit signed, mono**. Each message is at most 4096 bytes and an even number of bytes. Play chunks as they arrive. |

There is **no** state message in reply to `hello`, and the server never sends a message the table does not list. Ignore unknown `type` values.

## 4. Error codes after `touch_start`

| code | Meaning | Suggested indication |
|---|---|---|
| `not_activated` | Nobody has signed in with this device's id and code on the website yet | "Activate me" |
| `no_agent` | The owner has not chosen an agent for this device in the dashboard | "No agent chosen" |
| `no_balance` | The account has no money or minutes left | "Out of balance" |
| `device_off` | The device was switched off by the platform owner | "Switched off" |
| `not_set_up` | Calls are not set up for this account yet | "Not ready" |

After an error the device is idle again. The visitor can touch again later; nothing is retried automatically.

## 5. State machine

```
idle --touch--> send touch_start                         (stay idle until the server answers)
server: state listening     -> LISTENING   (greeting follows; mic is ignored until it finishes)
server: state speaking / speech audio -> SPEAKING  (do not send mic audio)
server: state listening     -> LISTENING   (stream mic, 20 ms packets)
server: state thinking      -> THINKING    (stop sending mic audio)
touch while THINKING or SPEAKING -> send interrupt, clear speaker queue (server then sends state listening)
server: end_session / state idle -> IDLE, clear speaker queue
no activity for 45 s while not idle -> send touch_end
connection lost -> IDLE, clear speaker queue, reconnect in 2 s
```

The server decides when the visitor has finished speaking and when to speak. The device must **not** run any VAD or end-of-speech logic of its own.

## 6. When the server ends a conversation on its own

The server sends `end_session` (then `state idle`) when: the agent says goodbye or hangs up; nobody speaks for about 25 s after the agent finished; nothing at all happens for 60 s; or the conversation reaches **5 minutes**. After `end_session` the device is idle and a new touch starts a fresh conversation.

## 7. Audio notes

- Mic: 16 kHz, 16-bit, mono. Read in a task of its own so Wi-Fi stalls never block the I2S buffer. Send exactly 640-byte packets.
- Speaker: 16 kHz, 16-bit, mono. Keep a small jitter buffer (100 to 200 ms) before starting playback, and clear it on `end_session`, `state idle`, `interrupt` and disconnect.
- No resampling is needed on the server or the device if you use 16 kHz both ways.
- The microphone is muted while the device speaks (half-duplex), so there is no echo to cancel.

## 8. Library hints (arduinoWebSockets, Markus Sattler)

```cpp
ws.beginSSL(SERVER_HOST, 443, SERVER_PATH);
ws.onEvent(onEvent);
ws.setReconnectInterval(2000);
ws.enableHeartbeat(15000, 3000, 2);
```

- On `WStype_CONNECTED`: send `hello` immediately.
- On `WStype_DISCONNECTED`: idle, clear the speaker queue.
- On `WStype_TEXT`: parse with ArduinoJson, switch on `type`.
- On `WStype_BIN`: if the length is even and greater than 0, queue it for the speaker.
- For production, pin the root certificate for `app.swarvoai.com` (`beginSslWithCA`) instead of skipping verification.

## 9. How to test

1. **Without hardware:** `python3 scripts/pixel_fake_device.py --device SWARVO-0001 --code XXXX-XXXX-XXXX-XXXX [--wav 16k_mono.wav]`. It behaves like the device (touch, mic only while listening, stop on thinking) and saves the agent's speech to `reply.wav`. Compare your device's message sequence with its output.
2. **Expected sequence on a good touch:** `state listening` (about 0.5 s after `touch_start`), then `state speaking` with greeting audio, then `state listening`, then (after the visitor speaks) `state thinking`, `state speaking` with the answer, `state listening`.
3. **Checks the firmware should pass:**
   - Power on: `hello` is sent, **nothing else**, no touch, no audio.
   - Wrong code: connection closes (1008); the device waits 30 s before retrying.
   - Pull the Wi-Fi mid-conversation: the device goes idle and reconnects within seconds.
   - Touch while speaking: `interrupt`, speech stops, `state listening` comes back.
   - `touch_end` ends the conversation and the server answers `end_session`.
   - Odd-sized or oversized audio is never sent or played.
4. The owner can see every conversation (transcript, summary, minutes) in the website's Conversations page, and the device's online status and minutes on the **Devices** page. Sign in on the website with the device id and activation code.

## 10. Things the server does not do (do not wait for them)

- It does not speak a message for errors such as `no_balance`; the device shows the indication itself.
- It does not check the firmware version; `fw` is only shown in the dashboard.
- It does not send a reply to `hello`.
- Time to the first word of the greeting and time to the first word of an answer depend on the AI model; mid-conversation delays of several seconds can happen if the microphone streams loud background noise, because the server keeps waiting for the visitor to finish. Keep the microphone gain sensible and consider a noise gate on the device.

Questions about the protocol: the server's source is the reference. If the firmware needs a protocol change (different audio format, Opus, a binary header), ask the platform owner first, because the server and the firmware must change together.
