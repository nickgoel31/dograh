import httpx
from loguru import logger
from typing import Dict, Any, List, Optional
from api.utils.encryption import decrypt_data


class WhatsAppClient:
    def __init__(
        self,
        phone_number_id: str,
        encrypted_access_token: str,
        business_account_id: Optional[str] = None
    ):
        self.phone_number_id = phone_number_id
        self.access_token = decrypt_data(encrypted_access_token)
        self.business_account_id = business_account_id
        self.base_url = f"https://graph.facebook.com/v18.0/{phone_number_id}"

    async def send_template_message(
        self,
        to: str,
        template_name: str,
        language_code: str,
        parameters: List[str]
    ) -> Dict[str, Any]:
        """Send a template message to a recipient using Meta Graph API.

        Args:
            to: Recipient phone number (E.164 format, e.g. +1234567890)
            template_name: Meta template name
            language_code: Language code (e.g. "en" or "en_US")
            parameters: List of text values for body parameters (e.g. ['John', 'Success'])

        Returns:
            API response dictionary.
        """
        # Meta expects numbers without the leading '+' for recipient
        clean_to = to.lstrip("+")

        url = f"{self.base_url}/messages"
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json"
        }

        # Build parameters list
        body_params = [{"type": "text", "text": p} for p in parameters]

        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": clean_to,
            "type": "template",
            "template": {
                "name": template_name,
                "language": {
                    "code": language_code
                },
                "components": [
                    {
                        "type": "body",
                        "parameters": body_params
                    }
                ]
            }
        }

        logger.debug(f"Sending WhatsApp template {template_name} to {clean_to}")
        async with httpx.AsyncClient() as client:
            response = await client.post(url, headers=headers, json=payload, timeout=15.0)
            
            if response.status_code != 200:
                logger.error(f"WhatsApp API error: Status {response.status_code}, Body: {response.text}")
                response.raise_for_status()
                
            return response.json()
