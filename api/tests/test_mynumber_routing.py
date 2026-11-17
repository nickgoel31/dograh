from api.product.mynumber_router import forwarded_from


def test_diversion_header():
    assert forwarded_from({"Diversion": "<sip:+919876543210@jio.in>;reason=user-busy"}) == "+919876543210"


def test_history_info_without_plus():
    assert forwarded_from({"History-Info": "<sip:919876543210@x.in?Reason=SIP;cause=486>;index=1"}) == "+919876543210"


def test_tel_uri_and_case_insensitive():
    assert forwarded_from({"diversion": "<tel:+911234567890>"}) == "+911234567890"


def test_absent():
    assert forwarded_from({"From": "<sip:+911111111111@x>"}) is None


def test_prefixed_provider_header_is_found():
    assert forwarded_from({"SIP-H-Diversion": "<sip:+919876543210@jio.in>;reason=user-busy"}) == "+919876543210"
    assert forwarded_from({"X-PH-History-Info": "<sip:919876543210@x.in>;index=1"}) == "+919876543210"


def test_default_pool_number(monkeypatch):
    from api.product.mynumber_router import forward_pool_number

    monkeypatch.delenv("PRODUCT_MYNUMBER_POOL_NUMBER", raising=False)
    assert forward_pool_number() == "+918065493136"
    monkeypatch.setenv("PRODUCT_MYNUMBER_POOL_NUMBER", "+910000000000")
    assert forward_pool_number() == "+910000000000"
