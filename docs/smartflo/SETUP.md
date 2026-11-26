# Tata Smartflo with Swarvo

Connect a Tata Smartflo number to a Swarvo AI voice agent. Smartflo streams the call audio to us over a WebSocket ("Voice Streaming" / "Voice Bot"); the agent talks back over the same stream.

## What you need from Smartflo
1. An account with at least one number (DID).
2. **Voice Streaming switched on.** Ask Tata support if Settings > Channels > Voice Bot is missing.
3. Your **Account API Token**: API Connect in the Smartflo dashboard.
4. For outgoing calls only, a **Click to Call Support API Key**: API Connect > Click to Call Support API.
5. For call details and recordings (optional): Tata support must enable **Webhooks** for the account.

## In Swarvo
Phone Numbers > Bring your own number > **Tata Smartflo**. Enter the number, the Account API Token and, if the agent should call out, the Click to Call API Key. Swarvo checks the token and shows two addresses (they contain a secret key for your account; keep them private). More numbers on the same account reuse the same addresses.

## In Smartflo
1. **Endpoint:** Settings > Channels > Voice Bot > Add an Endpoint. Choose **Dynamic**, method **POST**, and paste the *Endpoint address*. (Swarvo answers within 2 seconds with a signed `wss://` address for each call; a static endpoint cannot be used, because every call needs its own address.)
2. **Incoming calls:** My Numbers > your number > Configure Destination > that Voice Bot endpoint > Save. Then choose the agent for the number on Swarvo's Phone Numbers page.
3. **Outgoing calls:** edit the Click to Call Support API key: select the number, set the destination to that Voice Bot endpoint, and put the key in Swarvo. Swarvo starts calls through that API; Smartflo rings the customer first, then connects the stream, so the agent speaks after the customer answers.
4. **Call details and recordings (optional):** API Connect > Webhook > Add Webhook. Use the *Webhook address*, method POST, a Call hangup trigger, and your number.

## Behaviour
- Audio is 8 kHz μ-law. The agent is cut off cleanly when the caller interrupts.
- When the agent ends the call, Swarvo hangs up through Smartflo's REST API.
- **Transfer to a person** uses Smartflo's Call Operations (Transfer) to the number set on the agent's transfer tool.
- Opening hours, paused agents, balance and call limits apply as for any number. A refused call is declined, so Smartflo hangs up.
- Phone menus (Swarvo IVR) run on Plivo numbers. Build a menu inside Smartflo if you need one on a Smartflo number.

## Not confirmed against a live Smartflo account
Smartflo's published docs are inconsistent in places, so these were built to the docs and not yet tried on real calls: the `Authorization` header form (Bearer first, bare token as a fallback), which call identifier Smartflo accepts for hangup and transfer (all known ones are tried in turn), the number format Smartflo wants for a transfer destination (digits with country code, no +), and the exact field names in webhooks (names with or without a leading `$` are both read).
