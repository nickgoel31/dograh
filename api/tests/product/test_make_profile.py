from api.product.make_profile import GOOGLE_REALTIME, INWORLD_REALTIME, build_config

BASE = {"llm": {"provider": "openai", "api_key": "k", "model": "gpt-4.1"}, "embeddings": None, "other": 1}


def test_inworld_profile_has_the_chosen_models_and_a_key():
    cfg = build_config(INWORLD_REALTIME, "SECRET", BASE)
    rt = cfg["realtime"]
    assert cfg["is_realtime"] is True and rt["api_key"] == "SECRET"
    assert rt["stt_model"] == "assemblyai/universal-3-5-pro" and rt["tts_model"] == "inworld-tts-2" and rt["voice"] == "Seema"
    assert rt["model"] == "google-ai-studio/gemini-3.1-flash-lite" and cfg["llm"]["model"] == "gpt-4.1" and "other" not in cfg


def test_google_profile_can_be_made_without_a_key():
    cfg = build_config(GOOGLE_REALTIME, "", BASE)
    assert cfg["realtime"]["provider"] == "google_realtime" and cfg["realtime"]["api_key"] == ""
