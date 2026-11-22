# Swarvo Pixel: what the Arduino code needs

The server side is built. The device is a thin client: it streams microphone audio to the server and plays back what the server sends. The AI (listening, thinking, voice, knowledge, tools) runs on the platform, the same pipeline that runs phone and browser calls.

## 1. The three things to put in the firmware

```cpp
const char* SERVER_HOST = "app.swarvoai.com";
const char* SERVER_PATH = "/api/v1/ws/device";   // wss on port 443
const char* DEVICE_ID   = "SWARVO-0001";         // printed on the device
const char* ACTIVATION  = "K7QM-4XPD-9TRW-2NHV"; // the activation code printed on the card
```

- Use **`/api/v1/ws/device`**. It goes through the proxy rules that already exist. (`/ws/device` also exists on the API, but the proxy only forwards it once an nginx rule for it is added, so do not use it yet.)
- The **activation code is the device's secret**. The same code is typed on the website to sign in. Keep it in flash, never in the repository. If a code leaks, ask for a new one: the old one stops working at once, on the website and on the device.
- One connection per device. If a second connection says hello with the same id, the older one is closed.

## 2. Connecting

Open `wss://app.swarvoai.com/api/v1/ws/device` (TLS, port 443), then send as the **first message** (within 10 seconds):

```json
{"type":"hello","device_id":"SWARVO-0001","token":"K7QM-4XPD-9TRW-2NHV","fw":"0.1"}
```

- `token` is the activation code. Dashes and upper or lower case do not matter.
- There is **no reply to a good hello**. A bad id or code closes the connection (close code 1008, reason `bad_credentials`). A device that is switched off is closed the same way.
- Keep the connection open for good. If it drops, reconnect after 2 seconds and send hello again. Send a WebSocket ping about every 15 seconds.

## 3. Messages

### Device to server

| What | Format | When |
|---|---|---|
| `{"type":"touch_start"}` | text | The pad was touched: a new conversation starts |
| `{"type":"interrupt"}` | text | Touched while the device was thinking or speaking: the server stops speaking at once |
| `{"type":"touch_end"}` | text | The device gives up (45 s without activity), or the visitor ends it |
| microphone audio | binary | **Only while the state is `listening`** |

Microphone audio is raw PCM, **16 kHz, 16-bit signed, mono, little-endian**, 640 bytes (20 ms) per message. An odd-sized message is dropped.

### Server to device

| What | Format | Meaning |
|---|---|---|
| `{"type":"state","value":"listening"}` | text | Show the listening face and stream the microphone |
| `{"type":"state","value":"thinking"}` | text | Stop sending audio, show the thinking animation |
| `{"type":"state","value":"speaking"}` | text | Talking face (also set when audio arrives) |
| `{"type":"state","value":"idle"}` | text | Conversation over, back to the logo |
| `{"type":"end_session"}` | text | Same as idle, and **clear any audio still queued** |
| `{"type":"error","code":"...","message":"..."}` | text | The touch could not start a conversation (see below). `end_session` follows |
| speech audio | binary | PCM, **16 kHz, 16-bit signed, mono**, at most 4096 bytes per message, always an even number of bytes |

Error codes you may get after `touch_start`:

| code | What to show |
|---|---|
| `not_activated` | "Activate me": nobody has signed in with this device's id and code on the website yet |
| `no_agent` | "No agent chosen": the owner has not picked an agent for this device in the dashboard |
| `no_balance` | "Out of balance": the account has no minutes or money left |
| `device_off` | "Switched off" |
| `not_set_up` | "Not ready yet" |

## 4. The conversation, step by step

1. Touch: send `touch_start`.
2. Server sends `state listening`, then the agent says its greeting (`state speaking`, speech audio, then `state listening`). **The microphone is ignored until the greeting is finished** (or about 8 seconds), so noise does not cut the greeting off.
3. While `listening`, stream 20 ms microphone packets.
4. The server finds the end of speech itself and sends `state thinking`. **Stop sending audio** and show the thinking animation. The microphone is muted while the device speaks, so there is no echo.
5. Speech audio arrives. Play each chunk as it comes. When the agent has finished, the server sends `state listening` again.
6. The conversation ends by itself when: the agent says goodbye, nobody speaks for about 25 seconds after the agent finished, or it has run **5 minutes**. The server sends `end_session`.
7. If the visitor touches while the device is thinking or speaking, send `interrupt`. The server stops and answers `state listening`. Drop any speech audio you still have queued.

Audio that arrives at the server while it is not in `listening` is ignored, never queued.

## 5. Arduino skeleton (ESP32-S3, arduinoWebSockets)

