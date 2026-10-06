import hashlib
import time

import jwt
import pytest
from pydantic import ValidationError

from api.routes.organization import InviteRequest, UpdateMemberRoleRequest
from api.services.telephony.providers.cloudonix.provider import CloudonixProvider
from api.services.telephony.providers.vonage.provider import VonageProvider


@pytest.mark.parametrize("model", [InviteRequest, UpdateMemberRoleRequest])
def test_super_admin_role_not_assignable_by_org_admins(model):
    kwargs = {"email": "a@b.com"} if model is InviteRequest else {}
    with pytest.raises(ValidationError):
        model(role="super_admin", **kwargs)
    with pytest.raises(ValidationError):
        model(role="whatever", **kwargs)
    assert model(role="client", **kwargs).role == "client"
    assert model(role="admin", **kwargs).role == "admin"


def _vonage(secret="s3cret"):
    return VonageProvider(
        {
            "api_key": "k",
            "api_secret": "x",
            "application_id": "app",
            "private_key": "pk",
            "from_numbers": ["1"],
            "signature_secret": secret,
        }
    )


@pytest.mark.asyncio
async def test_vonage_requires_valid_bearer_jwt_when_secret_set():
    body = '{"a":1}'
    good = jwt.encode(
        {"iat": int(time.time()), "payload_hash": hashlib.sha256(body.encode()).hexdigest()},
        "s3cret",
        algorithm="HS256",
    )
    p = _vonage()
    assert await p.verify_inbound_signature("u", {}, {"Authorization": f"Bearer {good}"}, body)
    assert not await p.verify_inbound_signature("u", {}, {}, body)
    assert not await p.verify_inbound_signature("u", {}, {"Authorization": f"Bearer {good}"}, '{"a":2}')
    bad = jwt.encode({"iat": int(time.time())}, "wrong", algorithm="HS256")
    assert not await p.verify_inbound_signature("u", {}, {"Authorization": f"Bearer {bad}"}, body)
    stale = jwt.encode({"iat": int(time.time()) - 3600}, "s3cret", algorithm="HS256")
    assert not await p.verify_inbound_signature("u", {}, {"Authorization": f"Bearer {stale}"}, body)


@pytest.mark.asyncio
async def test_cloudonix_rejects_wrong_api_key():
    p = CloudonixProvider(
        {"bearer_token": "right", "domain_id": "d", "from_numbers": ["1"]}
    )
    assert await p.verify_inbound_signature("u", {}, {"x-cx-apikey": "right"})
    assert not await p.verify_inbound_signature("u", {}, {"x-cx-apikey": "wrong"})
