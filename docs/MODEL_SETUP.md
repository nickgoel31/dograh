# Model setup (operator guide)

Customers never choose or see AI providers. You, the operator, create a few **model profiles** (bundles of LLM / voice / speech-to-text settings with your provider keys) and tell the product which profile each "Brain" preset uses.

## How it fits together
- Every workspace has two organizations (test + live). Both are pointed at the **default profile** automatically when the workspace is created, and repaired on first use if a workspace pre-dates your setup.
- An agent's **Brain** (Fast / Balanced / Smartest) picks another profile's LLM. A chosen **voice** swaps the voice (and language, where the voice has one) on the default profile's TTS. Both are stored as per-agent overrides copied from your profiles; keys are never returned to the browser.
- Calls are checked against the organization's wallet only. The platform's managed-service credit check runs **only when a profile uses the platform's own managed provider**, so use your own provider keys (below).
- If no default profile exists, the agent's readiness shows "Calls are set up for your workspace" as a blocker, "Go live" is refused, and test calls close with a friendly "calling isn't enabled" message.

## Steps
1. **Create profiles** with the existing superuser API (as a superuser), one per tier. Example body for `POST /api/v1/superuser/model-profiles`:
   ```json
   {
     "slug": "std",
     "display_name": "Standard",
     "config": {
       "llm": { "provider": "openai", "api_key": "<key>", "model": "gpt-4.1" },
       "tts": { "provider": "sarvam", "api_key": "<key>", "model": "bulbul:v4-flash",
                "voice": "shubh_enhi_ads", "language": "hi-IN" },
       "stt": { "provider": "deepgram", "api_key": "<key>", "model": "nova-3", "language": "multi" }
     }
   }
   ```
   Make a cheaper and a stronger profile the same way (only `llm` is needed in those; their TTS/STT are ignored).
2. **Map presets to slugs** with an environment variable on the API:
   ```
   PRODUCT_PROFILES={"default":"std","fast":"std-lite","balanced":"std","smartest":"std-pro"}
   ```
3. **Voices**: the voice list comes from the Sarvam `bulbul:v4-flash` personas, so the default profile's TTS must be `sarvam`. A voice whose provider differs from the default profile's TTS is saved but not applied.
4. In local development also set `PRODUCT_COOKIE_SECURE=false` and `PRODUCT_ALLOWED_ORIGINS=http://localhost:5174`.

## Verified vs not
- Verified by running: the profile body above passes the platform's own validator (`normalize_config`); the override shapes merge correctly with `resolve_effective_config`; all 222 catalogue voices validate; mapping, repair, blocker and key-hiding behaviour (42 tests, in-memory database).
- Verified by reading code only: that the runtime applies the organization's profile (`get_user_configurations(user, organization_id=workflow.organization_id)` in the pipeline start), that per-version `model_overrides` are read from the run's bound version, and that the wallet check passes for organizations with the wallet disabled.
- **Not verified**: an actual call, against a real database, with real provider keys.
