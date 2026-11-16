from api.product.mynumber_router import forwarded_from


def test_diversion_header():
    assert forwarded_from({"Diversion": "<sip:+919876543210@jio.in>;reason=user-busy"}) == "+919876543210"


def test_history_info_without_plus():
    assert forwarded_from({"History-Info": "<sip:919876543210@x.in?Reason=SIP;cause=486>;index=1"}) == "+919876543210"


def test_tel_uri_and_case_insensitive():
    assert forwarded_from({"diversion": "<tel:+911234567890>"}) == "+911234567890"


def test_absent():
    assert forwarded_from({"From": "<sip:+911111111111@x>"}) is None
