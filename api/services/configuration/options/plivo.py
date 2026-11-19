"""Plivo Koyal text-to-speech: model, languages and the voices.

Source: plivo.com/docs/models/text-to-speech (voices page). Each voice speaks exactly one language. Voice ids are Plivo's own opaque ids.
"""

PLIVO_TTS_MODELS = ["koyal"]
PLIVO_SAMPLE_RATES = (8000, 16000, 24000)  # PCM rates Plivo offers; any other rate is converted from 24 kHz

# Language code -> the name the product uses for it.
PLIVO_LANGUAGES = {
    "en-US": "English", "en-GB": "English", "en-IN": "English", "en-AU": "English",
    "hi": "Hindi", "bn": "Bengali", "ta": "Tamil", "te": "Telugu", "mr": "Marathi", "gu": "Gujarati", "kn": "Kannada",
}
PLIVO_TTS_LOCALES = list(PLIVO_LANGUAGES)

# (name, voice_id, gender, language code)
PLIVO_VOICES: list[tuple[str, str, str, str]] = [
    ("Allison", "GhXTeeZNT1zacg9RUbXa", "Female", "en-US"), ("Hailey", "lC7qzMoRE7SSjaNCVeff", "Female", "en-US"),
    ("Garrett", "P2WNP5RVUP1t6dK9PY52", "Male", "en-US"), ("Terrell", "ieA6hQ563LgXTiOgy6kz", "Male", "en-US"), ("Travis", "Ak70ycoSdDYbeq5sAXsc", "Male", "en-US"),
    ("Eleanor", "Ic0DJ4TLN1ELIYmzwi6H", "Female", "en-GB"), ("Poppy", "0isEP1KMeZPsGSP5qj2A", "Female", "en-GB"), ("Archie", "zYmyWxqLSdlQ0MA4AQEV", "Male", "en-GB"),
    ("Nisha", "H25SvwivznBqsIx1R7hX", "Female", "en-IN"), ("Prerna", "3gVUACYdS3ibtu8qPruB", "Female", "en-IN"),
    ("Aarav", "vGOW5Fzss7kzS9IxCObo", "Male", "en-IN"), ("Karan", "34AUgJTl9p1TLO99Mc7E", "Male", "en-IN"),
    ("Tahlia", "S4OkXYkfzKK9f6wzmQ0X", "Female", "en-AU"),
    ("Meera", "6uWzc4xFj31t4jNJUaED", "Female", "hi"), ("Ritika", "Hiqcy02wuf8a4sCMcdNO", "Female", "hi"),
    ("Aman", "OmziUEKO4d83QuGMo3bP", "Male", "hi"), ("Ishaan", "nzWUWk5ShuIYGSosxESk", "Male", "hi"),
    ("Debasmita", "cZncSKHriH32h4IKwAF1", "Female", "bn"), ("Ishani", "GKrPm1RIxbJRv4yYqAxX", "Female", "bn"), ("Subhankar", "vxMrWeHTjRflUziEla6E", "Male", "bn"),
    ("Nandhini", "wDPugzmr5HSlFv9MaXk0", "Female", "ta"), ("Kathir", "4YwYWODqig98puWmLYRz", "Male", "ta"),
    ("Abhiram", "v2jq1LG20JPbAVrlTWmZ", "Male", "te"), ("Pavan", "cXEjlQTYG6DCOlWVjGe9", "Male", "te"),
    ("Sanika", "KCWPtNGDMOQ5bI9SiaIm", "Female", "mr"), ("Shravani", "WqKlYdzJonf6PWElzV6a", "Female", "mr"),
    ("Akshay", "KYAauPOeeH6Xkcy9YBA7", "Male", "mr"), ("Mandar", "nBMKcKglpeBGawQWLrOa", "Male", "mr"),
    ("Hiren", "xHCIssLpg7mFHuxJAl5D", "Male", "gu"), ("Nirav", "9ZCJ1Lca7nXQprCrubMG", "Male", "gu"),
    ("Bhavana", "iNhbJlZPe4LFctxRtJPD", "Female", "kn"), ("Spoorthi", "Ba1rbMwhlf3aXyxKB99Q", "Female", "kn"), ("Pradeep", "JlZpUKXSnAs3C1qmfJR8", "Male", "kn"),
]
PLIVO_TTS_VOICES = [v[1] for v in PLIVO_VOICES]