```cpp
#include <WiFi.h>
#include <WebSocketsClient.h>   // "WebSockets" by Markus Sattler
#include <ArduinoJson.h>

WebSocketsClient ws;
enum State { IDLE, LISTENING, THINKING, SPEAKING } state = IDLE;
bool connected = false;

void onEvent(WStype_t type, uint8_t* payload, size_t len) {
  switch (type) {
    case WStype_CONNECTED: {
      connected = true;
      char hello[160];
      snprintf(hello, sizeof(hello), "{\"type\":\"hello\",\"device_id\":\"%s\",\"token\":\"%s\",\"fw\":\"0.1\"}", DEVICE_ID, ACTIVATION);
      ws.sendTXT(hello);
      break;
    }
    case WStype_DISCONNECTED:
      connected = false; state = IDLE; clearSpeakerQueue(); break;          // the library reconnects (setReconnectInterval)
    case WStype_TEXT: {
      JsonDocument d; if (deserializeJson(d, payload, len)) break;
      const char* t = d["type"] | "";
      if (!strcmp(t, "state")) {
        const char* v = d["value"] | "";
        if (!strcmp(v, "listening")) state = LISTENING;
        else if (!strcmp(v, "thinking")) state = THINKING;
        else if (!strcmp(v, "speaking")) state = SPEAKING;
        else if (!strcmp(v, "idle")) { state = IDLE; clearSpeakerQueue(); }
        showFace(state);
      } else if (!strcmp(t, "end_session")) { state = IDLE; clearSpeakerQueue(); showFace(state); }
      else if (!strcmp(t, "error")) { showError(d["code"] | ""); }
      break;
    }
    case WStype_BIN:
      if (len > 0 && len % 2 == 0) { state = SPEAKING; playPcm16k(payload, len); }   // 16 kHz 16-bit mono
      break;
    default: break;
  }
}

void setup() {
  // ... Wi-Fi, I2S mic (16 kHz, 16-bit, mono), I2S speaker (16 kHz) ...
  ws.beginSSL(SERVER_HOST, 443, SERVER_PATH);
  ws.onEvent(onEvent);
  ws.setReconnectInterval(2000);
  ws.enableHeartbeat(15000, 3000, 2);   // ping every 15 s
}

void loop() {
  ws.loop();
  if (touchStarted() && connected) {
    if (state == THINKING || state == SPEAKING) { ws.sendTXT("{\"type\":\"interrupt\"}"); clearSpeakerQueue(); }
    else if (state == IDLE) ws.sendTXT("{\"type\":\"touch_start\"}");
  }
  if (state == LISTENING && connected) {
    static int16_t pcm[320];               // 20 ms at 16 kHz
    if (readMic(pcm, 320)) ws.sendBIN((uint8_t*)pcm, 640);
  }
  if (inactiveFor(45000) && state != IDLE) { ws.sendTXT("{\"type\":\"touch_end\"}"); }
}
```

Notes:

- TLS: `beginSSL` with no certificate may skip verification. For production pin the root certificate for `app.swarvoai.com` (`ws.beginSslWithCA(...)`).
- Do the microphone read in a task of its own, so Wi-Fi hiccups never block the I2S buffer.
- Keep a small jitter buffer (100 to 200 ms) before starting playback.
- The server does not check the firmware version; `fw` is only shown in the dashboard.

## 6. The account and the dashboard (what the owner sees)

- Every device has a printed **device id** and **activation code**. Nothing else is needed on the device.
- On the website sign-in page there is **Sign in with your device**. Type the id and code. The first time, this creates the device's own account (a normal workspace). After that it signs into the same account.
- In that account: **Devices** shows if it is online, when it was last seen, minutes used today and in total, and the recent conversations. The owner picks **which agent the device talks to** there. The agent's voice, languages, personality, knowledge, tools and call settings are changed on the agent's own pages, and billing is on the Billing page. The device uses the latest version at its next touch.
- Calls from a device are charged from the account's balance at the same per-minute price as a practice call (a Koyal voice gets its discount too). Each conversation also appears under Conversations with its transcript and summary.

## 7. For the platform owner

- Make devices: **Admin > Swarvo Pixel devices > Make devices**. The codes are shown once: download the CSV and print them on the cards.
- A device can be **switched off** (it is disconnected within about 20 seconds and cannot sign in) or given a **new code** (the old one dies at once).
- Limits (environment variables on the API): `PRODUCT_PIXEL_MAX_SECONDS` (conversation cap, default 300), `PRODUCT_PIXEL_IDLE_SECONDS` (nobody speaks after the greeting, default 25), `PRODUCT_PIXEL_SILENT_SECONDS` (default 60).

## 8. Test without the hardware

```bash
pip install websockets
python scripts/pixel_fake_device.py --device SWARVO-0001 --code K7QM-4XPD-9TRW-2NHV --wav hello_16k_mono.wav --out reply.wav
```

It acts like the device (touch, stream the WAV only while listening, stop on thinking) and saves what the agent says to `reply.wav`.
