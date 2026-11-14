"""Murf Falcon 2.1 text-to-speech: models, regions, locales and the voices that speak Indian languages.

Source: murf.ai/api/docs (Falcon 2.1 voice library). Voice ids are the plain names. A voice can speak several of its listed locales.
"""

MURF_TTS_MODELS = ["falcon-2.1"]

# Regional hosts of the streaming API. "global" routes to the nearest region. Murf's default limit is 5 speaking-at-once on us-east
# and 2 on every other region (including in); ask Murf to raise it before running many calls at the same time.
MURF_REGIONS = ["in", "global", "us-east", "us-west", "eu-central", "uk", "me", "jp", "kr", "au", "ca", "sa-east"]
MURF_SAMPLE_RATES = (8000, 24000, 44100, 48000)

# Voice -> locales it can speak (Indian ones). The first is its main language.
MURF_INDIAN_VOICES: dict[str, tuple[str, ...]] = {
    "Aarav": ("hi-IN", "en-IN"),
    "Abhik": ("hi-IN",),
    "Abhinav": ("hi-IN", "en-IN", "ml-IN", "mr-IN"),
    "Abirami": ("hi-IN", "te-IN"),
    "Alia": ("hi-IN", "te-IN"),
    "Aman": ("hi-IN",),
    "Anisha": ("hi-IN", "en-IN", "as-IN", "bn-IN", "mr-IN", "or-IN", "pa-IN", "ta-IN", "te-IN"),
    "Anusha": ("hi-IN", "en-IN", "te-IN"),
    "Arnab": ("hi-IN",),
    "Arohi": ("hi-IN",),
    "Ayushi": ("hi-IN", "gu-IN", "te-IN"),
    "Debarati": ("bn-IN",),
    "Diya": ("gu-IN", "ml-IN", "mr-IN"),
    "Eashwar": ("hi-IN",),
    "Hardik": ("en-IN", "gu-IN", "te-IN"),
    "Harman": ("pa-IN", "kn-IN"),
    "Harpreet": ("pa-IN", "mr-IN"),
    "Harshitha": ("kn-IN",),
    "Isha": ("hi-IN",),
    "Ishani": ("hi-IN",),
    "Karan": ("hi-IN",),
    "Karthikeyan": ("hi-IN", "gu-IN", "ml-IN", "ta-IN"),
    "Khyati": ("hi-IN",),
    "Madhavan": ("hi-IN", "ml-IN"),
    "Namrita": ("hi-IN", "kn-IN"),
    "Nikhil": ("hi-IN", "en-IN", "kn-IN"),
    "Nimisha": ("en-IN", "ml-IN"),
    "Pooja": ("hi-IN", "en-IN", "kn-IN", "ta-IN", "te-IN"),
    "Prajakta": ("mr-IN", "te-IN"),
    "Prathamesh": ("en-IN", "gu-IN", "mr-IN", "ta-IN", "te-IN"),
    "Priya": ("hi-IN", "en-IN"),
    "Samar": ("hi-IN", "en-IN", "as-IN", "kn-IN", "mr-IN", "or-IN", "ta-IN", "te-IN"),
    "Sarvesh": ("hi-IN", "kn-IN"),
    "Shweta": ("hi-IN",),
    "Subhankar": ("bn-IN", "mr-IN"),
    "Sunaina": ("hi-IN",),
    "Vaibhav": ("hi-IN", "mr-IN"),
}
MURF_TTS_VOICES = list(MURF_INDIAN_VOICES)

# Murf's docs do not publish a voice's gender; its voice list API does (the app uses that when MURF_API_KEY is set, and it wins over this table).
# Priya and Shweta are confirmed on murf.ai's own voice pages (both Female). The rest are the usual gender of each Indian first name. Harman and
# Harpreet are used by everyone, so they are left empty rather than guessed.
MURF_GENDER = {
    "Priya": "Female", "Shweta": "Female",
    "Abirami": "Female", "Alia": "Female", "Anisha": "Female", "Anusha": "Female", "Arohi": "Female", "Ayushi": "Female", "Debarati": "Female", "Diya": "Female",
    "Harshitha": "Female", "Isha": "Female", "Ishani": "Female", "Khyati": "Female", "Namrita": "Female", "Nimisha": "Female", "Pooja": "Female", "Prajakta": "Female", "Sunaina": "Female",
    "Aarav": "Male", "Abhik": "Male", "Abhinav": "Male", "Aman": "Male", "Arnab": "Male", "Eashwar": "Male", "Hardik": "Male", "Karan": "Male", "Karthikeyan": "Male",
    "Madhavan": "Male", "Nikhil": "Male", "Prathamesh": "Male", "Samar": "Male", "Sarvesh": "Male", "Subhankar": "Male", "Vaibhav": "Male",
}
MURF_TTS_LOCALES = ["hi-IN", "en-IN", "bn-IN", "gu-IN", "kn-IN", "ml-IN", "mr-IN", "pa-IN", "ta-IN", "te-IN", "or-IN", "as-IN", "hi-LATN"]

# Locale -> the language name the product shows.
MURF_LOCALE_LANGUAGE = {
    "hi-IN": "Hindi", "en-IN": "English (India)", "bn-IN": "Bengali", "gu-IN": "Gujarati", "kn-IN": "Kannada", "ml-IN": "Malayalam",
    "mr-IN": "Marathi", "pa-IN": "Punjabi", "ta-IN": "Tamil", "te-IN": "Telugu", "or-IN": "Odia", "as-IN": "Assamese",
}
